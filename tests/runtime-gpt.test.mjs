import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bindAttempt, remainingAttemptBudget, startAttempt } from "../src/attempts.mjs"
import { gptAssetKey } from "../src/providers/gpt-identity.mjs"
import { readJobFile, writeBatch } from "../src/jobs.mjs"
import {
  chooseJob,
  collectJob,
  initFromRequest,
  redrawJob,
  startAttemptJob,
  bindAttemptJob,
} from "../src/runtime.mjs"
import { imageFile, writeJson } from "./helpers.mjs"

function requestPath(workspace, name = "request.json") {
  return join(workspace, ".web-imagegen", name)
}

const RESP_1 = "resp-1"
const RESP_2 = "resp-2"
const KEY_1_0 = gptAssetKey(RESP_1, 0)
const KEY_1_1 = gptAssetKey(RESP_1, 1)
const KEY_2_0 = gptAssetKey(RESP_2, 0)

async function bindGptAttempt(
  jobDir,
  {
    purpose = "initial",
    responseKey = RESP_1,
    assetKeys,
    prompt,
    conversationKey = "conv-1",
    beforeResponseAnchor = "",
  } = {},
) {
  let job = readJobFile(jobDir)
  const keys = assetKeys || [gptAssetKey(responseKey, 0)]
  const started = startAttempt(job, {
    provider: "gpt",
    purpose,
    prompt: prompt || job.prompt,
    browserContext: {
      origin: "https://chatgpt.com",
      conversationKey,
      beforeResponseAnchor,
    },
  })
  assert.equal(started.ok, true, started.error)
  job = started.job
  const bound = bindAttempt(job, {
    provider: "gpt",
    attemptId: started.attempt.attemptId,
    observation: {
      origin: "https://chatgpt.com",
      conversationKey,
      responseKey,
      assetKeys: keys,
    },
  })
  assert.equal(bound.ok, true, bound.error)
  writeBatch(bound.job)
  return { attemptId: started.attempt.attemptId, assetKeys: bound.attempt.response.assetKeys, purpose }
}

test("RGP-01 GPT AI one response with two images is immediately ready with baseRemaining 1", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-rgp01-"))
  const a = await imageFile(join(workspace, "downloads"), "a.png", { color: "red" })
  const b = await imageFile(join(workspace, "downloads"), "b.png", { color: "blue" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "gpt",
    prompt: "two concepts",
    workflow: "ai",
    sessionID: "rgp-01",
    goal: "concepts",
  })
  const initialized = await initFromRequest(request)
  assert.equal(initialized.provider, "gpt")
  assert.equal(initialized.attemptPolicy.baseLimit, 2)
  assert.equal(initialized.baseRemaining, 2)

  const { attemptId, assetKeys } = await bindGptAttempt(initialized.jobDir, {
    assetKeys: [KEY_1_0, KEY_1_1],
  })
  const ready = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "collect.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId,
      files: [
        { path: a, providerAssetKey: assetKeys[0] },
        { path: b, providerAssetKey: assetKeys[1] },
      ],
    }),
  )
  assert.equal(ready.status, "candidates-ready")
  assert.equal(ready.candidates.length, 2)
  assert.equal(ready.baseRemaining, 1)
  assert.equal(readJobFile(initialized.jobDir).attempts.length, 1)
  assert.equal(readJobFile(initialized.jobDir).attempts[0].status, "collected")

  await assert.rejects(
    () => chooseJob(initialized.jobDir, { source: "candidates", ids: "1,2", by: "agent", provider: "gpt" }),
    (error) => error.code === "invalid-request",
  )
  const chosen = await chooseJob(initialized.jobDir, {
    source: "candidates",
    ids: "1",
    by: "agent",
    provider: "gpt",
  })
  assert.equal(chosen.status, "chosen")
})

