import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  installSkill,
  main,
  providerStatus,
  renderProviderConfig,
  switchProvider,
} from "../scripts/skill-provider.mjs"

const SCRIPT = fileURLToPath(new URL("../scripts/skill-provider.mjs", import.meta.url))

function makeCodexRoot({ withUserConfig = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "web-imagegen-provider-"))
  const official = join(root, "skills", ".system", "imagegen", "SKILL.md")
  mkdirSync(join(official, ".."), { recursive: true })
  writeFileSync(official, "official", "utf8")
  if (withUserConfig) {
    writeFileSync(
      join(root, "config.toml"),
      [
        'model = "gpt-5"',
        "",
        "[[skills.config]]",
        'path = "C:/custom/other/SKILL.md"',
        "enabled = true",
        "",
      ].join("\n"),
      "utf8",
    )
  }
  return root
}

function skillFlags(root) {
  const text = readFileSync(join(root, "config.toml"), "utf8")
  const official = join(root, "skills", ".system", "imagegen", "SKILL.md").replaceAll("\\", "/")
  const web = join(root, "skills", "web-imagegen", "SKILL.md").replaceAll("\\", "/")
  const entries = text.split(/\[\[skills\.config\]\]/i).slice(1)
  const enabled = Object.fromEntries(
    entries
      .filter((entry) => /enabled\s*=\s*true/i.test(entry))
      .map((entry) => {
        const normalized = entry.replaceAll("\\", "/")
        if (normalized.toLowerCase().includes(official.toLowerCase())) return ["official", true]
        if (normalized.toLowerCase().includes(web.toLowerCase())) return ["web", true]
        return ["other", true]
      }),
  )
  return {
    official: Boolean(enabled.official),
    web: Boolean(enabled.web),
    other: Boolean(enabled.other),
    enabledCount: Object.keys(enabled).filter((key) => key === "official" || key === "web").length,
  }
}

function providerJson(root) {
  return JSON.parse(readFileSync(join(root, "web-imagegen", "provider.json"), "utf8"))
}

