import { createHash } from "node:crypto"
import { extname } from "node:path"

export function isPlaceholderSrc(src) {
  const s = String(src || "")
  if (!s) return true
  if (s.startsWith("post:")) return false
  if (!s.startsWith("data:")) return false
  const comma = s.indexOf(",")
  if (comma < 0) return true
  return s.length - comma < 80
}

export function urlKey(url) {
  const s = String(url || "")
  if (!s) return null
  if (s.startsWith("post:")) return s
  if (isPlaceholderSrc(s)) return null
  if (s.startsWith("data:")) return `data:${s.length}:${s.slice(0, 64)}:${s.slice(-48)}`
  if (s.startsWith("blob:")) return s
  try {
    const u = new URL(s)
    return u.origin + u.pathname
  } catch {
    return s
  }
}

export function contentKey(buf) {
  if (!buf || !buf.length) return null
  return createHash("sha256").update(buf).digest("hex").slice(0, 24)
}

function u32(buf, i) {
  return buf.readUInt32BE(i)
}

function inspectJpeg(buf) {
  if (buf.length < 4) return { ok: false, error: "truncated" }
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) return { ok: false, error: "truncated" }
  let i = 2
  let width = 0
  let height = 0
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = buf[i + 1]
    if (marker === 0xd9) break
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (i + 3 >= buf.length) return { ok: false, error: "truncated" }
    const len = buf.readUInt16BE(i + 2)
    if (len < 2 || i + 2 + len > buf.length) return { ok: false, error: "truncated" }
    // SOS is followed by entropy-coded scan data, where 0xff bytes are not
    // ordinary metadata segment markers. The final EOI check above proves the
    // scan is complete, so metadata parsing must stop at the first scan.
    if (marker === 0xda) break
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (len < 7) return { ok: false, error: "undecodable" }
      height = buf.readUInt16BE(i + 5)
      width = buf.readUInt16BE(i + 7)
    }
    i += 2 + len
  }
  if (!width || !height) return { ok: false, error: "invalid-size" }
  return { ok: true, type: "image/jpeg", ext: ".jpg", width, height }
}

function inspectPng(buf) {
  if (buf.length < 24) return { ok: false, error: "truncated" }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return { ok: false, error: "undecodable" }
  if (buf.toString("ascii", 12, 16) !== "IHDR") return { ok: false, error: "undecodable" }
  const width = u32(buf, 16)
  const height = u32(buf, 20)
  const end = buf.toString("ascii", buf.length - 8, buf.length - 4)
  if (end !== "IEND") return { ok: false, error: "truncated" }
  if (!width || !height) return { ok: false, error: "invalid-size" }
  return { ok: true, type: "image/png", ext: ".png", width, height }
}

function inspectWebp(buf) {
  if (buf.length < 20) return { ok: false, error: "truncated" }
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    return { ok: false, error: "undecodable" }
  }
  const fourcc = buf.toString("ascii", 12, 16)
  let width = 0
  let height = 0
  if (fourcc === "VP8X" && buf.length >= 30) {
    width = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16)
    height = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16)
  } else if (fourcc === "VP8 " && buf.length >= 30) {
    width = buf.readUInt16LE(26) & 0x3fff
    height = buf.readUInt16LE(28) & 0x3fff
  } else if (fourcc === "VP8L" && buf.length >= 25) {
    const bits = buf.readUInt32LE(21)
    width = (bits & 0x3fff) + 1
    height = ((bits >> 14) & 0x3fff) + 1
  } else {
    return { ok: false, error: "truncated" }
  }
  if (!width || !height) return { ok: false, error: "invalid-size" }
  return { ok: true, type: "image/webp", ext: ".webp", width, height }
}

export function inspectImage(buf) {
  if (!buf || !buf.length) return { ok: false, error: "empty" }
  if (buf[0] === 0xff && buf[1] === 0xd8) return inspectJpeg(buf)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return inspectPng(buf)
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return inspectWebp(buf)
  }
  return { ok: false, error: "undecodable" }
}

export function extMatchesType(filePath, type) {
  const ext = extname(String(filePath || "")).toLowerCase()
  if (!ext) return true
  if (type === "image/jpeg") return ext === ".jpg" || ext === ".jpeg"
  if (type === "image/png") return ext === ".png"
  if (type === "image/webp") return ext === ".webp"
  return false
}

export function isBlockedSrc(src) {
  const s = String(src || "")
  return s.includes("agent-skills") || s.includes("preview_image")
}

export function isCandidateImageSrc(src) {
  const s = String(src || "")
  if (!s || isBlockedSrc(s) || isPlaceholderSrc(s)) return false
  if (s.startsWith("data:image/") || s.startsWith("blob:")) return true
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export function isLowResolutionDataPreview(src, width, height, minLongEdge = 512) {
  const s = String(src || "")
  if (!s.startsWith("data:image/")) return false
  const w = Number(width) || 0
  const h = Number(height) || 0
  return w > 0 && h > 0 && Math.max(w, h) < minLongEdge
}

export function hasMinimumLongEdge(width, height, minLongEdge = 512) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  return w > 0 && h > 0 && Math.max(w, h) >= minLongEdge
}

