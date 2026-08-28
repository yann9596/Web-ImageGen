import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { jobDirName, pickSessionLabel, slug } from "../src/paths.mjs"

test("workspace names preserve CJK and redraw versions", () => {
  assert.equal(slug("一束送给老婆的花"), "一束送给老婆的花")
  assert.equal(pickSessionLabel({ sessionTitle: "New session", prompt: "a red panda" }), "a-red-panda")
  const dir = mkdtempSync(join(tmpdir(), "grok-paths-"))
  mkdirSync(join(dir, "花束"))
  assert.equal(jobDirName("花束", "更写实", true, dir), "花束-V2_更写实")
})
