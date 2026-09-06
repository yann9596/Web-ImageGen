import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { installSkill, switchProvider } from "../scripts/skill-provider.mjs"

const ROOT = join(import.meta.dirname, "..")
const SKILL_DIR = join(ROOT, "skill", "web-imagegen")
const ROOT_PROVIDER = fileURLToPath(new URL("../scripts/skill-provider.mjs", import.meta.url))
const SKILL_PROVIDER = fileURLToPath(new URL("../skill/web-imagegen/scripts/provider.mjs", import.meta.url))

function filesUnder(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else out.push(path)
  }
  return out
}

function makeCodexRoot() {
  const root = mkdtempSync(join(tmpdir(), "web-imagegen-skill-routing-"))
  const official = join(root, "skills", ".system", "imagegen", "SKILL.md")
  mkdirSync(join(official, ".."), { recursive: true })
  writeFileSync(official, "official", "utf8")
  return root
}

function runProvider(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    windowsHide: true,
  })
  const stdout = String(result.stdout || "")
  const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0)
  return {
    status: result.status,
    stdout,
    lines,
    json: lines.length ? JSON.parse(lines[0]) : null,
  }
}

test("SK-01 top-level Skill routes by provider status before loading docs", () => {
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8")
  assert.match(skill, /provider\.mjs status/)
  assert.match(skill, /provider-config-mismatch/)
  assert.match(skill, /provider` is `default`/)
  assert.match(skill, /stop Web ImageGen immediately/)
  assert.match(skill, /references\/providers\/grok\.md/)
  assert.match(skill, /references\/providers\/gpt\.md/)
  assert.match(skill, /Never load both provider documents/)
  assert.doesNotMatch(skill, /grok\.com/)
  assert.doesNotMatch(skill, /\/imagine\/post\//)
  assert.doesNotMatch(skill, /chatgpt\.com/)
  assert.doesNotMatch(skill, /×2/)
  assert.doesNotMatch(skill, /自动模式/)
  assert.doesNotMatch(skill, /Grok Imagine/)
})

test("SK-01 provider documents stay isolated", () => {
  const grok = readFileSync(join(SKILL_DIR, "references", "providers", "grok.md"), "utf8")
  const gpt = readFileSync(join(SKILL_DIR, "references", "providers", "gpt.md"), "utf8")

  assert.match(grok, /Grok Imagine/)
  assert.match(grok, /×2/)
  assert.match(grok, /自动模式/)
  assert.match(grok, /downloadMedia\(\)/)
  assert.match(grok, /snapshotDownloads/)
  assert.doesNotMatch(grok, /chatgpt\.com/)
  assert.doesNotMatch(grok, /fillEligible/)
  assert.doesNotMatch(grok, /conversation-not-isolated/)

  assert.match(gpt, /chatgpt\.com/)
  assert.match(gpt, /conversation-not-isolated/)
  assert.match(gpt, /attempt-start/)
  assert.match(gpt, /attempt-bind/)
  assert.match(gpt, /fillEligible/)
  assert.match(gpt, /providerAssetKey/)
  assert.match(gpt, /stop, return the current screenshot/)
  assert.doesNotMatch(gpt, /×2/)
  assert.doesNotMatch(gpt, /自动模式/)
  assert.doesNotMatch(gpt, /grok\.com/)
  assert.doesNotMatch(gpt, /\/imagine\/post\//)
  assert.match(gpt, /Never hard-code DOM query strings or page-structure paths/)
  assert.doesNotMatch(gpt, /querySelector|getElementById|\/\/\w+\[|@class=/i)
  assert.match(gpt, /Never scan the chat sidebar, Library/)
})

test("SK-01 skill provider.mjs status matches root CLI for default|grok|gpt and mismatch", () => {
  const root = makeCodexRoot()
  assert.equal(installSkill({ codexRoot: root }).changed, true)

  for (const provider of ["default", "grok", "gpt"]) {
    assert.equal(switchProvider(provider, { codexRoot: root }).provider, provider)
    const viaRoot = runProvider(ROOT_PROVIDER, ["status", "--codex-root", root])
    const viaSkill = runProvider(SKILL_PROVIDER, ["status", "--codex-root", root])
    assert.equal(viaRoot.status, 0)
    assert.equal(viaSkill.status, 0)
    assert.equal(viaRoot.lines.length, 1)
    assert.equal(viaSkill.lines.length, 1)
    assert.deepEqual(viaSkill.json, viaRoot.json)
    assert.equal(viaSkill.json.provider, provider)
  }

  // Force mismatch: both skills enabled while provider.json says grok.
  const configPath = join(root, "config.toml")
  const official = join(root, "skills", ".system", "imagegen", "SKILL.md").replaceAll("\\", "/")
  const web = join(root, "skills", "web-imagegen", "SKILL.md").replaceAll("\\", "/")
  writeFileSync(
    configPath,
    [
      "# BEGIN web-imagegen-provider",
      "[[skills.config]]",
      `path = "${official}"`,
      "enabled = true",
      "",
      "[[skills.config]]",
      `path = "${web}"`,
      "enabled = true",
      "# END web-imagegen-provider",
      "",
    ].join("\n"),
    "utf8",
  )
  writeFileSync(
    join(root, "web-imagegen", "provider.json"),
    `${JSON.stringify({ schemaVersion: 1, provider: "grok" }, null, 2)}\n`,
    "utf8",
  )

  const mismatchRoot = runProvider(ROOT_PROVIDER, ["status", "--codex-root", root])
  const mismatchSkill = runProvider(SKILL_PROVIDER, ["status", "--codex-root", root])
  assert.equal(mismatchRoot.status, 1)
  assert.equal(mismatchSkill.status, 1)
  assert.deepEqual(mismatchSkill.json, mismatchRoot.json)
  assert.equal(mismatchSkill.json.error, "provider-config-mismatch")
})

test("SK-02 skill docs and scripts forbid banned stacks", () => {
  const skillFiles = filesUnder(SKILL_DIR).filter((path) => /\.(md|mjs|ya?ml)$/i.test(path))
  const text = skillFiles.map((path) => readFileSync(path, "utf8")).join("\n")
  assert.doesNotMatch(text, /playwright/i)
  assert.doesNotMatch(text, /\bcdp\b|connectOverCDP|chromium\.launch/i)
  assert.doesNotMatch(text, /\bfetch\s*\(|https?\.request\s*\(/i)
  assert.doesNotMatch(text, /createServer\s*\(|http\.createServer|listen\s*\(\s*\d+/i)
  assert.doesNotMatch(text, /user-data-dir|persistent.?context|launchPersistentContext/i)
  assert.doesNotMatch(text, /fallback to (grok|gpt|default)|cross[- ]provider fallback/i)
})

test("SK-03 skill structure exposes provider router entrypoints", () => {
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8")
  assert.match(skill, /^---\r?\nname: web-imagegen\r?\ndescription:/)
  assert.equal(existsSync(join(SKILL_DIR, "scripts", "provider.mjs")), true)
  assert.equal(existsSync(join(SKILL_DIR, "scripts", "cli.mjs")), true)
  assert.equal(existsSync(join(SKILL_DIR, "scripts", "downloads.mjs")), true)
  assert.equal(existsSync(join(SKILL_DIR, "references", "providers", "grok.md")), true)
  assert.equal(existsSync(join(SKILL_DIR, "references", "providers", "gpt.md")), true)
  assert.equal(existsSync(join(SKILL_DIR, "references", "runtime.md")), true)
  assert.equal(existsSync(join(SKILL_DIR, "references", "ai-led.md")), true)
  assert.equal(existsSync(join(SKILL_DIR, "references", "user-led.md")), true)
  assert.equal(existsSync(join(SKILL_DIR, "agents", "openai.yaml")), true)

  const mdFiles = filesUnder(SKILL_DIR).filter((path) => path.endsWith(".md"))
  assert.equal(mdFiles.length, 6)

  const runtime = readFileSync(join(SKILL_DIR, "references", "runtime.md"), "utf8")
  assert.match(runtime, /attempt-start/)
  assert.match(runtime, /attempt-bind/)
  assert.match(runtime, /providerAssetKey/)
  assert.match(runtime, /--provider/)
  assert.match(runtime, /fillEligible/)
})
