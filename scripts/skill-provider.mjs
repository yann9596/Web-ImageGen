import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const MANAGED_START = "# BEGIN grok-imagegen-provider"
const MANAGED_END = "# END grok-imagegen-provider"
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const SOURCE_SKILL_DIR = resolve(SCRIPT_DIR, "..", "skill", "grok-imagegen")

function fail(error, detail, extra = {}) {
  const e = new Error(detail || error)
  e.code = error
  Object.assign(e, extra)
  throw e
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const opts = { command, dryRun: false }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === "--dry-run") {
      opts.dryRun = true
      continue
    }
    if (arg === "--codex-root") {
      const value = rest[++i]
      if (!value) fail("invalid-arguments", `${arg} requires a path`)
      opts[arg.slice(2).replace("-", "")] = resolve(value)
      continue
    }
    fail("invalid-arguments", `unknown argument: ${arg}`)
  }
  return opts
}

function roots(opts = {}) {
  const codexRoot = opts.codexRoot || opts.codexroot || resolve(process.env.CODEX_HOME || join(homedir(), ".codex"))
  return { codexRoot }
}

function normalizedPath(path) {
  return resolve(path).replaceAll("\\", "/")
}

function tomlString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function managedBlock(provider, officialSkill, grokSkill) {
  const grok = provider === "grok"
  return [
    MANAGED_START,
    "[[skills.config]]",
    `path = ${tomlString(normalizedPath(officialSkill))}`,
    `enabled = ${grok ? "false" : "true"}`,
    "",
    "[[skills.config]]",
    `path = ${tomlString(normalizedPath(grokSkill))}`,
    `enabled = ${grok ? "true" : "false"}`,
    MANAGED_END,
  ].join("\n")
}

export function splitManagedConfig(text) {
  const source = String(text || "")
  const start = source.indexOf(MANAGED_START)
  const end = source.indexOf(MANAGED_END)
  if (start === -1 && end === -1) return { before: source.replace(/\s*$/, ""), managed: "", after: "" }
  if (start === -1 || end === -1 || end < start) fail("provider-config-corrupt", "managed provider block is incomplete")
  if (source.indexOf(MANAGED_START, start + MANAGED_START.length) !== -1) {
    fail("provider-config-corrupt", "multiple managed provider blocks found")
  }
  const afterStart = end + MANAGED_END.length
  return {
    before: source.slice(0, start).replace(/\s*$/, ""),
    managed: source.slice(start, afterStart),
    after: source.slice(afterStart).replace(/^\s*/, ""),
  }
}

function ensureNoExternalConflict(before, after, paths) {
  const outside = `${before}\n${after}`.replaceAll("\\", "/").toLowerCase()
  for (const path of paths) {
    const needle = normalizedPath(path).toLowerCase()
    if (outside.includes(needle)) {
      fail("provider-config-conflict", `skill path is already configured outside the managed block: ${path}`)
    }
  }
}

export function renderProviderConfig(current, provider, officialSkill, grokSkill) {
  if (provider !== "grok" && provider !== "openai") fail("invalid-provider", `unsupported provider: ${provider}`)
  const parts = splitManagedConfig(current)
  ensureNoExternalConflict(parts.before, parts.after, [officialSkill, grokSkill])
  const sections = [parts.before, managedBlock(provider, officialSkill, grokSkill), parts.after].filter(Boolean)
  return `${sections.join("\n\n")}\n`
}

function resolveInstalledLink(target) {
  try {
    const st = lstatSync(target)
    if (!st.isSymbolicLink()) return null
    return realpathSync(resolve(dirname(target), readlinkSync(target)))
  } catch {
    return null
  }
}

export function installSkill(opts = {}) {
  const { codexRoot } = roots(opts)
  const target = join(codexRoot, "skills", "grok-imagegen")
  if (!existsSync(SOURCE_SKILL_DIR)) fail("skill-source-missing", SOURCE_SKILL_DIR)

  if (existsSync(target)) {
    const linked = resolveInstalledLink(target)
    if (linked && normalizedPath(linked) === normalizedPath(SOURCE_SKILL_DIR)) {
      return { status: "installed", changed: false, target, source: SOURCE_SKILL_DIR, restartRequired: true }
    }
    fail("skill-install-conflict", `target exists and is not the managed skill link: ${target}`)
  }

  if (!opts.dryRun) {
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(SOURCE_SKILL_DIR, target, process.platform === "win32" ? "junction" : "dir")
  }
  return { status: opts.dryRun ? "dry-run" : "installed", changed: true, target, source: SOURCE_SKILL_DIR, restartRequired: true }
}

export function switchProvider(provider, opts = {}) {
  const { codexRoot } = roots(opts)
  const configPath = join(codexRoot, "config.toml")
  const officialSkill = join(codexRoot, "skills", ".system", "imagegen", "SKILL.md")
  const grokSkill = join(codexRoot, "skills", "grok-imagegen", "SKILL.md")

  if (!existsSync(officialSkill)) fail("official-imagegen-missing", officialSkill)
  if (!existsSync(grokSkill)) fail("grok-imagegen-missing", `${grokSkill}; run skill:install first`)

  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const next = renderProviderConfig(current, provider, officialSkill, grokSkill)
  const changed = next !== current
  if (changed && !opts.dryRun) {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, next, "utf8")
  }
  return {
    status: opts.dryRun ? "dry-run" : "configured",
    provider,
    changed,
    configPath,
    officialSkill,
    grokSkill,
    restartRequired: true,
  }
}

export function providerStatus(opts = {}) {
  const { codexRoot } = roots(opts)
  const configPath = join(codexRoot, "config.toml")
  const officialSkill = join(codexRoot, "skills", ".system", "imagegen", "SKILL.md")
  const grokSkill = join(codexRoot, "skills", "grok-imagegen", "SKILL.md")
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const { managed } = splitManagedConfig(current)
  let provider = null
  if (managed) {
    const entries = managed.split(/\[\[skills\.config\]\]/i).slice(1)
    const enabledPath = entries.find((entry) => /enabled\s*=\s*true/i.test(entry)) || ""
    const normalized = enabledPath.replaceAll("\\", "/").toLowerCase()
    if (normalized.includes(normalizedPath(grokSkill).toLowerCase())) provider = "grok"
    else if (normalized.includes(normalizedPath(officialSkill).toLowerCase())) provider = "openai"
  }
  return { status: "ok", provider, configPath, installed: existsSync(grokSkill), restartRequired: false }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  if (opts.command === "install") return installSkill(opts)
  if (opts.command === "grok" || opts.command === "openai") return switchProvider(opts.command, opts)
  if (opts.command === "status") return providerStatus(opts)
  fail("invalid-arguments", "command must be install, grok, openai, or status")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`)
    })
    .catch((error) => {
      process.stdout.write(`${JSON.stringify({ error: error.code || "provider-switch-failed", detail: error.message })}\n`)
      process.exitCode = 1
    })
}
