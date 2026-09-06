import { snapshotDownloadFiles } from "../download-snapshot.mjs"

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function providerFilePattern(responseId) {
  const id = String(responseId || "").trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("invalid-request")
  }
  return new RegExp(`^grok-image-${escapeRegex(id)}(?: \\(\\d+\\))?\\.(?:jpe?g|png|webp)$`, "i")
}

/**
 * Snapshot only files whose names match the frozen Grok Post UUID pattern.
 * Unrelated download filenames stay out of the snapshot.
 */
export function snapshotDownloads(directory, { responseId } = {}) {
  const namePattern = providerFilePattern(responseId)
  return snapshotDownloadFiles(directory).filter((entry) => namePattern.test(entry.name))
}

/**
 * Resolve the single new/changed Grok provider file for a frozen response ID.
 * `allowExisting=true` may reuse exactly one pre-existing match; never picks by mtime.
 */
export function resolveProviderDownload({ before = [], after = [], responseId, allowExisting = false } = {}) {
  const namePattern = providerFilePattern(responseId)
  const previous = new Map(before.map((item) => [String(item.path).toLowerCase(), item]))
  const exact = after.filter((item) => namePattern.test(item.name))
  const changed = exact.filter((item) => {
    const old = previous.get(String(item.path).toLowerCase())
    return !old || old.size !== item.size || old.mtimeMs !== item.mtimeMs
  })
  if (changed.length === 1) return { ...changed[0], reused: false }
  if (changed.length > 1) throw new Error("download-ambiguous")
  if (!allowExisting || exact.length === 0) throw new Error("download-missing")
  if (exact.length !== 1) throw new Error("download-ambiguous")
  return { ...exact[0], reused: true }
}
