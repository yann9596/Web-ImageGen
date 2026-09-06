import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { atomicWriteFile } from "../src/atomic-file.mjs"

test("atomic write replaces target and preserves bytes on write failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-atomic-"))
  const target = join(dir, "provider.json")
  writeFileSync(target, "original\n", "utf8")

  atomicWriteFile(target, "next\n")
  assert.equal(readFileSync(target, "utf8"), "next\n")
  assert.equal(readdirSync(dir).filter((name) => name.endsWith(".tmp")).length, 0)

  assert.throws(
    () =>
      atomicWriteFile(target, "failed\n", {
        writeFileSync() {
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
        },
      }),
    (error) => error.code === "ENOSPC",
  )
  assert.equal(readFileSync(target, "utf8"), "next\n")
  assert.equal(readdirSync(dir).filter((name) => name.endsWith(".tmp")).length, 0)
})

test("atomic write cleans temp file when rename fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-imagegen-atomic-"))
  const target = join(dir, "config.toml")
  writeFileSync(target, "keep\n", "utf8")

  assert.throws(
    () =>
      atomicWriteFile(target, "lost\n", {
        renameSync() {
          throw Object.assign(new Error("rename denied"), { code: "EPERM" })
        },
      }),
    (error) => error.code === "EPERM",
  )
  assert.equal(readFileSync(target, "utf8"), "keep\n")
  assert.equal(readdirSync(dir).filter((name) => name.endsWith(".tmp")).length, 0)
  assert.equal(existsSync(target), true)
})