test("RGP-02 GPT AI initial one + fill one reaches ready; agent picks one", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-rgp02-"))
  const first = await imageFile(join(workspace, "downloads"), "first.png", { color: "orange" })
  const second = await imageFile(join(workspace, "downloads"), "second.png", { color: "teal" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "gpt",
    prompt: "fill path",
    workflow: "ai",
    sessionID: "rgp-02",
    goal: "fill",
  })
  const initialized = await initFromRequest(request)

  const initial = await bindGptAttempt(initialized.jobDir, { assetKeys: [KEY_1_0] })
  const afterInitial = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "c1.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId: initial.attemptId,
      files: [{ path: first, providerAssetKey: KEY_1_0 }],
    }),
  )
  assert.equal(afterInitial.status, "generating")
  assert.equal(afterInitial.candidates.length, 1)
  assert.equal(afterInitial.fillEligible, true)
  assert.equal(afterInitial.baseRemaining, 1)
  assert.equal(readJobFile(initialized.jobDir).attempts[0].status, "collected")
  assert.equal(readJobFile(initialized.jobDir).attempts[0].purpose, "initial")

  const fill = await bindGptAttempt(initialized.jobDir, {
    purpose: "fill",
    responseKey: RESP_2,
    assetKeys: [KEY_2_0],
    prompt: "fill path; another independent concept",
    beforeResponseAnchor: RESP_1,
  })
  assert.equal(fill.purpose, "fill")
  const ready = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "c2.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId: fill.attemptId,
      files: [{ path: second, providerAssetKey: KEY_2_0 }],
    }),
  )
  assert.equal(ready.status, "candidates-ready")
  assert.equal(ready.candidates.length, 2)
  assert.equal(ready.baseRemaining, 0)
  assert.equal(readJobFile(initialized.jobDir).attempts.length, 2)
  assert.equal(readJobFile(initialized.jobDir).attempts[1].purpose, "fill")

  const chosen = await chooseJob(initialized.jobDir, {
    source: "candidates",
    ids: "2",
    by: "agent",
    provider: "gpt",
  })
  assert.equal(chosen.chosenId, "2")
})

test("RGP-03 GPT AI duplicate fill content exhausts base budget without recovery", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-rgp03-"))
  const first = await imageFile(join(workspace, "downloads"), "same-a.png", { color: "navy" })
  const dup = await imageFile(join(workspace, "downloads"), "same-b.png", { color: "navy" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "gpt",
    prompt: "dup fill",
    workflow: "ai",
    sessionID: "rgp-03",
    goal: "dup",
  })
  const initialized = await initFromRequest(request)
  const initial = await bindGptAttempt(initialized.jobDir, { assetKeys: [KEY_1_0] })
  await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "c1.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId: initial.attemptId,
      files: [{ path: first, providerAssetKey: KEY_1_0 }],
    }),
  )
  const fill = await bindGptAttempt(initialized.jobDir, {
    purpose: "fill",
    responseKey: RESP_2,
    assetKeys: [KEY_2_0],
    prompt: "dup fill alt",
    beforeResponseAnchor: RESP_1,
  })
  await assert.rejects(
    () =>
      collectJob(
        initialized.jobDir,
        writeJson(join(workspace, ".web-imagegen", "c2.json"), {
          batchKey: initialized.batchKey,
          provider: "gpt",
          attemptId: fill.attemptId,
          files: [{ path: dup, providerAssetKey: KEY_2_0 }],
        }),
      ),
    (error) => error.code === "attempt-budget-exhausted",
  )
  const job = readJobFile(initialized.jobDir)
  assert.equal(job.candidates.length, 1)
  assert.equal(job.attempts.length, 2)
  assert.equal(job.attempts[1].status, "collected")
  assert.equal(remainingAttemptBudget(job, "fill").baseRemaining, 0)
  assert.equal(remainingAttemptBudget(job, "recovery").recoveryRemaining, 1)
})

test("RGP-04 GPT user single freezes identities; historic response cannot save", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-rgp04-"))
  const selected = await imageFile(join(workspace, "downloads"), "pick.jpg", { format: "jpeg", color: "purple" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "gpt",
    prompt: "原样",
    workflow: "user",
    selection: "single",
    sessionID: "rgp-04",
    goal: "single",
  })
  const initialized = await initFromRequest(request)
  assert.equal(initialized.attemptPolicy.baseLimit, 1)
  const { attemptId } = await bindGptAttempt(initialized.jobDir, { assetKeys: [KEY_1_0, KEY_1_1] })
  const waiting = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "freeze.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId,
      candidates: [
        { providerAssetKey: KEY_1_0 },
        { providerAssetKey: KEY_1_1 },
      ],
    }),
  )
  assert.equal(waiting.status, "awaiting-user-selection")
  assert.equal(waiting.candidates.length, 0)
  assert.equal(readJobFile(initialized.jobDir).attempts[0].status, "collected")

  await assert.rejects(
    () =>
      chooseJob(initialized.jobDir, {
        source: "post",
        file: selected,
        key: KEY_2_0,
        by: "user",
        provider: "gpt",
      }),
    (error) => error.code === "selection-stale",
  )
  const result = await chooseJob(initialized.jobDir, {
    source: "post",
    file: selected,
    key: KEY_1_0,
    by: "user",
    provider: "gpt",
  })
  assert.equal(result.status, "chosen")
  assert.equal(result.chosenIds[0], KEY_1_0)
})

