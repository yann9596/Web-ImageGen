import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { atomicWriteFile } from "../src/atomic-file.mjs"
import {
  PROVIDERS,
  WEB_PROVIDERS,
  deriveProviderStatus,
  parseProviderState,
  planProviderSwitch,
  renderProviderState,
  validateProvider,
} from "../src/provider-config.mjs"

const MANAGED_START = "# BEGIN web-imagegen-provider"
const MANAGED_END = "# END web-imagegen-provider"
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const SOURCE_SKILL_DIR = resolve(SCRIPT_DIR, "..", "skill", "web-imagegen")
const PUBLIC_SWITCH_COMMANDS = Object.freeze(["default", "grok", "gpt"])

function fail(error, detail, extra = {}) {
  const e = new Error(detail || error)
  e.code = error
  Object.assign(e, extra)
  throw e
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const opts = { command, dryRun: false, debug: false }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === "--dry-run") {
      opts.dryRun = true
      continue
    }
    if (arg === "--debug") {
      opts.debug = true
      continue
    }
    if (arg === "--codex-root") {
      const value = rest[++i]
      if (!value) fail("invalid-arguments", `${arg} requires a path`)
      opts.codexRoot = resolve(value)
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

function pathsFor(codexRoot) {
  return {
    configPath: join(codexRoot, "config.toml"),
    providerStatePath: join(codexRoot, "web-imagegen", "provider.json"),
    officialSkill: join(codexRoot, "skills", ".system", "imagegen", "SKILL.md"),
    webSkill: join(codexRoot, "skills", "web-imagegen", "SKILL.md"),
  }
}

function normalizedPath(path) {
  return resolve(path).replaceAll("\\", "/")
}

function tomlString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function managedBlock(provider, officialSkill, webSkill) {
  validateProvider(provider)
  const web = WEB_PROVIDERS.includes(provider)
  return [
    MANAGED_START,
    "[[skills.config]]",
    `path = ${tomlString(normalizedPath(officialSkill))}`,
    `enabled = ${web ? "false" : "true"}`,
    "",
    "[[skills.config]]",
    `path = ${tomlString(normalizedPath(webSkill))}`,
    `enabled = ${web ? "true" : "false"}`,
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

function ensureNoExternalConflict(before, after, skillPaths) {
  const outside = `${before}\n${after}`.replaceAll("\\", "/").toLowerCase()
  for (const path of skillPaths) {
    const needle = normalizedPath(path).toLowerCase()
    if (outside.includes(needle)) {
      fail("provider-config-conflict", `skill path is already configured outside the managed block: ${path}`)
    }
  }
}

export function renderProviderConfig(current, provider, officialSkill, webSkill) {
  validateProvider(provider)
  const parts = splitManagedConfig(current)
  ensureNoExternalConflict(parts.before, parts.after, [officialSkill, webSkill])
  const sections = [parts.before, managedBlock(provider, officialSkill, webSkill), parts.after].filter(Boolean)
  return `${sections.join("\n\n")}\n`
}

function readManagedSkillFlags(managed, officialSkill, webSkill) {
  if (!managed) {
    return { hasManaged: false, officialSkillEnabled: false, webSkillEnabled: false }
  }
  const entries = managed.split(/\[\[skills\.config\]\]/i).slice(1)
  let officialSkillEnabled = false
  let webSkillEnabled = false
  const officialNeedle = normalizedPath(officialSkill).toLowerCase()
  const webNeedle = normalizedPath(webSkill).toLowerCase()
  for (const entry of entries) {
    const enabled = /enabled\s*=\s*true/i.test(entry)
    const normalized = entry.replaceAll("\\", "/").toLowerCase()
    if (normalized.includes(officialNeedle)) officialSkillEnabled = enabled
    if (normalized.includes(webNeedle)) webSkillEnabled = enabled
  }
  return { hasManaged: true, officialSkillEnabled, webSkillEnabled }
}

function readProviderStateFile(providerStatePath) {
  if (!existsSync(providerStatePath)) return null
  return parseProviderState(readFileSync(providerStatePath, "utf8"))
}

function publicResult(result, debug = false) {
  if (debug) return result
  const {
    configPath: _c,
    providerStatePath: _p,
    officialSkill: _o,
    webSkill: _w,
    target: _t,
    source: _s,
    ...rest
  } = result
  return rest
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
  const target = join(codexRoot, "skills", "web-imagegen")
  if (!existsSync(SOURCE_SKILL_DIR)) fail("skill-source-missing", SOURCE_SKILL_DIR)

  if (existsSync(target)) {
    const linked = resolveInstalledLink(target)
    if (linked && normalizedPath(linked) === normalizedPath(SOURCE_SKILL_DIR)) {
      return publicResult(
        { status: "installed", changed: false, target, source: SOURCE_SKILL_DIR, restartRequired: true },
        opts.debug,
      )
    }
    fail("skill-install-conflict", `target exists and is not the managed skill link: ${target}`)
  }

  if (!opts.dryRun) {
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(SOURCE_SKILL_DIR, target, process.platform === "win32" ? "junction" : "dir")
  }
  return publicResult(
    {
      status: opts.dryRun ? "dry-run" : "installed",
      changed: true,
      target,
      source: SOURCE_SKILL_DIR,
      restartRequired: true,
    },
    opts.debug,
  )
}

function loadStatusModel(codexRoot, paths) {
  const current = existsSync(paths.configPath) ? readFileSync(paths.configPath, "utf8") : ""
  const parts = splitManagedConfig(current)
  const flags = readManagedSkillFlags(parts.managed, paths.officialSkill, paths.webSkill)
  const providerState = readProviderStateFile(paths.providerStatePath)
  return { current, parts, flags, providerState }
}

function planForUnconfigured(target) {
  if (WEB_PROVIDERS.includes(target)) {
    return {
      from: null,
      to: target,
      steps: [
        { type: "write-provider-state", provider: target },
        { type: "write-skill-config", officialEnabled: false, webEnabled: true },
      ],
    }
  }
  return {
    from: null,
    to: target,
    steps: [
      { type: "write-skill-config", officialEnabled: true, webEnabled: false },
      { type: "write-provider-state", provider: target },
    ],
  }
}

function planFromMismatch(model, target) {
  const { officialSkillEnabled, webSkillEnabled } = model.flags
  if (officialSkillEnabled === webSkillEnabled) {
    fail("provider-config-mismatch", "cannot safely plan switch while both or neither skills are enabled")
  }

  const needWeb = WEB_PROVIDERS.includes(target)
  const skillsMatch = needWeb ? webSkillEnabled && !officialSkillEnabled : officialSkillEnabled && !webSkillEnabled
  const stateMatch = model.providerState?.provider === target
  const steps = []

  if (needWeb && !skillsMatch) {
    if (!stateMatch) steps.push({ type: "write-provider-state", provider: target })
    steps.push({ type: "write-skill-config", officialEnabled: false, webEnabled: true })
  } else if (!needWeb && !skillsMatch) {
    steps.push({ type: "write-skill-config", officialEnabled: true, webEnabled: false })
    if (!stateMatch) steps.push({ type: "write-provider-state", provider: target })
  } else if (!stateMatch) {
    steps.push({ type: "write-provider-state", provider: target })
  }

  return { from: null, to: target, steps }
}

function buildSwitchPlan(target, model) {
  if (!model.flags.hasManaged) {
    return planForUnconfigured(target)
  }

  let status
  try {
    status = deriveProviderStatus({
      managedConfig: {
        officialSkillEnabled: model.flags.officialSkillEnabled,
        webSkillEnabled: model.flags.webSkillEnabled,
      },
      providerState: model.providerState,
    })
  } catch (error) {
    if (error.code === "provider-config-mismatch") {
      return planFromMismatch(model, target)
    }
    throw error
  }

  if (status.provider === target && !status.migrationRequired) {
    return { from: status.provider, to: target, steps: [], status }
  }

  if (status.provider === target && status.migrationRequired) {
    return {
      from: status.provider,
      to: target,
      steps: [{ type: "write-provider-state", provider: target }],
      status,
    }
  }

  return { ...planProviderSwitch({ from: status.provider, to: target }), status }
}

function executeStep(step, { currentConfig, paths, io }) {
  if (step.type === "write-provider-state") {
    const contents = renderProviderState(step.provider)
    atomicWriteFile(paths.providerStatePath, contents, io)
    return { providerState: step.provider }
  }
  if (step.type === "write-skill-config") {
    // Skill enablement is identical for grok/gpt; provider.json carries the distinction.
    const renderedProvider = step.webEnabled
      ? WEB_PROVIDERS.includes(step.providerHint)
        ? step.providerHint
        : "grok"
      : "default"
    const next = renderProviderConfig(currentConfig, renderedProvider, paths.officialSkill, paths.webSkill)
    atomicWriteFile(paths.configPath, next, io)
    return { config: next }
  }
  fail("invalid-arguments", `unknown switch step: ${step.type}`)
}

export function switchProvider(provider, opts = {}) {
  const target = validateProvider(provider)
  const { codexRoot } = roots(opts)
  const paths = pathsFor(codexRoot)
  const io = opts.io || {}

  if (!existsSync(paths.officialSkill)) fail("official-imagegen-missing", paths.officialSkill)
  if (!existsSync(paths.webSkill)) fail("web-imagegen-missing", `${paths.webSkill}; run skill:install first`)

  const model = loadStatusModel(codexRoot, paths)
  // Detect external conflicts before planning writes.
  ensureNoExternalConflict(model.parts.before, model.parts.after, [paths.officialSkill, paths.webSkill])

  const plan = buildSwitchPlan(target, model)
  if (plan.steps.length === 0) {
    return publicResult(
      {
        status: opts.dryRun ? "dry-run" : "configured",
        provider: target,
        changed: false,
        restartRequired: true,
        steps: [],
        configPath: paths.configPath,
        providerStatePath: paths.providerStatePath,
        officialSkill: paths.officialSkill,
        webSkill: paths.webSkill,
      },
      opts.debug,
    )
  }

  if (opts.dryRun) {
    return publicResult(
      {
        status: "dry-run",
        provider: target,
        changed: true,
        restartRequired: true,
        steps: plan.steps.map((step) => ({
          type: step.type,
          ...(step.provider ? { provider: step.provider } : {}),
          ...(step.type === "write-skill-config"
            ? { officialEnabled: step.officialEnabled, webEnabled: step.webEnabled }
            : {}),
        })),
        configPath: paths.configPath,
        providerStatePath: paths.providerStatePath,
        officialSkill: paths.officialSkill,
        webSkill: paths.webSkill,
      },
      opts.debug,
    )
  }

  let currentConfig = model.current
  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]
    if (typeof opts.beforeStep === "function") opts.beforeStep(step, index)
    const written = executeStep(
      {
        ...step,
        providerHint: target,
      },
      { currentConfig, paths, io },
    )
    if (written.config) currentConfig = written.config
    if (typeof opts.afterStep === "function") opts.afterStep(step, index)
  }

  return publicResult(
    {
      status: "configured",
      provider: target,
      changed: true,
      restartRequired: true,
      configPath: paths.configPath,
      providerStatePath: paths.providerStatePath,
      officialSkill: paths.officialSkill,
      webSkill: paths.webSkill,
    },
    opts.debug,
  )
}

export function providerStatus(opts = {}) {
  const { codexRoot } = roots(opts)
  const paths = pathsFor(codexRoot)
  const model = loadStatusModel(codexRoot, paths)
  const installed = existsSync(paths.webSkill)

  if (!model.flags.hasManaged) {
    return publicResult(
      {
        status: "ok",
        provider: null,
        officialSkillEnabled: false,
        webSkillEnabled: false,
        migrationRequired: false,
        installed,
        restartRequired: false,
        configPath: paths.configPath,
        providerStatePath: paths.providerStatePath,
      },
      opts.debug,
    )
  }

  try {
    const derived = deriveProviderStatus({
      managedConfig: {
        officialSkillEnabled: model.flags.officialSkillEnabled,
        webSkillEnabled: model.flags.webSkillEnabled,
      },
      providerState: model.providerState,
    })
    return publicResult(
      {
        ...derived,
        installed,
        configPath: paths.configPath,
        providerStatePath: paths.providerStatePath,
      },
      opts.debug,
    )
  } catch (error) {
    if (error.code === "provider-config-mismatch") {
      fail("provider-config-mismatch", error.message, {
        officialSkillEnabled: model.flags.officialSkillEnabled,
        webSkillEnabled: model.flags.webSkillEnabled,
        providerState: model.providerState,
      })
    }
    throw error
  }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  if (opts.command === "install") return installSkill(opts)
  if (opts.command === "status") return providerStatus(opts)
  if (opts.command === "openai") fail("invalid-arguments", "openai is retired; use default")
  if (PUBLIC_SWITCH_COMMANDS.includes(opts.command)) return switchProvider(opts.command, opts)
  fail("invalid-arguments", `command must be install, ${PUBLIC_SWITCH_COMMANDS.join(", ")}, or status`)
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

export { PROVIDERS, WEB_PROVIDERS }