test("provider block preserves user config and enables exactly one skill", () => {
  const output = renderProviderConfig('model = "gpt-5"\n', "grok", "C:/c/imagegen/SKILL.md", "C:/c/web-imagegen/SKILL.md")
  assert.match(output, /model = "gpt-5"/)
  assert.match(output, /imagegen\/SKILL\.md"\nenabled = false/)
  assert.match(output, /web-imagegen\/SKILL\.md"\nenabled = true/)
  assert.equal((output.match(/enabled = true/g) || []).length, 1)
})

test("PS-01 three-value switch default → grok → gpt → default", () => {
  const root = makeCodexRoot()
  assert.equal(installSkill({ codexRoot: root }).changed, true)
  assert.equal(existsSync(join(root, "skills", "web-imagegen", "SKILL.md")), true)

  assert.equal(switchProvider("default", { codexRoot: root }).provider, "default")
  assert.deepEqual(providerStatus({ codexRoot: root }).provider, "default")
  assert.deepEqual(skillFlags(root), { official: true, web: false, other: false, enabledCount: 1 })
  assert.equal(providerJson(root).provider, "default")

  assert.equal(switchProvider("grok", { codexRoot: root }).provider, "grok")
  assert.equal(providerStatus({ codexRoot: root }).provider, "grok")
  assert.deepEqual(skillFlags(root), { official: false, web: true, other: false, enabledCount: 1 })
  assert.equal(providerJson(root).provider, "grok")

  assert.equal(switchProvider("gpt", { codexRoot: root }).provider, "gpt")
  assert.equal(providerStatus({ codexRoot: root }).provider, "gpt")
  assert.deepEqual(skillFlags(root), { official: false, web: true, other: false, enabledCount: 1 })
  assert.equal(providerJson(root).provider, "gpt")

  assert.equal(switchProvider("default", { codexRoot: root }).provider, "default")
  assert.equal(providerStatus({ codexRoot: root }).provider, "default")
  assert.deepEqual(skillFlags(root), { official: true, web: false, other: false, enabledCount: 1 })
  assert.equal(providerJson(root).provider, "default")
})

test("PS-02 repeated switch is idempotent", () => {
  const root = makeCodexRoot()
  installSkill({ codexRoot: root })
  switchProvider("grok", { codexRoot: root })
  const configBefore = readFileSync(join(root, "config.toml"), "utf8")
  const stateBefore = readFileSync(join(root, "web-imagegen", "provider.json"), "utf8")
  const second = switchProvider("grok", { codexRoot: root })
  assert.equal(second.changed, false)
  assert.equal(readFileSync(join(root, "config.toml"), "utf8"), configBefore)
  assert.equal(readFileSync(join(root, "web-imagegen", "provider.json"), "utf8"), stateBefore)
})

test("PS-03 user config outside managed block is preserved", () => {
  const root = makeCodexRoot({ withUserConfig: true })
  installSkill({ codexRoot: root })
  switchProvider("default", { codexRoot: root })
  switchProvider("grok", { codexRoot: root })
  const text = readFileSync(join(root, "config.toml"), "utf8")
  assert.match(text, /model = "gpt-5"/)
  assert.match(text, /C:\/custom\/other\/SKILL\.md/)
  assert.match(text, /BEGIN web-imagegen-provider/)
  assert.deepEqual(skillFlags(root).other, true)
})

test("PS-04 external skill path conflict is rejected without writes", () => {
  const root = makeCodexRoot()
  installSkill({ codexRoot: root })
  const webSkill = join(root, "skills", "web-imagegen", "SKILL.md").replaceAll("\\", "/")
  writeFileSync(
    join(root, "config.toml"),
    `[[skills.config]]\npath = "${webSkill}"\nenabled = true\n`,
    "utf8",
  )
  const before = readFileSync(join(root, "config.toml"), "utf8")
  assert.throws(
    () => switchProvider("grok", { codexRoot: root }),
    (error) => error.code === "provider-config-conflict",
  )
  assert.equal(readFileSync(join(root, "config.toml"), "utf8"), before)
  assert.equal(existsSync(join(root, "web-imagegen", "provider.json")), false)
})

test("PS-05 interrupt injection never enables both skills", () => {
  const root = makeCodexRoot()
  installSkill({ codexRoot: root })
  switchProvider("default", { codexRoot: root })

  assert.throws(
    () =>
      switchProvider("grok", {
        codexRoot: root,
        beforeStep(step) {
          if (step.type === "write-skill-config") {
            throw Object.assign(new Error("injected before skill write"), { code: "injected-interrupt" })
          }
        },
      }),
    (error) => error.code === "injected-interrupt",
  )
  assert.equal(providerJson(root).provider, "grok")
  assert.deepEqual(skillFlags(root), { official: true, web: false, other: false, enabledCount: 1 })
  assert.throws(() => providerStatus({ codexRoot: root }), (error) => error.code === "provider-config-mismatch")

  switchProvider("default", { codexRoot: root })
  assert.equal(providerStatus({ codexRoot: root }).provider, "default")

  assert.throws(
    () =>
      switchProvider("grok", {
        codexRoot: root,
        afterStep(step) {
          if (step.type === "write-provider-state") {
            throw Object.assign(new Error("injected after state write"), { code: "injected-interrupt" })
          }
        },
      }),
    (error) => error.code === "injected-interrupt",
  )
  assert.equal(providerJson(root).provider, "grok")
  assert.deepEqual(skillFlags(root), { official: true, web: false, other: false, enabledCount: 1 })
  assert.equal(readdirSync(join(root, "web-imagegen")).filter((name) => name.endsWith(".tmp")).length, 0)

  switchProvider("grok", { codexRoot: root })
  assert.throws(
    () =>
      switchProvider("default", {
        codexRoot: root,
        beforeStep(step) {
          if (step.type === "write-provider-state") {
            throw Object.assign(new Error("injected before default state"), { code: "injected-interrupt" })
          }
        },
      }),
    (error) => error.code === "injected-interrupt",
  )
  const flags = skillFlags(root)
  assert.equal(flags.official && flags.web, false)
  assert.equal(flags.enabledCount, 1)
  assert.equal(readdirSync(root, { recursive: true }).filter((name) => String(name).endsWith(".tmp")).length, 0)
})

test("PS-06 dry-run returns ordered steps without writing", () => {
  const root = makeCodexRoot()
  installSkill({ codexRoot: root })
  switchProvider("default", { codexRoot: root })
  const configBefore = readFileSync(join(root, "config.toml"), "utf8")
  const stateBefore = readFileSync(join(root, "web-imagegen", "provider.json"), "utf8")
  const result = switchProvider("grok", { codexRoot: root, dryRun: true })
  assert.equal(result.status, "dry-run")
  assert.equal(result.provider, "grok")
  assert.deepEqual(
    result.steps.map((step) => step.type),
    ["write-provider-state", "write-skill-config"],
  )
  assert.equal(readFileSync(join(root, "config.toml"), "utf8"), configBefore)
  assert.equal(readFileSync(join(root, "web-imagegen", "provider.json"), "utf8"), stateBefore)
})

test("PS-07/CLI-03 public CLI enables gpt and rejects retired openai", async () => {
  const root = makeCodexRoot()
  installSkill({ codexRoot: root })
  const gpt = await main(["gpt", "--codex-root", root])
  assert.equal(gpt.provider, "gpt")
  assert.equal(providerStatus({ codexRoot: root }).provider, "gpt")
  assert.deepEqual(skillFlags(root), { official: false, web: true, other: false, enabledCount: 1 })
  await assert.rejects(() => main(["openai", "--codex-root", root]), (error) => error.code === "invalid-arguments")

  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(packageJson.scripts["provider:default"], "node scripts/skill-provider.mjs default")
  assert.equal(packageJson.scripts["provider:grok"], "node scripts/skill-provider.mjs grok")
  assert.equal(packageJson.scripts["provider:gpt"], "node scripts/skill-provider.mjs gpt")
  assert.equal(packageJson.scripts["provider:status"], "node scripts/skill-provider.mjs status")
  assert.equal(packageJson.scripts["provider:openai"], undefined)

  const dry = spawnSync(process.execPath, [SCRIPT, "default", "--dry-run", "--codex-root", root], {
    encoding: "utf8",
  })
  assert.equal(dry.status, 0)
  const payload = JSON.parse(dry.stdout)
  assert.equal(payload.status, "dry-run")
  assert.equal(payload.provider, "default")

  const gptCli = spawnSync(process.execPath, [SCRIPT, "gpt", "--codex-root", root], {
    encoding: "utf8",
  })
  assert.equal(gptCli.status, 0)
  assert.equal(JSON.parse(gptCli.stdout).provider, "gpt")
  const statusCli = spawnSync(process.execPath, [SCRIPT, "status", "--codex-root", root], {
    encoding: "utf8",
  })
  assert.equal(statusCli.status, 0)
  assert.equal(JSON.parse(statusCli.stdout).provider, "gpt")
})

test("legacy managed-block without provider.json reports migrationRequired", () => {
  const root = makeCodexRoot()
  installSkill({ codexRoot: root })
  const official = join(root, "skills", ".system", "imagegen", "SKILL.md")
  const web = join(root, "skills", "web-imagegen", "SKILL.md")
  writeFileSync(join(root, "config.toml"), renderProviderConfig("", "grok", official, web), "utf8")
  assert.equal(existsSync(join(root, "web-imagegen", "provider.json")), false)
  const status = providerStatus({ codexRoot: root })
  assert.equal(status.provider, "grok")
  assert.equal(status.migrationRequired, true)
  assert.equal(status.legacySource, "managed-block")
  assert.equal(existsSync(join(root, "web-imagegen", "provider.json")), false)
})

test("external configuration conflict is rejected by renderProviderConfig", () => {
  assert.throws(
    () =>
      renderProviderConfig(
        '[[skills.config]]\npath = "C:/c/web-imagegen/SKILL.md"\nenabled = true\n',
        "grok",
        "C:/c/imagegen/SKILL.md",
        "C:/c/web-imagegen/SKILL.md",
      ),
    (error) => error.code === "provider-config-conflict",
  )
})
