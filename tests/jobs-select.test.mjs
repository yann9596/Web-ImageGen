import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { candidateIdentityKeys, gateGroupChoose, replayChoose, validatePostSelection } from "../src/select.mjs"
import { canTransition, createBatch, lastJob, transition, writeBatch, clearJobMemory } from "../src/jobs.mjs"

test("state transitions and disk recovery remain deterministic", () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-jobs-"))
  const sessionDir = join(workspace, "imagine", "session")
  const jobDir = join(sessionDir, "job")
  mkdirSync(jobDir, { recursive: true })
  clearJobMemory()
  let job = writeBatch(createBatch({ workspace, sessionID: "task", sessionDir, jobDir, workflow: "user", state: "generating" }))
  assert.equal(canTransition("generating", "candidates-ready"), true)
  job = transition(job, "candidates-ready", { candidates: [{ id: "1", path: "one.jpg" }] })
  clearJobMemory()
  assert.equal(lastJob("task", { workspace }).state, "candidates-ready")
  assert.equal(gateGroupChoose(job, { ids: "1" }).ok, true)
  assert.throws(() => transition(job, "generating"), /invalid-transition/)
})

test("candidate identities bind current Grok posts and replay a completed choice", () => {
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  const url = `https://assets.grok.com/users/u/generated/${id}-part-0/image.jpg?cache=1`
  const keys = candidateIdentityKeys([{ src: url, assetId: `${id}-part-0`, responseId: id }])
  assert.ok(keys.includes(id))
  assert.equal(validatePostSelection({ pageUrl: `https://grok.com/imagine/post/${id}`, mainSrc: url, mainLoaded: true, candidateKeys: keys }).status, "ok")
  const replay = replayChoose({ batchKey: "b", state: "chosen", idempotencyKey: "b::candidates::1", lastChooseResult: { status: "chosen" } }, { source: "candidates", ids: "1" })
  assert.equal(replay.idempotent, true)
})
