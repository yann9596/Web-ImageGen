import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectImage } from "../src/candidates.mjs"
import { transcodeBuffer, writeChosenFile } from "../src/artifact.mjs"
import { imageFile } from "./helpers.mjs"

test("sharp performs a real PNG to JPEG conversion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-artifact-"))
  const source = await imageFile(dir, "source.png", { color: "#ff2200", width: 23, height: 17 })
  const destination = join(dir, "chosen.jpg")
  const result = await writeChosenFile(source, destination)
  const info = inspectImage(readFileSync(destination))
  assert.equal(result.type, "image/jpeg")
  assert.deepEqual([info.width, info.height], [23, 17])
  assert.equal(info.type, "image/jpeg")
  assert.notEqual(readFileSync(destination).subarray(0, 4).toString("hex"), "89504e47")
})

test("transcode rejects unsupported output formats", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-artifact-"))
  const source = await imageFile(dir, "source.png")
  await assert.rejects(() => transcodeBuffer(readFileSync(source), ".gif"), /invalid-out-format/)
})
