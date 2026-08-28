import { urlKey } from "./candidates.mjs"
import { chooseIdempotencyKey, normalizeIds } from "./contract.mjs"

export function parsePostId(url) {
  const m = /\/imagine\/post\/([0-9a-f-]{8,})/i.exec(String(url || ""))
  return m ? m[1] : null
}

export function postUrlMeansComplete() {
  return false
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

function expandedKeySet(keys) {
  const out = new Set()
  for (const key of asKeySet(keys)) addIdentity(out, key)
  return out
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

export function choosePostFromSnapshot(job, snap = {}) {
  if (!job) return { status: "no-job", error: "no-job", refresh: false }
  if (job.state === "selection-expired" || snap.browserOpen === false) {
    return { status: "selection-expired", error: "selection-expired", refresh: false }
  }
  const source = "post"
  const idem = chooseIdempotencyKey({ batchKey: job.batchKey, source, ids: "" })
  if (job.state === "chosen" && job.idempotencyKey === idem) {
    return {
      status: "chosen",
      idempotent: true,
      saved: job.saved || [],
      chosenId: job.chosenId,
      chosenBy: job.chosenBy || "user",
      refresh: false,
    }
  }
  if (job.state !== "awaiting-user-selection") {
    return { status: "selection-not-ready", error: "selection-not-ready", refresh: false }
  }
  const v = validatePostSelection({
    pageUrl: snap.pageUrl,
    mainSrc: snap.mainSrc,
    mainLoaded: snap.mainLoaded,
    candidateKeys: job.candidateKeys,
    beforeKeys: job.beforeKeys,
  })
  if (v.status !== "ok") return v
  return { status: "ready-to-save", postId: v.postId, key: v.key, refresh: false, idempotencyKey: idem }
}

export function interpretUserIntent({ phase, text } = {}) {
  const t = String(text || "")
  if (phase === "before-generate") {
    if (/全都要|一组|多张|全部都要|生成\s*\d+\s*张/i.test(t)) {
      return { selection: "group", chooseNow: false }
    }
    return { selection: null, chooseNow: false }
  }
  if (phase === "after-ready") {
    if (/^(全部|全都要|all)$/i.test(t.trim())) return { ids: "all", chooseNow: true }
    const nums = t.match(/\d+/g)
    if (nums?.length) return { ids: nums.join(","), chooseNow: true }
    if (/重画|redraw/i.test(t)) return { action: "redraw", chooseNow: false }
    if (/取消|cancel/i.test(t)) return { action: "cancel", chooseNow: false }
  }
  return { chooseNow: false }
}

export function gateGroupChoose(job, { ids, action } = {}) {
  if (!job) return { ok: false, error: "no-job" }
  if (action === "cancel" || action === "redraw") {
    if (!["candidates-ready", "awaiting-user-selection"].includes(job.state)) {
      return { ok: false, error: "batch-not-ready" }
    }
    return { ok: true, action, refresh: action === "cancel" || action === "redraw" }
  }
  if (job.state !== "candidates-ready") return { ok: false, error: "candidates-not-ready" }
  const list = normalizeIds(ids)
  if (!list.length) return { ok: false, error: "ids-required" }
  const have = new Set((job.candidates || []).map((c) => String(c.id)))
  if (list[0] !== "all") {
    for (const id of list) {
      if (!have.has(String(id))) return { ok: false, error: "unknown-id" }
    }
  }
  return { ok: true, ids: list, refresh: true }
}

export function resolveGroupCollect({ items, requestedCount } = {}) {
  const list = Array.isArray(items) ? items : []
  const requested = Math.max(1, Math.min(8, Number(requestedCount) || list.length || 1))
  if (!list.length) {
    return {
      status: "timeout",
      error: "timeout",
      autoRetry: false,
      candidates: [],
      requestedCount: requested,
      actualCount: 0,
      incomplete: true,
    }
  }
  const take = list.slice(0, requested)
  return {
    status: "candidates-ready",
    autoRetry: false,
    candidates: take,
    requestedCount: requested,
    actualCount: take.length,
    incomplete: take.length < requested,
    refresh: false,
    writeChosen: false,
  }
}

export function resolveInteractiveGenerate({ selection, items, requestedCount } = {}) {
  if (selection === "group") return resolveGroupCollect({ items, requestedCount })
  const keys = candidateIdentityKeys(items)
  const actualCount = (items || []).length
  return {
    status: "awaiting-user-selection",
    selection: "single",
    candidateKeys: keys,
    requestedCount: 1,
    actualCount,
    incomplete: actualCount < 1,
    writeChosen: false,
    refresh: false,
    needCollectMode: false,
    next: "Tell the user to click a current-batch image, then reply 选好了.",
  }
}

export function replayChoose(job, { source, ids } = {}) {
  const key = chooseIdempotencyKey({ batchKey: job?.batchKey, source, ids })
  if (job?.state === "chosen" && job.idempotencyKey === key) {
    return { idempotent: true, key, result: job.lastChooseResult || { status: "chosen", saved: job.saved || [] } }
  }
  if (job?.state === "chosen") {
    return { idempotent: true, key, different: true, result: job.lastChooseResult || { status: "chosen", saved: job.saved || [] } }
  }
  return { idempotent: false, key }
}
