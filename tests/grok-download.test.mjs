import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveProviderDownload, snapshotDownloads } from "../src/providers/grok-download.mjs"

const RESPONSE_ID = "dfb94287-b4c6-4efd-a10f-03fca993b9b2"

test("GD-01 download snapshots resolve only the new file bound to the frozen Post", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-downloads-"))
  writeFileSync(join(dir, "unrelated.jpg"), "old")
  const before = snapshotDownloads(dir, { responseId: RESPONSE_ID })
  const expected = join(dir, `grok-image-${RESPONSE_ID}.jpg`)
  writeFileSync(expected, "current")
  const resolved = resolveProviderDownload({
    before,
    after: snapshotDownloads(dir, { responseId: RESPONSE_ID }),
    responseId: RESPONSE_ID,
  })
  assert.equal(resolved.path, expected)
  assert.equal(resolved.size, 7)
  assert.equal(resolved.reused, false)
})

test("GD-01 download snapshots reject historic and ambiguous provider files", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-downloads-"))
  writeFileSync(join(dir, `grok-image-${RESPONSE_ID}.jpg`), "historic")
  const before = snapshotDownloads(dir, { responseId: RESPONSE_ID })
  assert.throws(
    () => resolveProviderDownload({ before, after: snapshotDownloads(dir, { responseId: RESPONSE_ID }), responseId: RESPONSE_ID }),
    /download-missing/,
  )
  assert.equal(
    resolveProviderDownload({
      before,
      after: snapshotDownloads(dir, { responseId: RESPONSE_ID }),
      responseId: RESPONSE_ID,
      allowExisting: true,
    }).reused,
    true,
  )
  writeFileSync(join(dir, `grok-image-${RESPONSE_ID} (1).jpg`), "one")
  writeFileSync(join(dir, `grok-image-${RESPONSE_ID} (2).png`), "two")
  assert.throws(
    () =>
      resolveProviderDownload({
        before,
        after: snapshotDownloads(dir, { responseId: RESPONSE_ID }),
        responseId: RESPONSE_ID,
        allowExisting: true,
      }),
    /download-ambiguous/,
  )
})

test("GD-01 download snapshots never expose unrelated filenames", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-downloads-"))
  writeFileSync(join(dir, "private-notes.txt"), "secret")
  writeFileSync(join(dir, "other-image.jpg"), "unrelated")
  writeFileSync(join(dir, `grok-image-${RESPONSE_ID}.jpg`), "current")
  assert.deepEqual(
    snapshotDownloads(dir, { responseId: RESPONSE_ID }).map((item) => item.name),
    [`grok-image-${RESPONSE_ID}.jpg`],
  )
})

test("GD-01 compatibility re-export from browser-downloads matches grok-download", async () => {
  const compat = await import("../src/browser-downloads.mjs")
  const direct = await import("../src/providers/grok-download.mjs")
  assert.equal(compat.resolveProviderDownload, direct.resolveProviderDownload)
  assert.equal(compat.snapshotDownloads, direct.snapshotDownloads)
})
