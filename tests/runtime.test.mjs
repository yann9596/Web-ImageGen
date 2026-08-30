import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectImage } from "../src/candidates.mjs"
import { chooseJob, collectJob, expireJob, initFromRequest, redrawJob, statusJob } from "../src/runtime.mjs"
import { imageFile, writeJson } from "./helpers.mjs"

function requestPath(workspace, name = "request.json") {
  return join(workspace, ".web-imagegen", name)
}

test("AI flow retries once, merges unique originals, chooses one, and replays idempotently", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const downloads = join(workspace, "downloads")
  const first = await imageFile(downloads, "first.png", { color: "red" })
  const second = await imageFile(downloads, "second.png", { color: "blue" })
  const request = writeJson(requestPath(workspace), { workspace, prompt: "wide banner", workflow: "ai", sessionID: "task-ai", goal: "banner" })
  const initialized = await initFromRequest(request)
  assert.equal(initialized.status, "generating")
  assert.equal(existsSync(request), false)
  assert.equal(statusJob({ workspace }).batchKey, initialized.batchKey)

  const manifest1 = writeJson(join(workspace, ".web-imagegen", "collect-1.json"), { batchKey: initialized.batchKey, files: [{ path: first, key: "asset-a" }] })
  const retry = await collectJob(initialized.jobDir, manifest1)
  assert.equal(retry.status, "retry")
  assert.equal(retry.recoveryRetryCount, 1)

  const manifest2 = writeJson(join(workspace, ".web-imagegen", "collect-2.json"), { batchKey: initialized.batchKey, files: [{ path: first, key: "asset-a-copy" }, { path: second, key: "asset-b" }] })
  const ready = await collectJob(initialized.jobDir, manifest2)
  assert.equal(ready.status, "candidates-ready")
  assert.equal(ready.candidates.length, 2)
  assert.equal(ready.rejected.some((item) => item.error === "dup-content"), true)

  const chosen = await chooseJob(initialized.jobDir, { source: "candidates", ids: "2", by: "agent" })
  assert.equal(chosen.status, "chosen")
  assert.equal(chosen.chosenId, "2")
  assert.equal(inspectImage(readFileSync(chosen.saved[0].path)).type, "image/jpeg")
  assert.equal(existsSync(ready.candidates[0].path), true)

  const replay = await chooseJob(initialized.jobDir, { source: "candidates", ids: "2", by: "agent" })
  assert.equal(replay.idempotent, true)
  assert.deepEqual(replay.saved, chosen.saved)
})

test("user group accepts an incomplete set and can save all", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const one = await imageFile(join(workspace, "downloads"), "one.webp", { format: "webp", color: "green" })
  const request = writeJson(requestPath(workspace), { workspace, prompt: "不要修改", workflow: "user", selection: "group", count: 3, sessionID: "task-group", goal: "cards" })
  const initialized = await initFromRequest(request)
  const manifest = writeJson(join(workspace, ".web-imagegen", "group.json"), { batchKey: initialized.batchKey, files: [{ path: one, key: "group-one" }] })
  const ready = await collectJob(initialized.jobDir, manifest)
  assert.equal(ready.actualCount, 1)
  assert.equal(ready.incomplete, true)
  const result = await chooseJob(initialized.jobDir, { source: "candidates", ids: "all", by: "user" })
  assert.equal(result.chosenBy, "user")
  assert.equal(result.saved.length, 1)
})

test("user single freezes batch identities before accepting the selected original", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const selected = await imageFile(join(workspace, "downloads"), "selected.jpg", { format: "jpeg", color: "purple" })
  const request = writeJson(requestPath(workspace), { workspace, prompt: "原样", workflow: "user", selection: "single", sessionID: "task-single", goal: "cover" })
  const initialized = await initFromRequest(request)
  const key = "https://assets.grok.com/users/u/generated/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-part-0/image.jpg"
  const manifest = writeJson(join(workspace, ".web-imagegen", "single.json"), { batchKey: initialized.batchKey, candidates: [{ key, responseId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }] })
  const waiting = await collectJob(initialized.jobDir, manifest)
  assert.equal(waiting.status, "awaiting-user-selection")
  await assert.rejects(() => chooseJob(initialized.jobDir, { source: "post", file: selected, key: "historic", by: "user" }), (error) => error.code === "selection-stale")
  const result = await chooseJob(initialized.jobDir, { source: "post", file: selected, key, by: "user" })
  assert.equal(result.status, "chosen")
})

test("refine redraw is budgeted and creates a versioned job", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const a = await imageFile(join(workspace, "downloads"), "a.png", { color: "black" })
  const b = await imageFile(join(workspace, "downloads"), "b.png", { color: "white" })
  const request = writeJson(requestPath(workspace), { workspace, prompt: "poster", workflow: "ai", refine: 1, sessionID: "task-refine", goal: "poster" })
  const initialized = await initFromRequest(request)
  const manifest = writeJson(join(workspace, ".web-imagegen", "refine.json"), { batchKey: initialized.batchKey, files: [{ path: a, key: "a" }, { path: b, key: "b" }] })
  await collectJob(initialized.jobDir, manifest)
  const redraw = redrawJob(initialized.jobDir, { refine: true, reason: "both unusable", prompt: "poster with clearer focal hierarchy" })
  assert.equal(redraw.refinementUsed, 1)
  assert.equal(redraw.prompt, "poster with clearer focal hierarchy")
  assert.notEqual(redraw.jobDir, initialized.jobDir)
  assert.match(redraw.jobDir, /-V2/)
  assert.equal(statusJob({ jobDir: initialized.jobDir }).state, "redraw")
})

test("an existing job lock returns busy", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const request = writeJson(requestPath(workspace), { workspace, prompt: "cat", workflow: "ai", sessionID: "task-lock", goal: "cat" })
  const initialized = await initFromRequest(request)
  writeFileSync(join(initialized.jobDir, ".runtime.lock"), "held")
  const manifest = writeJson(join(workspace, ".web-imagegen", "locked.json"), { batchKey: initialized.batchKey, files: [] })
  await assert.rejects(() => collectJob(initialized.jobDir, manifest), (error) => error.code === "busy")
})

test("candidate collection rejects previews and extension mismatches", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const preview = await imageFile(join(workspace, "downloads"), "preview.png", { width: 64, height: 64 })
  const wrongExtension = await imageFile(join(workspace, "downloads"), "not-really-jpeg.jpg", { width: 640, height: 512 })
  const request = writeJson(requestPath(workspace), { workspace, prompt: "set", workflow: "user", selection: "group", count: 2, sessionID: "task-invalid", goal: "set" })
  const initialized = await initFromRequest(request)
  const manifest = writeJson(join(workspace, ".web-imagegen", "invalid.json"), { batchKey: initialized.batchKey, files: [preview, wrongExtension] })
  await assert.rejects(
    () => collectJob(initialized.jobDir, manifest),
    (error) => error.code === "timeout" && error.rejected.some((item) => item.error === "preview-size") && error.rejected.some((item) => item.error === "ext-mismatch"),
  )
})

test("a lost Chrome batch identity becomes selection-expired", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const request = writeJson(requestPath(workspace), { workspace, prompt: "single", workflow: "user", selection: "single", sessionID: "task-expire", goal: "single" })
  const initialized = await initFromRequest(request)
  const expired = expireJob(initialized.jobDir, { reason: "tab-closed" })
  assert.equal(expired.state, "selection-expired")
  assert.equal(expireJob(initialized.jobDir).idempotent, true)
})
