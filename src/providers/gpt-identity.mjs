const VALIDATOR = "gpt-identity"
const GPT_ORIGIN = "https://chatgpt.com"

function failure(error, extra = {}) {
  return { ok: false, error, validator: VALIDATOR, ...extra }
}

export function gptAssetKey(responseKey, ordinal) {
  return `gpt:${responseKey}:${ordinal}`
}

export function parseGptAssetKey(key) {
  const m = /^gpt:([^:]+):(\d+)$/.exec(String(key || ""))
  if (!m) return null
  return { responseKey: m[1], ordinal: Number(m[2]) }
}

function historicSet(beforeKeys) {
  return new Set((beforeKeys || []).map(String))
}

function responsesAfterAnchor(responses, beforeResponseAnchor) {
  const list = Array.isArray(responses) ? responses : []
  if (beforeResponseAnchor == null || beforeResponseAnchor === "") {
    return list.filter((item) => item && item.responseKey)
  }
  const anchor = String(beforeResponseAnchor)
  const after = []
  let seenAnchor = false
  for (const item of list) {
    if (!item || item.responseKey == null || item.responseKey === "") continue
    const key = String(item.responseKey)
    if (!seenAnchor) {
      if (key === anchor) seenAnchor = true
      continue
    }
    after.push(item)
  }
  return after
}

function rejectAssetKind(asset) {
  const kind = String(asset?.kind || "").toLowerCase()
  if (kind === "attachment" || kind === "reference") return "reference-ambiguous"
  if (kind === "thumbnail" || kind === "data-uri" || kind === "data_uri") return "asset-identity-missing"
  if (asset?.dataUri || asset?.dataURI) return "asset-identity-missing"
  if ((asset?.mediaUrl || asset?.thumbnailUrl) && asset?.ordinal == null && asset?.providerAssetKey == null) {
    return "asset-identity-missing"
  }
  return null
}

function resolveAssets(responseKey, assets, assetKeys, historic) {
  if (Array.isArray(assets) && assets.length) {
    const keys = []
    for (const asset of assets) {
      const kindError = rejectAssetKind(asset)
      if (kindError) return failure(kindError)
      let ordinal = asset?.ordinal
      let key = asset?.providerAssetKey == null ? null : String(asset.providerAssetKey)
      if (key) {
        const parsed = parseGptAssetKey(key)
        if (!parsed || parsed.responseKey !== String(responseKey)) return failure("asset-identity-missing")
        ordinal = parsed.ordinal
        key = gptAssetKey(parsed.responseKey, parsed.ordinal)
      } else {
        if (ordinal == null || ordinal === "") return failure("asset-identity-missing")
        ordinal = Number(ordinal)
        if (!Number.isInteger(ordinal) || ordinal < 0) return failure("asset-identity-missing")
        key = gptAssetKey(responseKey, ordinal)
      }
      if (historic.has(key) || historic.has(String(ordinal))) return failure("asset-identity-missing")
      keys.push(key)
    }
    if (!keys.length) return failure("asset-identity-missing")
    return { ok: true, assetKeys: keys }
  }

  if (Array.isArray(assetKeys) && assetKeys.length) {
    const keys = []
    for (const raw of assetKeys) {
      const parsed = parseGptAssetKey(raw)
      if (!parsed || parsed.responseKey !== String(responseKey)) return failure("asset-identity-missing")
      const key = gptAssetKey(parsed.responseKey, parsed.ordinal)
      if (historic.has(key)) return failure("asset-identity-missing")
      keys.push(key)
    }
    return { ok: true, assetKeys: keys }
  }

  return failure("asset-identity-missing")
}

function finalize(responseKey, conversationKey, userTurnKey, assets, assetKeys, historic) {
  const resolved = resolveAssets(responseKey, assets, assetKeys, historic)
  if (!resolved.ok) return resolved
  return {
    ok: true,
    provider: "gpt",
    contextKey: String(conversationKey),
    responseKey: String(responseKey),
    assetKeys: resolved.assetKeys,
    userTurnKey: userTurnKey == null ? null : String(userTurnKey),
    validator: VALIDATOR,
  }
}

/**
 * Validate a plain GPT observation against frozen attempt browser context.
 * Never returns opaque media URLs — only closed error codes or stable asset keys.
 */
export function validateGptIdentity({ observation = {}, expected = {}, beforeKeys } = {}) {
  const origin = String(
    observation.origin != null && observation.origin !== ""
      ? observation.origin
      : expected.origin || "",
  )
  if (origin !== GPT_ORIGIN) return failure("wrong-provider-page")

  const expectedConversation =
    expected.conversationKey == null ? observation.expectedConversationKey : expected.conversationKey
  let conversationKey = null
  if (observation.conversationKey != null && observation.conversationKey !== "") {
    conversationKey = String(observation.conversationKey)
    if (expectedConversation != null && conversationKey !== String(expectedConversation)) {
      return failure("conversation-changed")
    }
  } else if (expectedConversation != null && expectedConversation !== "") {
    conversationKey = String(expectedConversation)
  }
  if (!conversationKey) return failure("ui-changed")

  const beforeAnchor =
    expected.beforeResponseAnchor != null
      ? expected.beforeResponseAnchor
      : observation.beforeResponseAnchor != null
        ? observation.beforeResponseAnchor
        : null
  const historic = historicSet(beforeKeys || observation.beforeKeys)

  if (Array.isArray(observation.responses)) {
    const after = responsesAfterAnchor(observation.responses, beforeAnchor)
    if (after.length !== 1) return failure("response-ambiguous")
    const response = after[0]
    const responseKey = String(response.responseKey)
    return finalize(
      responseKey,
      conversationKey,
      response.userTurnKey ?? observation.userTurnKey,
      response.assets || observation.assets,
      response.assetKeys || observation.assetKeys,
      historic,
    )
  }

  if (observation.responseKey != null && observation.responseKey !== "") {
    const responseKey = String(observation.responseKey)
    if (beforeAnchor != null && beforeAnchor !== "" && responseKey === String(beforeAnchor)) {
      return failure("response-ambiguous")
    }
    return finalize(
      responseKey,
      conversationKey,
      observation.userTurnKey,
      observation.assets,
      observation.assetKeys,
      historic,
    )
  }

  if (observation.mediaUrl || observation.thumbnailUrl || observation.dataUri || observation.dataURI) {
    return failure("asset-identity-missing")
  }

  return failure("ui-changed")
}