test("RGP-05 GPT user group multi-attempt collect, incomplete, and zero-candidate fail", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-rgp05-"))
  const one = await imageFile(join(workspace, "downloads"), "one.png", { color: "green" })
  const two = await imageFile(join(workspace, "downloads"), "two.png", { color: "yellow" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "gpt",
    prompt: "组图",
    workflow: "user",
    selection: "group",
    count: 3,
    sessionID: "rgp-05",
    goal: "group",
  })
  const initialized = await initFromRequest(request)
  assert.equal(initialized.attemptPolicy.baseLimit, 3)
  assert.equal(initialized.attemptPolicy.recoveryLimit, 0)

  const a1 = await bindGptAttempt(initialized.jobDir, { assetKeys: [KEY_1_0] })
  const mid = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "g1.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId: a1.attemptId,
      files: [{ path: one, providerAssetKey: KEY_1_0 }],
    }),
  )
  assert.equal(mid.status, "generating")
  assert.equal(mid.actualCount, 1)
  assert.equal(mid.baseRemaining, 2)

  const a2 = await bindGptAttempt(initialized.jobDir, {
    purpose: "fill",
    responseKey: RESP_2,
    assetKeys: [KEY_2_0],
    beforeResponseAnchor: RESP_1,
  })
  const ready = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "g2.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId: a2.attemptId,
      files: [{ path: two, providerAssetKey: KEY_2_0 }],
    }),
  )
  // Still under target with budget remaining → keep generating
  assert.equal(ready.status, "generating")
  assert.equal(ready.actualCount, 2)

  // Exhaust remaining budget with empty collect → incomplete ready
  const a3 = await bindGptAttempt(initialized.jobDir, {
    purpose: "fill",
    responseKey: "resp-3",
    assetKeys: [gptAssetKey("resp-3", 0)],
    beforeResponseAnchor: RESP_2,
    conversationKey: "conv-1",
  })
  const incomplete = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "g3.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId: a3.attemptId,
      files: [{ path: two, providerAssetKey: gptAssetKey("resp-3", 0) }], // dup content → rejected
    }),
  )
  assert.equal(incomplete.status, "candidates-ready")
  assert.equal(incomplete.incomplete, true)
  assert.equal(incomplete.actualCount, 2)
  assert.equal(incomplete.baseRemaining, 0)

  // Zero-candidate job fails without auto-retry
  const zeroWs = mkdtempSync(join(tmpdir(), "web-imagegen-rgp05z-"))
  const zeroReq = writeJson(requestPath(zeroWs), {
    workspace: zeroWs,
    provider: "gpt",
    prompt: "empty",
    workflow: "user",
    selection: "group",
    count: 2,
    sessionID: "rgp-05z",
    goal: "empty",
  })
  const zeroInit = await initFromRequest(zeroReq)
  const zeroAttempt = await bindGptAttempt(zeroInit.jobDir, { assetKeys: [KEY_1_0] })
  await assert.rejects(
    () =>
      collectJob(
        zeroInit.jobDir,
        writeJson(join(zeroWs, ".web-imagegen", "empty.json"), {
          batchKey: zeroInit.batchKey,
          provider: "gpt",
          attemptId: zeroAttempt.attemptId,
          files: [],
        }),
      ),
    (error) => error.code === "timeout",
  )
})

test("RGP-06 provider mismatch on collect/choose/redraw leaves job bytes unchanged", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-rgp06-"))
  const img = await imageFile(join(workspace, "downloads"), "x.png", { color: "red" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "gpt",
    prompt: "mismatch",
    workflow: "ai",
    sessionID: "rgp-06",
    goal: "mismatch",
  })
  const initialized = await initFromRequest(request)
  const { attemptId, assetKeys } = await bindGptAttempt(initialized.jobDir, {
    assetKeys: [KEY_1_0, KEY_1_1],
  })
  const path = join(initialized.jobDir, "job.json")
  const before = readFileSync(path, "utf8")
  const mtime = statSync(path).mtimeMs

  await assert.rejects(
    () =>
      collectJob(
        initialized.jobDir,
        writeJson(join(workspace, ".web-imagegen", "wrong.json"), {
          batchKey: initialized.batchKey,
          provider: "grok",
          attemptId,
          files: [{ path: img, providerAssetKey: assetKeys[0] }],
        }),
      ),
    (error) => error.code === "provider-mismatch",
  )
  assert.equal(readFileSync(path, "utf8"), before)
  assert.equal(statSync(path).mtimeMs, mtime)

  // Collect correctly so choose/redraw mismatch can be checked on a ready job
  await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "ok.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId,
      files: [
        { path: img, providerAssetKey: assetKeys[0] },
        { path: await imageFile(join(workspace, "downloads"), "y.png", { color: "blue" }), providerAssetKey: assetKeys[1] },
      ],
    }),
  )
  const readyBytes = readFileSync(path, "utf8")
  await assert.rejects(
    () => chooseJob(initialized.jobDir, { source: "candidates", ids: "1", by: "agent", provider: "grok" }),
    (error) => error.code === "provider-mismatch",
  )
  assert.equal(readFileSync(path, "utf8"), readyBytes)
  assert.throws(
    () => redrawJob(initialized.jobDir, { provider: "grok" }),
    (error) => error.code === "provider-mismatch",
  )
  assert.equal(readFileSync(path, "utf8"), readyBytes)
})

