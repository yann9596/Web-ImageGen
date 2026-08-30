import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function providerFilePattern(responseId) {
  const id = String(responseId || "").trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("invalid-request")
  return new RegExp(`^grok-image-${escapeRegex(id)}(?: \\(\\d+\\))?\\.(?:jpe?g|png|webp)$`, "i")
}

export function snapshotDownloads(directory, { responseId } = {}) {
  const namePattern = providerFilePattern(responseId)
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && namePattern.test(entry.name))
    .map((entry) => {
      const path = join(directory, entry.name)
      const stat = statSync(path)
      return { name: entry.name, path, size: stat.size, mtimeMs: stat.mtimeMs }
    })
}

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
