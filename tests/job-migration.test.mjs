import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertProviderMatch } from "../src/contract.mjs"
import {
  clearJobMemory,
  createBatch,
  jobJsonPath,
  migrateJobV1,
  readJobFile,
  readJobFileRaw,
  resolveUnprovableMigration,
  writeBatch,
} from "../src/jobs.mjs"
import { remainingAttemptBudget } from "../src/attempts.mjs"
import { replayChoose } from "../src/select.mjs"
import { statusJob, debugJob } from "../src/runtime.mjs"

function tempJob(prefix = "web-imagegen-jm-") {
  const workspace = mkdtempSync(join(tmpdir(), prefix))
  const sessionDir = join(workspace, "imagine", "session")
  const jobDir = join(sessionDir, "job")
  mkdirSync(jobDir, { recursive: true })
  return { workspace, sessionDir, jobDir }
}

test("JM-01 v2 round-trip keeps provider/attempts and strips buffers", () => {
  const { workspace, sessionDir, jobDir } = tempJob()
  clearJobMemory()
  const job = writeBatch(
    createBatch({
      workspace,
      sessionDir,
      jobDir,
      sessionID: "jm-01",
      provider: "gpt",
      workflow: "ai",
      state: "generating",
      prompt: "two posters",
      requestedCount: 2,
      attempts: [
        {
          attemptId: "a1",
          ordinal: 1,
          purpose: "initial",
          status: "bound",
          prompt: "two posters",
          promptDigest: "sha256:abc",
          browserContext: {
            origin: "https://chatgpt.com",
            conversationKey: "c1",
            beforeResponseAnchor: "anchor-0",
          },
          response: {
            userTurnKey: "u1",
            responseKey: "r1",
            assetKeys: ["gpt:r1:0"],
          },
          failure: null,
          tab: { shouldNotPersist: true },
          observation: { html: "<div>nope</div>" },
        },
      ],
      activeAttemptId: "a1",
      candidates: [{ id: "1", path: "one.png", key: "gpt:r1:0", buf: Buffer.from("secret") }],
    }),
  )

  assert.equal(job.schemaVersion, 2)
  assert.equal(job.provider, "gpt")
  assert.equal(job.attemptPolicy.baseLimit, 2)
  assert.equal(job.attemptPolicy.recoveryLimit, 1)
  assert.equal(job.attempts[0].status, "bound")
  assert.equal(job.attempts[0].tab, undefined)
  assert.equal(job.attempts[0].observation, undefined)
  assert.equal(job.candidates[0].buf, undefined)

  const disk = JSON.parse(readFileSync(jobJsonPath(jobDir), "utf8"))
  assert.equal(disk.schemaVersion, 2)
  assert.equal(disk.provider, "gpt")
  assert.equal(disk.attempts[0].response.assetKeys[0], "gpt:r1:0")
  assert.equal(disk.attempts[0].tab, undefined)
  assert.equal(disk.candidates[0].buf, undefined)

  const status = statusJob({ jobDir })
  assert.equal(status.provider, "gpt")
  assert.equal(status.activeAttemptId, "a1")
})

