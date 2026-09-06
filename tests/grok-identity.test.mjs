import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  candidateIdentityKeys,
  parsePostId,
  validateGrokIdentity,
  validatePostSelection,
} from "../src/providers/grok-identity.mjs"

const ROOT = join(import.meta.dirname, "..")

test("GI-01 Grok post UUID, historic, current asset, and replay selection stay stable", () => {
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  const url = `https://assets.grok.com/users/u/generated/${id}-part-0/image.jpg?cache=1`
  const pageUrl = `https://grok.com/imagine/post/${id}`
  assert.equal(parsePostId(pageUrl), id)

  const keys = candidateIdentityKeys([{ src: url, assetId: `${id}-part-0`, responseId: id }])
  assert.ok(keys.includes(id))
  assert.ok(keys.includes(`${id}-part-0`))

  assert.equal(
    validatePostSelection({
      pageUrl,
      mainSrc: url,
      mainLoaded: true,
      candidateKeys: keys,
    }).status,
    "ok",
  )

  assert.equal(
    validatePostSelection({
      pageUrl,
      mainSrc: url,
      mainLoaded: true,
      candidateKeys: keys,
      beforeKeys: keys,
    }).status,
    "ok",
  )

  const historicOther = "https://assets.grok.com/users/u/generated/ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb-part-0/image.jpg"
  assert.equal(
    validatePostSelection({
      pageUrl,
      mainSrc: historicOther,
      mainLoaded: true,
      candidateKeys: keys,
      beforeKeys: candidateIdentityKeys([{ src: historicOther }]),
    }).status,
    "selection-stale",
  )

  const identity = validateGrokIdentity({
    observation: {
      origin: "https://grok.com",
      pageUrl,
      mainSrc: url,
      mainLoaded: true,
      candidateKeys: keys,
    },
  })
  assert.equal(identity.ok, true)
  assert.equal(identity.provider, "grok")
  assert.equal(identity.contextKey, id)
  assert.equal(identity.validator, "grok-identity")
})

test("GI-01b GPT observation fails under Grok identity", () => {
  const result = validateGrokIdentity({
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv-1",
      responseKey: "resp-1",
      assetKeys: ["gpt:resp-1:0"],
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, "wrong-provider-page")
  assert.equal(result.validator, "grok-identity")
})

test("select.mjs no longer embeds Grok URL knowledge", () => {
  const src = readFileSync(join(ROOT, "src", "select.mjs"), "utf8")
  assert.doesNotMatch(src, /grok\.com/)
  assert.doesNotMatch(src, /\/imagine\/post\//)
})
