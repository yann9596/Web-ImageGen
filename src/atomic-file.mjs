import { mkdirSync, renameSync, unlinkSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import { randomBytes } from "node:crypto"

function fail(error, detail, extra = {}) {
  const e = new Error(detail || error)
  e.code = error
  Object.assign(e, extra)
  throw e
}

function defaultIo() {
  return {
    mkdirSync,
    writeFileSync,
    renameSync,
    unlinkSync,
    existsSync,
    readFileSync,
    randomBytes,
  }
}

/**
 * Atomically replace `targetPath` with `contents` using a same-directory temp file + rename.
 * Injectable `io` supports test failure points: writeFileSync / renameSync may throw.
 * On any failure the original target bytes are preserved and the temp file is cleaned up.
 */
export function atomicWriteFile(targetPath, contents, io = {}) {
  const fs = { ...defaultIo(), ...io }
  const dir = dirname(targetPath)
  const tempName = `.${basename(targetPath)}.${fs.randomBytes(8).toString("hex")}.tmp`
  const tempPath = join(dir, tempName)
  let wroteTemp = false

  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tempPath, contents)
    wroteTemp = true
    fs.renameSync(tempPath, targetPath)
    wroteTemp = false
  } catch (error) {
    if (wroteTemp) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
      } catch {
        // best-effort cleanup
      }
    }
    fail(error.code || "atomic-write-failed", error.message || "atomic write failed", {
      targetPath,
      cause: error,
    })
  }

  return { targetPath, changed: true }
}
