import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gateGroupChoose, replayChoose } from "../src/select.mjs"
import { canTransition, createBatch, lastJob, transition, writeBatch, clearJobMemory } from "../src/jobs.mjs"

test("state transitions and disk recovery remain deterministic", () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-jobs-"))
  const sessionDir = join(workspace, "imagine", "session")
  const jobDir = join(sessionDir, "job")
  mkdirSync(jobDir, { recursive: true })
  clearJobMemory()
  let job = writeBatch(createBatch({ workspace, sessionID: "task", sessionDir, jobDir, workflow: "user", provider: "grok", state: "generating" }))
  assert.equal(canTransition("generating", "candidates-ready"), true)
  job = transition(job, "candidates-ready", { candidates: [{ id: "1", path: "one.jpg" }] })
  clearJobMemory()
  assert.equal(lastJob("task", { workspace }).state, "candidates-ready")
  assert.equal(gateGroupChoose(job, { ids: "1" }).ok, true)
  assert.throws(() => transition(job, "generating"), /invalid-transition/)
})

test("replay of a completed choice stays idempotent", () => {
  const replay = replayChoose(
    { batchKey: "b", state: "chosen", idempotencyKey: "b::candidates::1", lastChooseResult: { status: "chosen" } },
    { source: "candidates", ids: "1" },
  )
  assert.equal(replay.idempotent, true)
})
