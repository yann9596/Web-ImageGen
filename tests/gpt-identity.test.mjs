import { test } from "node:test"
import assert from "node:assert/strict"
import { gptAssetKey, validateGptIdentity } from "../src/providers/gpt-identity.mjs"

const expected = {
  conversationKey: "conv-1",
  beforeResponseAnchor: "anchor-0",
}

test("GPTI-01 legal response yields stable gpt asset keys", () => {
  const first = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      userTurnKey: "turn-1",
      responses: [
        { responseKey: "anchor-0", assets: [{ ordinal: 0, kind: "generated" }] },
        { responseKey: "resp-1", assets: [{ ordinal: 0, kind: "generated" }, { ordinal: 1, kind: "generated" }] },
      ],
    },
    expected,
  })
  assert.equal(first.ok, true)
  assert.equal(first.provider, "gpt")
  assert.equal(first.contextKey, "conv-1")
  assert.equal(first.responseKey, "resp-1")
  assert.deepEqual(first.assetKeys, ["gpt:resp-1:0", "gpt:resp-1:1"])
  assert.equal(first.validator, "gpt-identity")

  const replay = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      responseKey: "resp-1",
      assetKeys: ["gpt:resp-1:0", "gpt:resp-1:1"],
    },
    expected,
  })
  assert.equal(replay.ok, true)
  assert.deepEqual(replay.assetKeys, first.assetKeys)
  assert.equal(gptAssetKey("resp-1", 0), "gpt:resp-1:0")
})

test("GPTI-02 wrong page origin is rejected", () => {
  const result = validateGptIdentity({
    observation: {
      origin: "https://grok.com",
      conversationKey: "conv-1",
      responseKey: "resp-1",
      assetKeys: ["gpt:resp-1:0"],
    },
    expected,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, "wrong-provider-page")
  assert.equal(result.validator, "gpt-identity")
  assert.equal("assetKeys" in result, false)
})

test("GPTI-03 conversation switch is rejected", () => {
  const result = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-other",
      responseKey: "resp-1",
      assetKeys: ["gpt:resp-1:0"],
    },
    expected,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, "conversation-changed")
})

test("GPTI-04 zero or multiple after-anchor responses are ambiguous", () => {
  const zero = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      responses: [{ responseKey: "anchor-0", assets: [{ ordinal: 0, kind: "generated" }] }],
    },
    expected,
  })
  assert.equal(zero.ok, false)
  assert.equal(zero.error, "response-ambiguous")

  const many = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      responses: [
        { responseKey: "anchor-0", assets: [{ ordinal: 0, kind: "generated" }] },
        { responseKey: "resp-1", assets: [{ ordinal: 0, kind: "generated" }] },
        { responseKey: "resp-2", assets: [{ ordinal: 0, kind: "generated" }] },
      ],
    },
    expected,
  })
  assert.equal(many.ok, false)
  assert.equal(many.error, "response-ambiguous")
})

test("GPTI-05 historic response or beforeKeys asset is rejected", () => {
  const beforeAnchor = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      responses: [
        { responseKey: "old-resp", assets: [{ ordinal: 0, kind: "generated" }] },
        { responseKey: "anchor-0", assets: [{ ordinal: 0, kind: "generated" }] },
      ],
    },
    expected,
  })
  assert.equal(beforeAnchor.ok, false)
  assert.equal(beforeAnchor.error, "response-ambiguous")

  const historicAsset = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      responses: [
        { responseKey: "anchor-0", assets: [{ ordinal: 0, kind: "generated" }] },
        { responseKey: "resp-1", assets: [{ ordinal: 0, kind: "generated" }] },
      ],
    },
    expected,
    beforeKeys: ["gpt:resp-1:0"],
  })
  assert.equal(historicAsset.ok, false)
  assert.equal(historicAsset.error, "asset-identity-missing")
})

test("GPTI-06 reference attachments are excluded", () => {
  const result = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      responses: [
        { responseKey: "anchor-0", assets: [] },
        {
          responseKey: "resp-1",
          assets: [{ ordinal: 0, kind: "attachment", width: 1024, height: 1024 }],
        },
      ],
    },
    expected,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, "reference-ambiguous")
})

test("GPTI-07 media URL thumbnail or data URI without response ordinal is missing", () => {
  const mediaOnly = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      mediaUrl: "https://example.invalid/image.png",
    },
    expected,
  })
  assert.equal(mediaOnly.ok, false)
  assert.equal(mediaOnly.error, "asset-identity-missing")

  const thumbnail = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      responses: [
        { responseKey: "anchor-0", assets: [] },
        { responseKey: "resp-1", assets: [{ kind: "thumbnail", mediaUrl: "https://example.invalid/thumb.jpg" }] },
      ],
    },
    expected,
  })
  assert.equal(thumbnail.ok, false)
  assert.equal(thumbnail.error, "asset-identity-missing")

  const dataUri = validateGptIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      dataUri: "data:image/png;base64,aaa",
    },
    expected,
  })
  assert.equal(dataUri.ok, false)
  assert.equal(dataUri.error, "asset-identity-missing")
})