test("RGP-07 redraw inherits provider and clears attempts", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-rgp07-"))
  const a = await imageFile(join(workspace, "downloads"), "a.png", { color: "black" })
  const b = await imageFile(join(workspace, "downloads"), "b.png", { color: "white" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "gpt",
    prompt: "poster",
    workflow: "ai",
    refine: 1,
    sessionID: "rgp-07",
    goal: "poster",
  })
  const initialized = await initFromRequest(request)
  const { attemptId, assetKeys } = await bindGptAttempt(initialized.jobDir, {
    assetKeys: [KEY_1_0, KEY_1_1],
  })
  await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "ready.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId,
      files: [
        { path: a, providerAssetKey: assetKeys[0] },
        { path: b, providerAssetKey: assetKeys[1] },
      ],
    }),
  )
  const redraw = redrawJob(initialized.jobDir, {
    refine: true,
    reason: "both weak",
    prompt: "poster with stronger contrast",
    provider: "gpt",
  })
  assert.equal(redraw.provider, "gpt")
  assert.equal(redraw.attemptCount, 0)
  assert.equal(redraw.refinementUsed, 1)
  assert.equal(redraw.baseRemaining, 2)
  assert.notEqual(redraw.jobDir, initialized.jobDir)
})

test("RGP-08 lock blocks mutating commands; bound job survives reload into collect", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-rgp08-"))
  const a = await imageFile(join(workspace, "downloads"), "a.png", { color: "red" })
  const b = await imageFile(join(workspace, "downloads"), "b.png", { color: "blue" })
  const request = writeJson(requestPath(workspace), {
    workspace,
    provider: "gpt",
    prompt: "lock",
    workflow: "ai",
    sessionID: "rgp-08",
    goal: "lock",
  })
  const initialized = await initFromRequest(request)
  const startInput = writeJson(join(workspace, ".web-imagegen", "start.json"), {
    batchKey: initialized.batchKey,
    provider: "gpt",
    purpose: "initial",
    prompt: "lock",
    browserContext: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      beforeResponseAnchor: "",
    },
  })
  writeFileSync(join(initialized.jobDir, ".runtime.lock"), "held")
  assert.throws(
    () => startAttemptJob(initialized.jobDir, startInput, { provider: "gpt" }),
    (error) => error.code === "busy",
  )
  assert.equal(existsSync(startInput), true)

  // Drop lock and continue through CLI-style start/bind then collect after "reload"
  const { unlinkSync } = await import("node:fs")
  unlinkSync(join(initialized.jobDir, ".runtime.lock"))
  const started = startAttemptJob(initialized.jobDir, startInput, { provider: "gpt" })
  assert.equal(started.attempt.status, "prepared")
  assert.equal(existsSync(startInput), false)

  const bindInput = writeJson(join(workspace, ".web-imagegen", "bind.json"), {
    batchKey: initialized.batchKey,
    attemptId: started.attempt.attemptId,
    provider: "gpt",
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      responseKey: RESP_1,
      assetKeys: [KEY_1_0, KEY_1_1],
    },
  })
  const bound = bindAttemptJob(initialized.jobDir, bindInput, { provider: "gpt" })
  assert.equal(bound.attempt.status, "bound")
  assert.equal(existsSync(bindInput), false)

  // Simulate process restart: clear nothing on disk; re-read and collect.
  const job = readJobFile(initialized.jobDir)
  assert.equal(job.activeAttemptId, started.attempt.attemptId)
  assert.equal(job.attempts[0].status, "bound")

  const ready = await collectJob(
    initialized.jobDir,
    writeJson(join(workspace, ".web-imagegen", "collect.json"), {
      batchKey: initialized.batchKey,
      provider: "gpt",
      attemptId: started.attempt.attemptId,
      files: [
        { path: a, providerAssetKey: KEY_1_0 },
        { path: b, providerAssetKey: KEY_1_1 },
      ],
    }),
  )
  assert.equal(ready.status, "candidates-ready")
  const chosen = await chooseJob(initialized.jobDir, {
    source: "candidates",
    ids: "1",
    by: "agent",
    provider: "gpt",
  })
  const replay = await chooseJob(initialized.jobDir, {
    source: "candidates",
    ids: "1",
    by: "agent",
    provider: "gpt",
  })
  assert.equal(replay.idempotent, true)
  assert.deepEqual(replay.saved, chosen.saved)
})
