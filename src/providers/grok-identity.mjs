import { urlKey } from "../candidates.mjs"

const VALIDATOR = "grok-identity"

function failure(error, extra = {}) {
  return { ok: false, error, validator: VALIDATOR, ...extra }
}

function asKeySet(keys) {
  if (!keys) return new Set()
  if (keys instanceof Set) return keys
  return new Set(keys)
}

function addIdentity(out, value) {
  const raw = String(value || "").trim()
  if (!raw) return
  out.add(raw)
  const key = urlKey(raw)
  if (key) out.add(key)
  const generated = /\/generated\/([^/?#]+)/i.exec(raw)?.[1]
  for (const id of [generated, raw.match(/^[0-9a-f-]+(?:-part-\d+)?$/i) ? raw : null]) {
    if (!id) continue
    out.add(id)
    out.add(id.replace(/-part-\d+$/i, ""))
  }
}

function expandedKeySet(keys) {
  const out = new Set()
  for (const key of asKeySet(keys)) addIdentity(out, key)
  return out
}

function isGrokOrigin(origin) {
  if (origin == null || origin === "") return null
  try {
    const host = new URL(String(origin)).hostname.toLowerCase()
    return host === "grok.com" || host.endsWith(".grok.com")
  } catch {
    return false
  }
}

export function parsePostId(url) {
  const m = /\/imagine\/post\/([0-9a-f-]{8,})/i.exec(String(url || ""))
  return m ? m[1] : null
}

export function postUrlMeansComplete() {
  return false
}

export function candidateIdentityKeys(items) {
  const out = new Set()
  for (const item of items || []) {
    const asset = item?.asset || item || {}
    addIdentity(out, item?.key)
    addIdentity(out, item?.src || item?.url)
    addIdentity(out, item?.assetId || asset?.assetId)
    addIdentity(out, item?.responseId || asset?.responseId)
  }
  return [...out]
}

export function validatePostSelection({ pageUrl, mainSrc, mainLoaded, candidateKeys, beforeKeys } = {}) {
  const postId = parsePostId(pageUrl)
  if (!postId) return { status: "selection-not-ready", error: "selection-not-ready", refresh: false }
  if (mainLoaded === false || !mainSrc) {
    return { status: "selection-not-ready", error: "selection-not-ready", refresh: false, postId }
  }
  const key = urlKey(mainSrc)
  const allowed = expandedKeySet(candidateKeys)
  const historic = asKeySet(beforeKeys)
  if (historic.has(key) && !allowed.has(key)) {
    return { status: "selection-stale", error: "selection-stale", refresh: false, postId, key }
  }
  if (allowed.size && !allowed.has(key) && !allowed.has(postId) && !allowed.has(mainSrc)) {
    return { status: "selection-stale", error: "selection-stale", refresh: false, postId, key }
  }
  return { status: "ok", postId, key, refresh: false }
}

/**
 * Provider identity entry for attempt-bind and selection proofs.
 * Accepts plain observation objects only — no DOM or browser handles.
 */
export function validateGrokIdentity({ observation = {}, expected = {}, beforeKeys } = {}) {
  const originCheck = isGrokOrigin(observation.origin)
  if (originCheck === false) return failure("wrong-provider-page")

  const pageUrl = observation.pageUrl || observation.url || ""
  if (/chatgpt\.com/i.test(pageUrl) || /chatgpt\.com/i.test(String(observation.origin || ""))) {
    return failure("wrong-provider-page")
  }

  if (pageUrl || observation.mainSrc != null) {
    const selected = validatePostSelection({
      pageUrl,
      mainSrc: observation.mainSrc,
      mainLoaded: observation.mainLoaded,
      candidateKeys: observation.candidateKeys || observation.assetKeys,
      beforeKeys: beforeKeys || observation.beforeKeys,
    })
    if (selected.status !== "ok") {
      return failure(selected.error || selected.status)
    }
    const assetKeys = Array.isArray(observation.assetKeys) && observation.assetKeys.length
      ? observation.assetKeys.map(String)
      : selected.key
        ? [String(selected.key)]
        : [String(selected.postId)]
    return {
      ok: true,
      provider: "grok",
      contextKey: String(selected.postId),
      responseKey: String(observation.responseKey || selected.postId),
      assetKeys,
      userTurnKey: observation.userTurnKey == null ? null : String(observation.userTurnKey),
      validator: VALIDATOR,
    }
  }

  if (observation.responseKey != null && Array.isArray(observation.assetKeys)) {
    const postId = parsePostId(pageUrl) || String(observation.responseKey)
    if (!postId) return failure("asset-identity-missing")
    if (!observation.assetKeys.length) return failure("asset-identity-missing")
    return {
      ok: true,
      provider: "grok",
      contextKey: String(postId),
      responseKey: String(observation.responseKey),
      assetKeys: observation.assetKeys.map(String),
      userTurnKey: observation.userTurnKey == null ? null : String(observation.userTurnKey),
      validator: VALIDATOR,
    }
  }

  return failure("asset-identity-missing")
}
