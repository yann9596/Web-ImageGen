import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DOWNLOAD_IMAGE_EXTENSIONS,
  changedDownloads,
  snapshotDownloadFiles,
  summarizeDownloadSnapshot,
} from "../src/download-snapshot.mjs"

function touch(path, mtimeMs) {
  const atime = new Date()
  const mtime = new Date(mtimeMs)
  utimesSync(path, atime, mtime)
}

test("DS-01 new file, content overwrite, no change, and multi-change are repeatable", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-ds-"))
  const unrelated = join(dir, "notes.txt")
  writeFileSync(unrelated, "secret")
  const beforeEmpty = snapshotDownloadFiles(dir)
  assert.equal(beforeEmpty.length, 1)

  const imageA = join(dir, "a.png")
  writeFileSync(imageA, "one")
  touch(imageA, 1_700_000_000_000)
  const afterNew = snapshotDownloadFiles(dir)
  const added = changedDownloads(beforeEmpty, afterNew, { extensions: DOWNLOAD_IMAGE_EXTENSIONS })
  assert.equal(added.length, 1)
  assert.equal(added[0].path, imageA)
  assert.equal(added[0].size, 3)

  const beforeOverwrite = snapshotDownloadFiles(dir)
  writeFileSync(imageA, "longer")
  touch(imageA, 1_700_000_000_100)
  const overwritten = changedDownloads(beforeOverwrite, snapshotDownloadFiles(dir), {
    extensions: DOWNLOAD_IMAGE_EXTENSIONS,
  })
  assert.equal(overwritten.length, 1)
  assert.equal(overwritten[0].size, 6)

  const stable = snapshotDownloadFiles(dir)
  assert.equal(changedDownloads(stable, snapshotDownloadFiles(dir), { extensions: DOWNLOAD_IMAGE_EXTENSIONS }).length, 0)

  const imageB = join(dir, "b.jpg")
  writeFileSync(imageB, "two")
  touch(imageB, 1_700_000_000_200)
  writeFileSync(imageA, "changed-again")
  touch(imageA, 1_700_000_000_300)
  const multi = changedDownloads(stable, snapshotDownloadFiles(dir), { extensions: DOWNLOAD_IMAGE_EXTENSIONS })
  assert.equal(multi.length, 2)
  assert.deepEqual(multi.map((item) => item.name).sort(), ["a.png", "b.jpg"])

  // Repeatability: same before/after yields the same paths.
  const multiAgain = changedDownloads(stable, snapshotDownloadFiles(dir), { extensions: DOWNLOAD_IMAGE_EXTENSIONS })
  assert.deepEqual(
    multiAgain.map((item) => item.path).sort(),
    multi.map((item) => item.path).sort(),
  )
})

test("DS-01 redacted debug reports only counts, never unrelated filenames", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-ds-redact-"))
  writeFileSync(join(dir, "private-notes.txt"), "secret")
  writeFileSync(join(dir, "other-image.jpg"), "bytes")
  const snap = snapshotDownloadFiles(dir)
  const redacted = summarizeDownloadSnapshot(snap, { redacted: true })
  assert.deepEqual(redacted, { count: 2 })
  assert.equal("names" in redacted, false)
  const encoded = JSON.stringify(redacted)
  assert.equal(encoded.includes("private-notes"), false)
  assert.equal(encoded.includes("other-image"), false)
})

test("DS-01 never picks by mtime among unchanged peers", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-ds-mtime-"))
  const older = join(dir, "old.png")
  const newer = join(dir, "new.png")
  writeFileSync(older, "aaa")
  writeFileSync(newer, "bbb")
  touch(older, 1_600_000_000_000)
  touch(newer, 1_800_000_000_000)
  const before = snapshotDownloadFiles(dir)
  // No content/mtime change — must not invent a "latest" winner.
  assert.equal(changedDownloads(before, snapshotDownloadFiles(dir)).length, 0)
})
