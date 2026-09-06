import { existsSync, statSync } from "node:fs"
import { basename, extname } from "node:path"
import { DOWNLOAD_IMAGE_EXTENSIONS, changedDownloads } from "../download-snapshot.mjs"

const SUPPORTED_EXT = new Set(DOWNLOAD_IMAGE_EXTENSIONS)

function isSupportedImageName(nameOrPath) {
  return SUPPORTED_EXT.has(extname(String(nameOrPath || "")).toLowerCase())
}

/**
 * Prefer a Chrome-materialized absolute local path.
 * Rejects missing paths, directories, and unsupported extensions.
 * Does not treat filename tokens (e.g. responseKey) as asset identity.
 */
export function resolveDirectDownloadPath(directPath) {
  const path = String(directPath || "").trim()
  if (!path) throw new Error("download-missing")
  if (!existsSync(path)) throw new Error("download-missing")
  let stat
  try {
    stat = statSync(path)
  } catch {
    throw new Error("download-missing")
  }
  if (!stat.isFile()) throw new Error("invalid-request")
  if (!isSupportedImageName(path)) throw new Error("ext-mismatch")
  return {
    name: basename(path),
    path,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    reused: false,
    source: "direct",
  }
}

/**
 * GPT download resolver.
 * Priority: exact Chrome direct path, then unique before/after image delta.
 * No allowExisting, no mtime-newest selection, no filename-as-identity shortcut.
 */
export function resolveGptDownload({ before = [], after = [], directPath = null } = {}) {
  if (directPath != null && String(directPath).trim() !== "") {
    return resolveDirectDownloadPath(directPath)
  }
  const changed = changedDownloads(before, after, { extensions: DOWNLOAD_IMAGE_EXTENSIONS })
  if (changed.length === 1) {
    return { ...changed[0], reused: false, source: "delta" }
  }
  if (changed.length === 0) throw new Error("download-missing")
  throw new Error("download-ambiguous")
}
