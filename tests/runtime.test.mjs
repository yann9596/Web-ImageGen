import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bindAttempt, startAttempt } from "../src/attempts.mjs"
import { inspectImage } from "../src/candidates.mjs"
import { readJobFile, writeBatch } from "../src/jobs.mjs"
import { chooseJob, collectJob, expireJob, initFromRequest, redrawJob, statusJob } from "../src/runtime.mjs"
import { imageFile, writeJson } from "./helpers.mjs"

function requestPath(workspace, name = "request.json") {
  return join(workspace, ".web-imagegen", name)
}

const GROK_POST = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
const GROK_ASSET_A = `https://assets.grok.com/users/u/generated/${GROK_POST}-part-0/image.jpg`
const GROK_ASSET_B = `https://assets.grok.com/users/u/generated/${GROK_POST}-part-1/image.jpg`

async function bindGrokAttempt(jobDir, { assetKeys = [GROK_ASSET_A, GROK_ASSET_B], prompt } = {}) {
  let job = readJobFile(jobDir)
  const started = startAttempt(job, {
    provider: "grok",
    purpose: "initial",
    prompt: prompt || job.prompt,
    browserContext: {
      origin: "https://grok.com",
      conversationKey: "grok-session",
      beforeResponseAnchor: "",
    },
  })
  assert.equal(started.ok, true, started.error)
  job = started.job
  const bound = bindAttempt(job, {
    provider: "grok",
    attemptId: started.attempt.attemptId,
    observation: {
      origin: "https://grok.com",
      pageUrl: `https://grok.com/imagine/post/${GROK_POST}`,
      mainSrc: assetKeys[0],
      mainLoaded: true,
      candidateKeys: assetKeys,
      assetKeys,
    },
  })
  assert.equal(bound.ok, true, bound.error)
  writeBatch(bound.job)
  return { attemptId: started.attempt.attemptId, assetKeys: bound.attempt.response.assetKeys }
}

test("AI flow retries once, merges unique originals, chooses one, and replays idempotently", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const downloads = join(workspace, "downloads")
  const first = await imageFile(downloads, "first.png", { color: "red" })
  const second = await imageFile(downloads, "second.png", { color: "blue" })
  const request = writeJson(requestPath(workspace), { workspace, provider: "grok", prompt: "wide banner", workflow: "ai", sessionID: "task-ai", goal: "banner" })
  const initialized = await initFromRequest(request)
  assert.equal(initialized.status, "generating")
  assert.equal(existsSync(request), false)
  assert.equal(statusJob({ workspace }).batchKey, initialized.batchKey)

  const { attemptId, assetKeys } = await bindGrokAttempt(initialized.jobDir)
  const keyA = assetKeys[0]
  const keyB = assetKeys[1]

  const manifest1 = writeJson(join(workspace, ".web-imagegen", "collect-1.json"), {
    batchKey: initialized.batchKey,
    provider: "grok",
    attemptId,
    files: [{ path: first, providerAssetKey: keyA }],
  })
  const retry = await collectJob(initialized.jobDir, manifest1)
  assert.equal(retry.status, "retry")
  assert.equal(retry.recoveryRetryCount, 1)
  assert.equal(retry.candidates[0].provider, "grok")
  assert.equal(retry.candidates[0].attemptId, attemptId)
  assert.equal(retry.candidates[0].providerAssetKey, keyA)

  const manifest2 = writeJson(join(workspace, ".web-imagegen", "collect-2.json"), {
    batchKey: initialized.batchKey,
    provider: "grok",
    attemptId,
    files: [
      { path: first, providerAssetKey: keyA },
      { path: second, providerAssetKey: keyB },
    ],
  })
  const ready = await collectJob(initialized.jobDir, manifest2)
  assert.equal(ready.status, "candidates-ready")
  assert.equal(ready.candidates.length, 2)
  // Same providerAssetKey replay is rejected as dup-resource; rejected entries are basename + code only.
  assert.equal(ready.rejected.some((item) => item.error === "dup-resource" && item.name === "first.png"), true)
  assert.equal(ready.rejected.every((item) => item.name && !("path" in item)), true)
  assert.equal(readJobFile(initialized.jobDir).attempts.find((item) => item.attemptId === attemptId).status, "collected")

  const jobAfter = readJobFile(initialized.jobDir)
  assert.equal(jobAfter.attempts.filter((item) => item.synthetic !== true).length, 1)
  assert.equal(jobAfter.attempts[0].purpose, "initial")
  assert.equal(ready.baseRemaining, 0)

  const chosen = await chooseJob(initialized.jobDir, { source: "candidates", ids: "2", by: "agent", provider: "grok" })
  assert.equal(chosen.status, "chosen")
  assert.equal(chosen.chosenId, "2")
  assert.equal(inspectImage(readFileSync(chosen.saved[0].path)).type, "image/jpeg")
  assert.equal(existsSync(ready.candidates[0].path), true)

  const replay = await chooseJob(initialized.jobDir, { source: "candidates", ids: "2", by: "agent", provider: "grok" })
  assert.equal(replay.idempotent, true)
  assert.deepEqual(replay.saved, chosen.saved)
})

