import { readdirSync, statSync } from "node:fs"
import { extname, join } from "node:path"

export const DOWNLOAD_IMAGE_EXTENSIONS = Object.freeze([".jpg", ".jpeg", ".png", ".webp"])

/**
 * Enumerate ordinary files in a download directory.
 * Records absolute path, size, and mtimeMs for internal before/after comparison only.
 * Does not sort by mtime or pick a "latest" file.
 */
export function snapshotDownloadFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(directory, entry.name)
      const stat = statSync(path)
      return { name: entry.name, path, size: stat.size, mtimeMs: stat.mtimeMs }
    })
}

/**
 * Return files present in `after` that are new or changed vs `before`.
 * Optional `extensions` filters by lowercase extension (e.g. [".jpg", ".png"]).
 * Never selects by recency.
 */
export function changedDownloads(before = [], after = [], { extensions } = {}) {
  const previous = new Map((before || []).map((item) => [String(item.path).toLowerCase(), item]))
  const extSet = Array.isArray(extensions) && extensions.length
    ? new Set(extensions.map((value) => String(value).toLowerCase()))
    : null
  return (after || []).filter((item) => {
    if (extSet) {
      const ext = extname(String(item.name || item.path || "")).toLowerCase()
      if (!extSet.has(ext)) return false
    }
    const old = previous.get(String(item.path).toLowerCase())
    return !old || old.size !== item.size || old.mtimeMs !== item.mtimeMs
  })
}

/**
 * Public debug summary. With `redacted: true` only counts are returned — no filenames.
 */
export function summarizeDownloadSnapshot(snapshot, { redacted = true } = {}) {
  const files = Array.isArray(snapshot) ? snapshot : []
  if (redacted) {
    return { count: files.length }
  }
  return {
    count: files.length,
    names: files.map((item) => String(item.name || "")),
  }
}
