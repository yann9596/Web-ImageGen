import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installSkill, providerStatus, renderProviderConfig, switchProvider } from "../scripts/skill-provider.mjs"

function makeCodexRoot() {
  const root = mkdtempSync(join(tmpdir(), "grok-provider-"))
  const official = join(root, "skills", ".system", "imagegen", "SKILL.md")
  mkdirSync(join(official, ".."), { recursive: true })
  writeFileSync(official, "official", "utf8")
  return root
}

test("provider block preserves user config and enables exactly one skill", () => {
  const output = renderProviderConfig('model = "gpt-5"\n', "grok", "C:/c/imagegen/SKILL.md", "C:/c/grok/SKILL.md")
  assert.match(output, /model = "gpt-5"/)
  assert.match(output, /imagegen\/SKILL\.md"\nenabled = false/)
  assert.match(output, /grok\/SKILL\.md"\nenabled = true/)
  assert.equal((output.match(/enabled = true/g) || []).length, 1)
})

test("install and provider switches are repeatable in an isolated Codex root", () => {
  const root = makeCodexRoot()
  assert.equal(installSkill({ codexRoot: root }).changed, true)
  assert.equal(existsSync(join(root, "skills", "grok-imagegen", "SKILL.md")), true)
  assert.equal(installSkill({ codexRoot: root }).changed, false)
  assert.equal(switchProvider("grok", { codexRoot: root }).provider, "grok")
  assert.equal(providerStatus({ codexRoot: root }).provider, "grok")
  assert.equal(switchProvider("openai", { codexRoot: root }).provider, "openai")
  assert.equal(providerStatus({ codexRoot: root }).provider, "openai")
  assert.match(readFileSync(join(root, "config.toml"), "utf8"), /BEGIN grok-imagegen-provider/)
})

test("external configuration conflict is rejected", () => {
  assert.throws(
    () => renderProviderConfig('[[skills.config]]\npath = "C:/c/grok/SKILL.md"\nenabled = true\n', "grok", "C:/c/imagegen/SKILL.md", "C:/c/grok/SKILL.md"),
    (error) => error.code === "provider-config-conflict",
  )
})