test("JM-02 v1 terminal chosen migrates to grok and keeps replay", () => {
  const { jobDir } = tempJob()
  const v1 = {
    batchKey: "old-chosen",
    sessionID: "jm-02",
    workflow: "ai",
    state: "chosen",
    prompt: "cat",
    requestedCount: 2,
    candidates: [{ id: "1", path: "one.jpg", key: "post-1" }],
    chosenId: "1",
    chosenIds: ["1"],
    chosenBy: "agent",
    idempotencyKey: "old-chosen::candidates::1",
    lastChooseResult: { status: "chosen", chosenIds: ["1"] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
  writeFileSync(jobJsonPath(jobDir), JSON.stringify(v1, null, 2), "utf8")
  const before = readFileSync(jobJsonPath(jobDir), "utf8")

  const migrated = migrateJobV1(v1)
  assert.equal(migrated.schemaVersion, 2)
  assert.equal(migrated.provider, "grok")
  assert.equal(migrated.state, "chosen")
  assert.equal(migrated.idempotencyKey, "old-chosen::candidates::1")

  const loaded = readJobFile(jobDir)
  assert.equal(loaded.provider, "grok")
  assert.equal(readJobFileRaw(jobDir).schemaVersion, undefined)
  assert.equal(readFileSync(jobJsonPath(jobDir), "utf8"), before)

  const replay = replayChoose(loaded, { source: "candidates", ids: "1" })
  assert.equal(replay.idempotent, true)
})

test("JM-03 v1 ready keeps candidate identity and synthetic attempt is free", () => {
  const v1 = {
    batchKey: "old-ready",
    workflow: "user",
    selectionMode: "group",
    state: "candidates-ready",
    prompt: "cards",
    requestedCount: 3,
    candidateKeys: ["uuid-a", "uuid-b"],
    candidates: [
      { id: "1", path: "a.jpg", key: "uuid-a" },
      { id: "2", path: "b.jpg", key: "uuid-b" },
    ],
  }
  const migrated = migrateJobV1(v1)
  assert.equal(migrated.provider, "grok")
  assert.equal(migrated.candidates.length, 2)
  assert.deepEqual(migrated.candidateKeys, ["uuid-a", "uuid-b"])
  assert.equal(migrated.attempts.length, 1)
  assert.equal(migrated.attempts[0].synthetic, true)
  assert.equal(migrated.attempts[0].status, "collected")
  const budget = remainingAttemptBudget(migrated, "initial")
  assert.equal(budget.baseRemaining, migrated.attemptPolicy.baseLimit)
  assert.equal(budget.recoveryRemaining, migrated.attemptPolicy.recoveryLimit)
})

test("JM-04 v1 generating without identity is unprovable and seals to expired", () => {
  const { jobDir } = tempJob()
  const v1 = {
    batchKey: "old-gen",
    jobDir,
    workflow: "ai",
    state: "generating",
    prompt: "poster",
    requestedCount: 2,
    candidates: [],
    candidateKeys: [],
  }
  writeFileSync(jobJsonPath(jobDir), JSON.stringify(v1, null, 2), "utf8")
  const migrated = readJobFile(jobDir)
  assert.equal(migrated.migrationUnprovable, true)
  assert.equal(migrated.state, "generating")

  const sealed = resolveUnprovableMigration(migrated)
  assert.equal(sealed.state, "selection-expired")
  assert.equal(sealed.expirationReason, "migration-unprovable")
  assert.notEqual(sealed.state, "generating")

  const debug = debugJob(jobDir)
  assert.equal(debug.debug.migrationUnprovable, true)
  assert.equal(debug.debug.provider, "grok")
})

test("JM-05 provider mismatch rejects without rewriting bytes", () => {
  const { workspace, sessionDir, jobDir } = tempJob()
  clearJobMemory()
  writeBatch(
    createBatch({
      workspace,
      sessionDir,
      jobDir,
      sessionID: "jm-05",
      provider: "grok",
      workflow: "ai",
      state: "generating",
      prompt: "stay grok",
    }),
  )
  const path = jobJsonPath(jobDir)
  const before = readFileSync(path, "utf8")
  const mtime = statSync(path).mtimeMs

  const guard = assertProviderMatch(readJobFile(jobDir), "gpt")
  assert.equal(guard.ok, false)
  assert.equal(guard.error, "provider-mismatch")

  assert.throws(
    () =>
      writeBatch(
        createBatch({
          workspace,
          sessionDir,
          jobDir,
          provider: "gpt",
          workflow: "ai",
          state: "generating",
          prompt: "nope",
        }),
      ),
    /provider-mismatch/,
  )

  assert.equal(readFileSync(path, "utf8"), before)
  assert.equal(statSync(path).mtimeMs, mtime)
  assert.throws(() => statusJob({ jobDir, provider: "gpt" }), (error) => error.code === "provider-mismatch")
})