export function collectFreshNetworkCandidates(captured, fromIndex = 0, minLongEdge = 512, minStartedAt = 0) {
  const out = []
  const start = Math.max(0, Number(fromIndex) || 0)
  for (const item of (captured || []).slice(start)) {
    if (minStartedAt && item?.startedAt && item.startedAt < minStartedAt) continue
    const src = String(item?.url || item?.src || "")
    const isGenerated = src.startsWith("blob:") || /\/generated\/[^/]+\/image\.[a-z0-9]+(?:\?|$)/i.test(src)
    if (!isGenerated || isBlockedSrc(src)) continue
    const info = inspectImage(item?.buf)
    if (!info.ok || !hasMinimumLongEdge(info.width, info.height, minLongEdge)) continue
    out.push({
      ...item,
      src,
      url: src,
      key: item.key || item.k || urlKey(src),
      w: info.width,
      h: info.height,
      width: info.width,
      height: info.height,
      type: info.type,
    })
  }
  return out
}

export function acceptCandidate(item, { beforeKeys, seenKeys, seenContent } = {}) {
  const src = item?.src || item?.url || ""
  if (isPlaceholderSrc(src) && !item?.buf) return { ok: false, error: "placeholder" }
  if (isBlockedSrc(src)) return { ok: false, error: "blocked-src" }
  if (item?.sidebar) return { ok: false, error: "sidebar" }
  let key = item.key || urlKey(src)
  if (!key && !item?.buf) return { ok: false, error: "placeholder" }
  if (key && beforeKeys && beforeKeys.has(key)) return { ok: false, error: "historic" }
  if (key && seenKeys && seenKeys.has(key)) return { ok: false, error: "dup-resource" }
  const buf = item.buf
  const info = inspectImage(buf)
  if (!info.ok) return { ok: false, error: info.error, key }
  if (item.path && !extMatchesType(item.path, info.type)) return { ok: false, error: "ext-mismatch", key, type: info.type }
  const ck = contentKey(buf)
  if (!key) key = ck
  if (ck && seenContent && seenContent.has(ck)) return { ok: false, error: "dup-content", key }
  if (key && seenKeys && seenKeys.has(key)) return { ok: false, error: "dup-resource" }
  return { ok: true, key, contentKey: ck, type: info.type, ext: info.ext, width: info.width, height: info.height }
}

export function collectAccepted(items, { beforeKeys, requestedCount } = {}) {
  const seenKeys = new Set()
  const seenContent = new Set()
  const accepted = []
  const rejected = []
  const before = beforeKeys instanceof Set ? beforeKeys : new Set(beforeKeys || [])
  for (const item of items || []) {
    const result = acceptCandidate(item, { beforeKeys: before, seenKeys, seenContent })
    if (!result.ok) {
      rejected.push({ error: result.error, src: (item.src || item.url || "").slice(0, 200) })
      continue
    }
    seenKeys.add(result.key)
    if (result.contentKey) seenContent.add(result.contentKey)
    accepted.push({ ...item, ...result })
    if (requestedCount && accepted.length >= requestedCount) break
  }
  const requested = requestedCount || accepted.length
  return {
    candidates: accepted,
    rejected,
    requestedCount: requested,
    actualCount: accepted.length,
    incomplete: accepted.length < requested,
  }
}

export const WORKFLOW_NEED = 2

export function resolveWorkflowCollect(batches, { need = WORKFLOW_NEED, maxAttempts = 2 } = {}) {
  const seenKeys = new Set()
  const seenContent = new Set()
  const accepted = []
  const rejected = []
  for (const batch of batches || []) {
    for (const item of batch || []) {
      const result = acceptCandidate(item, { seenKeys, seenContent })
      if (!result.ok) {
        rejected.push({ error: result.error, src: (item.src || item.url || "").slice(0, 200) })
        continue
      }
      seenKeys.add(result.key)
      if (result.contentKey) seenContent.add(result.contentKey)
      accepted.push({ ...item, ...result })
      if (accepted.length >= need) {
        return {
          status: "candidates-ready",
          candidates: accepted.slice(0, need),
          requestedCount: need,
          actualCount: need,
          incomplete: false,
          rejected,
          openFolder: false,
          refresh: false,
          askUser: false,
          retried: (batches || []).length > 1,
        }
      }
    }
  }
  const attempts = (batches || []).length
  if (attempts < maxAttempts) {
    return {
      status: "retry",
      candidates: accepted,
      requestedCount: need,
      actualCount: accepted.length,
      incomplete: true,
      rejected,
      openFolder: false,
      refresh: false,
      askUser: false,
      retried: false,
    }
  }
  return {
    status: "insufficient-candidates",
    error: "insufficient-candidates",
    candidates: [],
    leftover: accepted,
    requestedCount: need,
    actualCount: accepted.length,
    incomplete: true,
    rejected,
    openFolder: false,
    refresh: false,
    askUser: false,
    retried: attempts > 1,
  }
}
