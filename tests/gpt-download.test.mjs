import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { snapshotDownloadFiles } from "../src/download-snapshot.mjs"
import { resolveDirectDownloadPath, resolveGptDownload } from "../src/providers/gpt-download.mjs"
import { imageFile } from "./helpers.mjs"

function touch(path, mtimeMs) {
  utimesSync(path, new Date(), new Date(mtimeMs))
}

test("GPTD-01 Chrome direct path accepts a real image file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-gptd-direct-"))
  const path = await imageFile(dir, "chrome-materialized.png", { width: 640, height: 512 })
  const resolved = resolveGptDownload({ directPath: path })
  assert.equal(resolved.path, path)
  assert.equal(resolved.source, "direct")
  assert.equal(resolved.reused, false)
  assert.equal(resolveDirectDownloadPath(path).path, path)
})

test("GPTD-01 rejects missing path, directory, and unsupported format", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-gptd-reject-"))
  assert.throws(() => resolveGptDownload({ directPath: join(dir, "missing.png") }), /download-missing/)
  assert.throws(() => resolveGptDownload({ directPath: dir }), /invalid-request/)
  const txt = join(dir, "notes.txt")
  writeFileSync(txt, "not-an-image")
  assert.throws(() => resolveGptDownload({ directPath: txt }), /ext-mismatch/)
})

test("GPTD-02 unique download delta is accepted; zero/multi fail distinctly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-gptd-delta-"))
  writeFileSync(join(dir, "noise.txt"), "ignore")
  const before = snapshotDownloadFiles(dir)

  assert.throws(() => resolveGptDownload({ before, after: snapshotDownloadFiles(dir) }), /download-missing/)

  const only = await imageFile(dir, "unique.png", { color: "red" })
  const one = resolveGptDownload({ before, after: snapshotDownloadFiles(dir) })
  assert.equal(one.path, only)
  assert.equal(one.source, "delta")
  assert.equal(one.reused, false)

  const mid = snapshotDownloadFiles(dir)
  await imageFile(dir, "second.jpg", { format: "jpeg", color: "blue" })
  await imageFile(dir, "third.webp", { format: "webp", color: "green" })
  assert.throws(() => resolveGptDownload({ before: mid, after: snapshotDownloadFiles(dir) }), /download-ambiguous/)
})

test("GPTD-03 forbids allowExisting, mtime guessing, and filename identity shortcuts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-gptd-guess-"))
  const responseKey = "resp-abc123"
  const historic = await imageFile(dir, `chatgpt-${responseKey}-0.png`, { color: "black" })
  touch(historic, 1_600_000_000_000)
  const before = snapshotDownloadFiles(dir)

  // Historic same-name image must not be reused — GPT has no allowExisting.
  assert.throws(() => resolveGptDownload({ before, after: snapshotDownloadFiles(dir) }), /download-missing/)
  assert.throws(
    () => resolveGptDownload({ before, after: snapshotDownloadFiles(dir), allowExisting: true }),
    /download-missing/,
  )

  const newer = await imageFile(dir, "newer-unrelated.png", { color: "white" })
  touch(newer, 1_900_000_000_000)
  const olderNew = await imageFile(dir, "older-also-new.png", { color: "gray" })
  touch(olderNew, 1_700_000_000_000)
  // Two deltas: must be ambiguous even when one mtime is newer.
  assert.throws(() => resolveGptDownload({ before, after: snapshotDownloadFiles(dir) }), /download-ambiguous/)

  // Filename containing responseKey is not an identity shortcut when there is no delta.
  const named = mkdtempSync(join(tmpdir(), "web-imagegen-gptd-name-"))
  await imageFile(named, `gpt-${responseKey}-0.png`, { color: "red" })
  const snap = snapshotDownloadFiles(named)
  assert.throws(() => resolveGptDownload({ before: snap, after: snap, responseKey }), /download-missing/)
})