test("user group accepts an incomplete set and can save all", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const one = await imageFile(join(workspace, "downloads"), "one.webp", { format: "webp", color: "green" })
  const request = writeJson(requestPath(workspace), { workspace, provider: "grok", prompt: "不要修改", workflow: "user", selection: "group", count: 3, sessionID: "task-group", goal: "cards" })
  const initialized = await initFromRequest(request)
  const { attemptId, assetKeys } = await bindGrokAttempt(initialized.jobDir, { assetKeys: [GROK_ASSET_A] })
  const manifest = writeJson(join(workspace, ".web-imagegen", "group.json"), {
    batchKey: initialized.batchKey,
    provider: "grok",
    attemptId,
    files: [{ path: one, providerAssetKey: assetKeys[0] }],
  })
  const ready = await collectJob(initialized.jobDir, manifest)
  assert.equal(ready.actualCount, 1)
  assert.equal(ready.incomplete, true)
  assert.equal(ready.candidates[0].provider, "grok")
  assert.equal(ready.candidates[0].attemptId, attemptId)
  const result = await chooseJob(initialized.jobDir, { source: "candidates", ids: "all", by: "user", provider: "grok" })
  assert.equal(result.chosenBy, "user")
  assert.equal(result.saved.length, 1)
})

test("user single freezes batch identities before accepting the selected original", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const selected = await imageFile(join(workspace, "downloads"), "selected.jpg", { format: "jpeg", color: "purple" })
  const request = writeJson(requestPath(workspace), { workspace, provider: "grok", prompt: "原样", workflow: "user", selection: "single", sessionID: "task-single", goal: "cover" })
  const initialized = await initFromRequest(request)
  const key = GROK_ASSET_A
  const { attemptId } = await bindGrokAttempt(initialized.jobDir, { assetKeys: [key] })
  const manifest = writeJson(join(workspace, ".web-imagegen", "single.json"), {
    batchKey: initialized.batchKey,
    provider: "grok",
    attemptId,
    candidates: [{ key, providerAssetKey: key, responseId: GROK_POST }],
  })
  const waiting = await collectJob(initialized.jobDir, manifest)
  assert.equal(waiting.status, "awaiting-user-selection")
  assert.equal(readJobFile(initialized.jobDir).attempts.find((item) => item.attemptId === attemptId).status, "collected")
  await assert.rejects(
    () => chooseJob(initialized.jobDir, { source: "post", file: selected, key: "historic", by: "user", provider: "grok" }),
    (error) => error.code === "selection-stale",
  )
  const result = await chooseJob(initialized.jobDir, { source: "post", file: selected, key, by: "user", provider: "grok" })
  assert.equal(result.status, "chosen")
})

