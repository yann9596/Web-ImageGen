import { test } from "node:test"
import assert from "node:assert/strict"
import {
  PROVIDERS,
  WEB_PROVIDERS,
  validateProvider,
  parseProviderState,
  renderProviderState,
  deriveProviderStatus,
  planProviderSwitch,
} from "../src/provider-config.mjs"

function expectCode(fn, code) {
  assert.throws(fn, (error) => error.code === code)
}

test("PC-01 accepts only canonical provider values", () => {
  assert.deepEqual([...PROVIDERS], ["default", "grok", "gpt"])
  assert.deepEqual([...WEB_PROVIDERS], ["grok", "gpt"])
  for (const value of PROVIDERS) {
    assert.equal(validateProvider(value), value)
  }
  for (const value of ["", "openai", "chatgpt", "Grok", "GPT", "Default", "unknown", null, undefined, 1]) {
    expectCode(() => validateProvider(value), "invalid-provider")
  }
})

test("PC-02 round-trips provider state and rejects broken schemas", () => {
  for (const provider of PROVIDERS) {
    const rendered = renderProviderState(provider)
    assert.equal(rendered, `{"schemaVersion":1,"provider":"${provider}"}\n`)
    assert.deepEqual(parseProviderState(rendered), { schemaVersion: 1, provider })
  }

  expectCode(() => parseProviderState("{"), "invalid-provider-state")
  expectCode(() => parseProviderState("[]"), "invalid-provider-state")
  expectCode(() => parseProviderState('{"provider":"grok"}'), "invalid-provider-state")
  expectCode(() => parseProviderState('{"schemaVersion":2,"provider":"grok"}'), "invalid-provider-state")
  expectCode(() => parseProviderState('{"schemaVersion":1}'), "invalid-provider-state")
  expectCode(() => parseProviderState('{"schemaVersion":1,"provider":"openai"}'), "invalid-provider")
  expectCode(
    () => parseProviderState('{"schemaVersion":1,"provider":"grok","apiKey":"x"}'),
    "invalid-provider-state",
  )
})

test("PC-03 skill matrix only allows three consistent combinations", () => {
  const cases = []
  for (const official of [true, false]) {
    for (const web of [true, false]) {
      for (const provider of PROVIDERS) {
        cases.push({ official, web, provider })
      }
    }
  }

  const ok = []
  const mismatches = []
  for (const item of cases) {
    try {
      const status = deriveProviderStatus({
        managedConfig: { officialSkillEnabled: item.official, webSkillEnabled: item.web },
        providerState: { provider: item.provider },
      })
      ok.push({ ...item, status })
    } catch (error) {
      assert.equal(error.code, "provider-config-mismatch")
      mismatches.push(item)
    }
  }

  assert.equal(ok.length, 3)
  assert.deepEqual(
    ok.map((item) => [item.official, item.web, item.provider, item.status.provider]),
    [
      [true, false, "default", "default"],
      [false, true, "grok", "grok"],
      [false, true, "gpt", "gpt"],
    ],
  )
  assert.equal(mismatches.length, cases.length - 3)
})

test("PC-04 legacy managed-block reads require migration and do not invent gpt", () => {
  const legacyDefault = deriveProviderStatus({
    managedConfig: { officialSkillEnabled: true, webSkillEnabled: false },
    providerState: null,
  })
  assert.deepEqual(legacyDefault, {
    status: "ok",
    provider: "default",
    officialSkillEnabled: true,
    webSkillEnabled: false,
    migrationRequired: true,
    legacySource: "managed-block",
    restartRequired: false,
  })

  const legacyGrok = deriveProviderStatus({
    managedConfig: { officialSkillEnabled: false, webSkillEnabled: true },
    providerState: null,
  })
  assert.deepEqual(legacyGrok, {
    status: "ok",
    provider: "grok",
    officialSkillEnabled: false,
    webSkillEnabled: true,
    migrationRequired: true,
    legacySource: "managed-block",
    restartRequired: false,
  })

  expectCode(
    () =>
      deriveProviderStatus({
        managedConfig: { officialSkillEnabled: true, webSkillEnabled: true },
        providerState: null,
      }),
    "provider-config-mismatch",
  )
  expectCode(
    () =>
      deriveProviderStatus({
        managedConfig: { officialSkillEnabled: false, webSkillEnabled: false },
        providerState: null,
      }),
    "provider-config-mismatch",
  )
})

test("GPT-006 plans never enable both skills in one step", () => {
  assert.deepEqual(planProviderSwitch({ from: "default", to: "grok" }).steps, [
    { type: "write-provider-state", provider: "grok" },
    { type: "write-skill-config", officialEnabled: false, webEnabled: true },
  ])
  assert.deepEqual(planProviderSwitch({ from: "default", to: "gpt" }).steps, [
    { type: "write-provider-state", provider: "gpt" },
    { type: "write-skill-config", officialEnabled: false, webEnabled: true },
  ])
  assert.deepEqual(planProviderSwitch({ from: "grok", to: "default" }).steps, [
    { type: "write-skill-config", officialEnabled: true, webEnabled: false },
    { type: "write-provider-state", provider: "default" },
  ])
  assert.deepEqual(planProviderSwitch({ from: "gpt", to: "default" }).steps, [
    { type: "write-skill-config", officialEnabled: true, webEnabled: false },
    { type: "write-provider-state", provider: "default" },
  ])
  assert.deepEqual(planProviderSwitch({ from: "grok", to: "gpt" }).steps, [
    { type: "write-provider-state", provider: "gpt" },
  ])
  assert.deepEqual(planProviderSwitch({ from: "gpt", to: "grok" }).steps, [
    { type: "write-provider-state", provider: "grok" },
  ])
  assert.deepEqual(planProviderSwitch({ from: "grok", to: "grok" }).steps, [])

  for (const plan of [
    planProviderSwitch({ from: "default", to: "grok" }),
    planProviderSwitch({ from: "grok", to: "default" }),
    planProviderSwitch({ from: "grok", to: "gpt" }),
  ]) {
    for (const step of plan.steps) {
      if (step.type === "write-skill-config") {
        assert.notEqual(step.officialEnabled, step.webEnabled)
        assert.equal(step.officialEnabled || step.webEnabled, true)
      }
    }
  }
})
