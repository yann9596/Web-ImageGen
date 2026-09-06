export const PROVIDERS = Object.freeze(["default", "grok", "gpt"])
export const WEB_PROVIDERS = Object.freeze(["grok", "gpt"])

const PROVIDER_STATE_SCHEMA = 1

function fail(error, detail, extra = {}) {
  const e = new Error(detail || error)
  e.code = error
  Object.assign(e, extra)
  throw e
}

export function validateProvider(value) {
  if (typeof value !== "string" || !PROVIDERS.includes(value)) {
    fail("invalid-provider", `unsupported provider: ${value}`, { field: "provider" })
  }
  return value
}

export function parseProviderState(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text ?? ""))
  } catch {
    fail("invalid-provider-state", "provider state is not valid JSON", { field: "provider.json" })
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("invalid-provider-state", "provider state must be an object", { field: "provider.json" })
  }
  if (parsed.schemaVersion !== PROVIDER_STATE_SCHEMA) {
    fail("invalid-provider-state", "unsupported schemaVersion", { field: "schemaVersion" })
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, "provider")) {
    fail("invalid-provider-state", "provider field is required", { field: "provider" })
  }
  const allowedKeys = new Set(["schemaVersion", "provider"])
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) {
      fail("invalid-provider-state", `unexpected field: ${key}`, { field: key })
    }
  }
  validateProvider(parsed.provider)
  return { schemaVersion: PROVIDER_STATE_SCHEMA, provider: parsed.provider }
}

export function renderProviderState(provider) {
  const value = validateProvider(provider)
  return `${JSON.stringify({ schemaVersion: PROVIDER_STATE_SCHEMA, provider: value })}\n`
}

/**
 * @param {{ managedConfig: { officialSkillEnabled: boolean, webSkillEnabled: boolean }, providerState: null | { provider: string } }} input
 */
export function deriveProviderStatus({ managedConfig, providerState }) {
  if (!managedConfig || typeof managedConfig !== "object") {
    fail("invalid-arguments", "managedConfig is required")
  }
  const official = Boolean(managedConfig.officialSkillEnabled)
  const web = Boolean(managedConfig.webSkillEnabled)
  const hasState = providerState != null
  const stateProvider = hasState ? validateProvider(providerState.provider) : null

  if (official === web) {
    fail("provider-config-mismatch", "official and web skills must be mutually exclusive")
  }

  if (!hasState) {
    if (official && !web) {
      return {
        status: "ok",
        provider: "default",
        officialSkillEnabled: true,
        webSkillEnabled: false,
        migrationRequired: true,
        legacySource: "managed-block",
        restartRequired: false,
      }
    }
    if (!official && web) {
      return {
        status: "ok",
        provider: "grok",
        officialSkillEnabled: false,
        webSkillEnabled: true,
        migrationRequired: true,
        legacySource: "managed-block",
        restartRequired: false,
      }
    }
    fail("provider-config-mismatch", "legacy provider state cannot be derived")
  }

  if (official && !web && stateProvider === "default") {
    return {
      status: "ok",
      provider: "default",
      officialSkillEnabled: true,
      webSkillEnabled: false,
      migrationRequired: false,
      restartRequired: false,
    }
  }
  if (!official && web && (stateProvider === "grok" || stateProvider === "gpt")) {
    return {
      status: "ok",
      provider: stateProvider,
      officialSkillEnabled: false,
      webSkillEnabled: true,
      migrationRequired: false,
      restartRequired: false,
    }
  }
  fail("provider-config-mismatch", "skill enablement does not match provider state")
}

/**
 * @param {{ from: string, to: string }} input
 * @returns {{ from: string, to: string, steps: Array<{ type: string, provider?: string, officialEnabled?: boolean, webEnabled?: boolean }> }}
 */
export function planProviderSwitch({ from, to }) {
  const source = validateProvider(from)
  const target = validateProvider(to)
  if (source === target) {
    return { from: source, to: target, steps: [] }
  }

  const sourceIsWeb = WEB_PROVIDERS.includes(source)
  const targetIsWeb = WEB_PROVIDERS.includes(target)

  if (!sourceIsWeb && targetIsWeb) {
    return {
      from: source,
      to: target,
      steps: [
        { type: "write-provider-state", provider: target },
        { type: "write-skill-config", officialEnabled: false, webEnabled: true },
      ],
    }
  }

  if (sourceIsWeb && !targetIsWeb) {
    return {
      from: source,
      to: target,
      steps: [
        { type: "write-skill-config", officialEnabled: true, webEnabled: false },
        { type: "write-provider-state", provider: target },
      ],
    }
  }

  // grok ↔ gpt: skill flags unchanged
  return {
    from: source,
    to: target,
    steps: [{ type: "write-provider-state", provider: target }],
  }
}
