import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ASPECTS,
  DEFAULTS,
  ERRORS,
  canStartNewBatch,
  chooseIdempotencyKey,
  outFormat,
  validateChoose,
  validateInit,
} from "../src/contract.mjs"

test("AI workflow is explicit and always requests two candidates", () => {
  assert.equal(validateInit({ workspace: "D:/work", prompt: "cat" }).error, "workflow-required")
  assert.equal(validateInit({ workspace: "D:/work", prompt: "cat", workflow: "ai" }).error, "invalid-provider")
  assert.equal(validateInit({ workspace: "D:/work", prompt: "cat", workflow: "ai", provider: "default" }).error, "invalid-provider")
  assert.equal(validateInit({ workspace: "D:/work", prompt: "cat", workflow: "ai", provider: "openai" }).error, "invalid-provider")
  const result = validateInit({ workspace: "D:/work", prompt: "16:9 banner", workflow: "ai", provider: "grok", count: 8 })
  assert.equal(result.ok, true)
  assert.equal(result.value.provider, "grok")
  assert.equal(result.value.selection, "single")
  assert.equal(result.value.requestedCount, 2)
  assert.equal(result.value.aspect, "16:9")
  assert.equal(result.value.quality, DEFAULTS.quality)
})

test("user workflow requires selection and never controls quality or aspect", () => {
  assert.equal(validateInit({ workspace: "D:/work", prompt: "cat", workflow: "user", provider: "grok" }).error, "selection-required")
  const result = validateInit({
    workspace: "D:/work",
    prompt: "原样提示",
    workflow: "user",
    provider: "gpt",
    selection: "group",
    count: 4,
    quality: "high",
    aspect: "1:1",
  })
  assert.equal(result.value.provider, "gpt")
  assert.equal(result.value.prompt, "原样提示")
  assert.equal(result.value.requestedCount, 4)
  assert.equal(result.value.quality, "auto")
  assert.equal(result.value.aspect, "auto")
  assert.equal(result.value.clickQuality, null)
  assert.equal(result.value.clickAspect, null)
  assert.equal(
    validateInit({
      workspace: "D:/work",
      prompt: "too many",
      workflow: "user",
      provider: "gpt",
      selection: "group",
      count: 5,
    }).error,
    "invalid-request",
  )
})

test("output and selection contract is closed and idempotent", () => {
  assert.equal(outFormat("chosen.webp").mime, "image/webp")
  assert.equal(outFormat("chosen.gif").error, "invalid-out-format")
  assert.equal(validateChoose({ batchKey: "b", source: "post", chosenBy: "agent" }).error, "invalid-request")
  assert.equal(chooseIdempotencyKey({ batchKey: "b", source: "candidates", ids: "2,1" }), "b::candidates::1,2")
  assert.equal(canStartNewBatch("generating").error, "batch-pending")
  assert.equal(canStartNewBatch("chosen").ok, true)
  assert.ok(ASPECTS.includes("2:3"))
  assert.ok(ERRORS.every((value) => /^[a-z0-9-]+$/.test(value)))
})