test("refine redraw is budgeted and creates a versioned job", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const a = await imageFile(join(workspace, "downloads"), "a.png", { color: "black" })
  const b = await imageFile(join(workspace, "downloads"), "b.png", { color: "white" })
  const request = writeJson(requestPath(workspace), { workspace, provider: "grok", prompt: "poster", workflow: "ai", refine: 1, sessionID: "task-refine", goal: "poster" })
  const initialized = await initFromRequest(request)
  const { attemptId, assetKeys } = await bindGrokAttempt(initialized.jobDir)
  const manifest = writeJson(join(workspace, ".web-imagegen", "refine.json"), {
    batchKey: initialized.batchKey,
    provider: "grok",
    attemptId,
    files: [
      { path: a, providerAssetKey: assetKeys[0] },
      { path: b, providerAssetKey: assetKeys[1] },
    ],
  })
  await collectJob(initialized.jobDir, manifest)
  const redraw = redrawJob(initialized.jobDir, {
    refine: true,
    reason: "both unusable",
    prompt: "poster with clearer focal hierarchy",
    provider: "grok",
  })
  assert.equal(redraw.refinementUsed, 1)
  assert.equal(redraw.prompt, "poster with clearer focal hierarchy")
  assert.equal(redraw.provider, "grok")
  assert.equal(redraw.attemptCount, 0)
  assert.notEqual(redraw.jobDir, initialized.jobDir)
  assert.match(redraw.jobDir, /-V2/)
  assert.equal(statusJob({ jobDir: initialized.jobDir }).state, "redraw")
})

test("an existing job lock returns busy", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const request = writeJson(requestPath(workspace), { workspace, provider: "grok", prompt: "cat", workflow: "ai", sessionID: "task-lock", goal: "cat" })
  const initialized = await initFromRequest(request)
  writeFileSync(join(initialized.jobDir, ".runtime.lock"), "held")
  const manifest = writeJson(join(workspace, ".web-imagegen", "locked.json"), {
    batchKey: initialized.batchKey,
    provider: "grok",
    attemptId: "a1",
    files: [],
  })
  await assert.rejects(() => collectJob(initialized.jobDir, manifest), (error) => error.code === "busy")
})

test("candidate collection rejects previews and extension mismatches", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const preview = await imageFile(join(workspace, "downloads"), "preview.png", { width: 64, height: 64 })
  const wrongExtension = await imageFile(join(workspace, "downloads"), "not-really-jpeg.jpg", { width: 640, height: 512 })
  const request = writeJson(requestPath(workspace), { workspace, provider: "grok", prompt: "set", workflow: "user", selection: "group", count: 2, sessionID: "task-invalid", goal: "set" })
  const initialized = await initFromRequest(request)
  const { attemptId, assetKeys } = await bindGrokAttempt(initialized.jobDir, {
    assetKeys: [GROK_ASSET_A, GROK_ASSET_B],
  })
  const manifest = writeJson(join(workspace, ".web-imagegen", "invalid.json"), {
    batchKey: initialized.batchKey,
    provider: "grok",
    attemptId,
    files: [
      { path: preview, providerAssetKey: assetKeys[0] },
      { path: wrongExtension, providerAssetKey: assetKeys[1] },
    ],
  })
  await assert.rejects(
    () => collectJob(initialized.jobDir, manifest),
    (error) =>
      error.code === "timeout" &&
      error.rejected.some((item) => item.error === "preview-size" && item.name === "preview.png") &&
      error.rejected.some((item) => item.error === "ext-mismatch" && item.name === "not-really-jpeg.jpg") &&
      error.rejected.every((item) => !("path" in item)),
  )
})

test("a lost Chrome batch identity becomes selection-expired", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-runtime-"))
  const request = writeJson(requestPath(workspace), { workspace, provider: "grok", prompt: "single", workflow: "user", selection: "single", sessionID: "task-expire", goal: "single" })
  const initialized = await initFromRequest(request)
  const expired = expireJob(initialized.jobDir, { reason: "tab-closed", provider: "grok" })
  assert.equal(expired.state, "selection-expired")
  assert.equal(expireJob(initialized.jobDir, { provider: "grok" }).idempotent, true)
})

test("GPT-025 collect rejects unbound, wrong provider, unknown asset, and records basename-only rejects", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-collect-id-"))
  const good = await imageFile(join(workspace, "downloads"), "good.png", { color: "red" })
  const other = await imageFile(join(workspace, "downloads"), "other.png", { color: "blue" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "grok",
    prompt: "identity gates",
    workflow: "user",
    selection: "group",
    count: 2,
    sessionID: "task-collect-id",
    goal: "gates",
  })
  const initialized = await initFromRequest(request)

  await assert.rejects(
    () =>
      collectJob(
        initialized.jobDir,
        writeJson(join(workspace, ".web-imagegen", "unbound.json"), {
          batchKey: initialized.batchKey,
          provider: "grok",
          attemptId: "a1",
          files: [{ path: good, providerAssetKey: GROK_ASSET_A }],
        }),
      ),
    (error) => error.code === "attempt-not-ready",
  )

  const prepared = startAttempt(readJobFile(initialized.jobDir), {
    provider: "grok",
    purpose: "initial",
    prompt: "identity gates",
    browserContext: { origin: "https://grok.com", conversationKey: "grok-session", beforeResponseAnchor: "" },
  })
  writeBatch(prepared.job)
  await assert.rejects(
    () =>
      collectJob(
        initialized.jobDir,
        writeJson(join(workspace, ".web-imagegen", "prepared-only.json"), {
          batchKey: initialized.batchKey,
          provider: "grok",
          attemptId: prepared.attempt.attemptId,
          files: [{ path: good, providerAssetKey: GROK_ASSET_A }],
        }),
      ),
    (error) => error.code === "attempt-not-ready",
  )

  const { attemptId, assetKeys } = await bindGrokAttempt(initialized.jobDir, {
    assetKeys: [GROK_ASSET_A, GROK_ASSET_B],
  })

  await assert.rejects(
    () =>
      collectJob(
        initialized.jobDir,
        writeJson(join(workspace, ".web-imagegen", "wrong-provider.json"), {
          batchKey: initialized.batchKey,
          provider: "gpt",
          attemptId,
          files: [{ path: good, providerAssetKey: assetKeys[0] }],
        }),
      ),
    (error) => error.code === "provider-mismatch",
  )

  // Unknown asset is rejected item-by-item; a sibling valid file can still admit the batch.
  const mixed = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "unknown-asset.json"), {
      batchKey: initialized.batchKey,
      provider: "grok",
      attemptId,
      files: [
        { path: good, providerAssetKey: assetKeys[0] },
        { path: other, providerAssetKey: "not-bound-asset" },
      ],
    }),
  )
  assert.equal(mixed.status, "candidates-ready")
  assert.equal(mixed.candidates.length, 1)
  assert.equal(mixed.candidates[0].providerAssetKey, assetKeys[0])
  assert.equal(mixed.rejected.some((item) => item.error === "asset-identity-missing" && item.name === "other.png"), true)
  assert.equal(mixed.rejected.every((item) => !("path" in item)), true)
  assert.equal(readJobFile(initialized.jobDir).attempts.find((item) => item.attemptId === attemptId).status, "collected")
})

test("GPT-025 duplicate content is rejected while a distinct asset is kept", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-collect-dup-"))
  const dupA = await imageFile(join(workspace, "downloads"), "dup-a.png", { color: "navy" })
  const dupB = await imageFile(join(workspace, "downloads"), "dup-b.png", { color: "navy" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "grok",
    prompt: "dup content",
    workflow: "user",
    selection: "group",
    count: 2,
    sessionID: "task-collect-dup",
    goal: "dup",
  })
  const initialized = await initFromRequest(request)
  const { attemptId, assetKeys } = await bindGrokAttempt(initialized.jobDir, {
    assetKeys: [GROK_ASSET_A, GROK_ASSET_B],
  })
  const ready = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "dup.json"), {
      batchKey: initialized.batchKey,
      provider: "grok",
      attemptId,
      files: [
        { path: dupA, providerAssetKey: assetKeys[0] },
        { path: dupB, providerAssetKey: assetKeys[1] },
      ],
    }),
  )
  assert.equal(ready.status, "candidates-ready")
  assert.equal(ready.candidates.length, 1)
  assert.equal(ready.candidates[0].provider, "grok")
  assert.equal(ready.candidates[0].attemptId, attemptId)
  assert.equal(ready.rejected.some((item) => item.error === "dup-content" && item.name === "dup-b.png"), true)
  assert.equal(ready.rejected.every((item) => !("path" in item)), true)
  assert.equal(readJobFile(initialized.jobDir).attempts.find((item) => item.attemptId === attemptId).status, "collected")
})
