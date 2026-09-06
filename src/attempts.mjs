import { createHash } from "node:crypto"
import { WEB_PROVIDERS } from "./provider-config.mjs"
import { validateGrokIdentity } from "./providers/grok-identity.mjs"
import { validateGptIdentity } from "./providers/gpt-identity.mjs"

export const ATTEMPT_PURPOSES = Object.freeze(["initial", "fill", "recovery"])
export const ATTEMPT_STATES = Object.freeze(["prepared", "bound", "collected", "failed"])

export const ATTEMPT_FAILURE_ERRORS = Object.freeze([
  "login-wall",
  "timeout",
  "quota",
  "blocked",
  "ui-changed",
  "busy",
  "empty",
  "truncated",
  "undecodable",
  "invalid-size",
  "ext-mismatch",
  "preview-size",
  "download-missing",
  "download-ambiguous",
  "wrong-provider-page",
  "conversation-not-isolated",
  "conversation-changed",
  "response-ambiguous",
  "asset-identity-missing",
  "reference-ambiguous",
  "generation-refused",
  "attempt-budget-exhausted",
  "submission-ambiguous",
  "runtime-failed",
])

export const RECOVERY_ELIGIBLE_ERRORS = Object.freeze([
  "login-wall",
  "timeout",
  "quota",
  "blocked",
  "ui-changed",
  "empty",
  "truncated",
  "undecodable",
  "invalid-size",
  "ext-mismatch",
  "preview-size",
  "download-missing",
  "download-ambiguous",
  "asset-identity-missing",
  "generation-refused",
  "runtime-failed",
])

const BASE_PURPOSES = Object.freeze(["initial", "fill"])

function failure(error, extra = {}) {
  return { ok: false, error, ...extra }
}

export function promptDigest(prompt) {
  return `sha256:${createHash("sha256").update(String(prompt || ""), "utf8").digest("hex")}`
}

function normalizeBrowserContext(input = {}) {
  if (!input || typeof input !== "object") return null
  const origin = input.origin == null ? null : String(input.origin)
  const conversationKey = input.conversationKey == null ? null : String(input.conversationKey)
  const beforeResponseAnchor = input.beforeResponseAnchor == null ? null : String(input.beforeResponseAnchor)
  return { origin, conversationKey, beforeResponseAnchor }
}

function sameBrowserContext(a, b) {
  const left = normalizeBrowserContext(a)
  const right = normalizeBrowserContext(b)
  if (!left || !right) return left === right
  return (
    left.origin === right.origin &&
    left.conversationKey === right.conversationKey &&
    left.beforeResponseAnchor === right.beforeResponseAnchor
  )
}

function sameStartInput(attempt, input) {
  return (
    attempt.purpose === input.purpose &&
    String(attempt.prompt || "") === String(input.prompt || "") &&
    sameBrowserContext(attempt.browserContext, input.browserContext)
  )
}

function sameResponse(existing, observation) {
  if (!existing || !observation) return false
  const leftKeys = Array.isArray(existing.assetKeys) ? existing.assetKeys.map(String) : []
  const rightKeys = Array.isArray(observation.assetKeys) ? observation.assetKeys.map(String) : []
  if (leftKeys.length !== rightKeys.length) return false
  for (let i = 0; i < leftKeys.length; i += 1) {
    if (leftKeys[i] !== rightKeys[i]) return false
  }
  return (
    String(existing.userTurnKey || "") === String(observation.userTurnKey || "") &&
    String(existing.responseKey || "") === String(observation.responseKey || "")
  )
}

export function validateAttemptIdentity(provider, observation, attempt = null) {
  const expected = attempt?.browserContext || {}
  const beforeKeys = observation?.beforeKeys
  if (provider === "grok") {
    return validateGrokIdentity({ observation, expected, beforeKeys })
  }
  if (provider === "gpt") {
    return validateGptIdentity({ observation, expected, beforeKeys })
  }
  return { ok: false, error: "invalid-provider", validator: null }
}

function realAttempts(job) {
  return (job?.attempts || []).filter((item) => item && item.synthetic !== true)
}

function activeOpenAttempt(job) {
  const id = job?.activeAttemptId
  if (!id) return null
  const found = (job.attempts || []).find((item) => item.attemptId === id)
  if (!found) return null
  if (found.status === "prepared" || found.status === "bound") return found
  return null
}

function nextAttemptId(job) {
  const ordinal = realAttempts(job).length + 1
  return { attemptId: `a${ordinal}`, ordinal }
}

function baseUsed(job) {
  return realAttempts(job).filter((item) => BASE_PURPOSES.includes(item.purpose)).length
}

function recoveryUsed(job) {
  return realAttempts(job).filter((item) => item.purpose === "recovery").length
}

function policyFromJob(job) {
  if (job?.attemptPolicy && Number.isInteger(job.attemptPolicy.baseLimit)) {
    return {
      baseLimit: job.attemptPolicy.baseLimit,
      recoveryLimit: Number(job.attemptPolicy.recoveryLimit) || 0,
    }
  }
  const computed = attemptPolicy({
    provider: job?.provider,
    workflow: job?.workflow,
    selection: job?.selectionMode || job?.selection,
    requestedCount: job?.requestedCount,
  })
  return computed.ok ? computed.value : { baseLimit: 0, recoveryLimit: 0 }
}

/**
 * Budget matrix for a Generation Batch.
 * GPT user/group targetCount is capped at 4; 5+ is rejected.
 */
export function attemptPolicy({ provider, workflow, selection, requestedCount } = {}) {
  if (!WEB_PROVIDERS.includes(provider)) return failure("invalid-provider")
  if (workflow !== "ai" && workflow !== "user") return failure("workflow-required")

  const count = Number(requestedCount)
  if (workflow === "ai") {
    if (provider === "grok") return { ok: true, value: { baseLimit: 1, recoveryLimit: 1 } }
    return { ok: true, value: { baseLimit: 2, recoveryLimit: 1 } }
  }

  const mode = selection || "single"
  if (mode === "single") {
    return { ok: true, value: { baseLimit: 1, recoveryLimit: 0 } }
  }
  if (mode !== "group") return failure("selection-required")

  if (!Number.isInteger(count) || count < 1) return failure("invalid-request")
  if (provider === "grok") {
    return { ok: true, value: { baseLimit: 1, recoveryLimit: 0 } }
  }
  if (count > 4) return failure("invalid-request")
  return { ok: true, value: { baseLimit: count, recoveryLimit: 0 } }
}

export function remainingAttemptBudget(job, purpose = "initial") {
  const policy = policyFromJob(job)
  if (purpose === "recovery") {
    return {
      baseRemaining: Math.max(0, policy.baseLimit - baseUsed(job)),
      recoveryRemaining: Math.max(0, policy.recoveryLimit - recoveryUsed(job)),
      purposeRemaining: Math.max(0, policy.recoveryLimit - recoveryUsed(job)),
    }
  }
  const baseRemaining = Math.max(0, policy.baseLimit - baseUsed(job))
  return {
    baseRemaining,
    recoveryRemaining: Math.max(0, policy.recoveryLimit - recoveryUsed(job)),
    purposeRemaining: baseRemaining,
  }
}

function assertProvider(job, provider) {
  if (!WEB_PROVIDERS.includes(provider)) return failure("invalid-provider")
  if (!job?.provider || job.provider !== provider) return failure("provider-mismatch")
  return { ok: true }
}

function cloneJob(job, patch) {
  return {
    ...job,
    ...patch,
    attempts: Array.isArray(patch.attempts) ? patch.attempts : [...(job.attempts || [])],
  }
}

export function startAttempt(job, input = {}) {
  if (!job) return failure("no-job")
  const provider = input.provider || job.provider
  const matched = assertProvider(job, provider)
  if (!matched.ok) return matched
  if (job.migrationUnprovable === true) return failure("selection-expired")

  const purpose = String(input.purpose || "")
  if (!ATTEMPT_PURPOSES.includes(purpose)) return failure("invalid-request")

  const prompt = String(input.prompt ?? job.prompt ?? "")
  if (!prompt.trim()) return failure("prompt-required")

  const browserContext = normalizeBrowserContext(input.browserContext)
  if (!browserContext?.origin || !browserContext.conversationKey || browserContext.beforeResponseAnchor == null) {
    return failure("invalid-request")
  }

  const open = activeOpenAttempt(job)
  if (open) {
    if (sameStartInput(open, { purpose, prompt, browserContext })) {
      return {
        ok: true,
        idempotent: true,
        attempt: open,
        job,
        ...remainingAttemptBudget(job, purpose),
      }
    }
    return failure("attempt-pending", { attemptId: open.attemptId })
  }

  const budget = remainingAttemptBudget(job, purpose)
  if (budget.purposeRemaining <= 0) return failure("attempt-budget-exhausted", budget)

  if (purpose === "recovery") {
    const lastFailure = [...realAttempts(job)].reverse().find((item) => item.status === "failed")
    const reason = lastFailure?.failure?.error
    if (!RECOVERY_ELIGIBLE_ERRORS.includes(reason)) {
      return failure("attempt-budget-exhausted", budget)
    }
  }

  const { attemptId, ordinal } = nextAttemptId(job)
  const attempt = {
    attemptId,
    ordinal,
    purpose,
    status: "prepared",
    prompt,
    promptDigest: promptDigest(prompt),
    browserContext,
    response: null,
    failure: null,
  }
  const attempts = [...(job.attempts || []), attempt]
  const next = cloneJob(job, {
    attempts,
    activeAttemptId: attemptId,
    state: job.state === "preparing" ? "generating" : job.state,
  })
  return {
    ok: true,
    idempotent: false,
    attempt,
    job: next,
    ...remainingAttemptBudget(next, purpose),
  }
}

export function bindAttempt(job, input = {}) {
  if (!job) return failure("no-job")
  const provider = input.provider || job.provider
  const matched = assertProvider(job, provider)
  if (!matched.ok) return matched

  const attemptId = String(input.attemptId || "")
  const attempt = (job.attempts || []).find((item) => item.attemptId === attemptId)
  if (!attempt) return failure("attempt-not-ready")
  if (attempt.status === "failed" || attempt.status === "collected") return failure("attempt-not-ready")

  const observation = input.observation || input.identity || null
  if (!observation || typeof observation !== "object") return failure("invalid-request")

  const identity = validateAttemptIdentity(provider, observation, attempt)
  if (!identity.ok) {
    return failure(identity.error || "invalid-request", {
      validator: identity.validator || null,
      attemptId,
    })
  }

  const boundResponse = {
    userTurnKey: identity.userTurnKey == null ? null : String(identity.userTurnKey),
    responseKey: String(identity.responseKey),
    assetKeys: identity.assetKeys.map(String),
  }

  if (attempt.status === "bound") {
    if (sameResponse(attempt.response, boundResponse)) {
      return {
        ok: true,
        idempotent: true,
        attempt,
        job,
        validator: identity.validator || null,
        ...remainingAttemptBudget(job, attempt.purpose),
      }
    }
    return failure("response-ambiguous", { attemptId, validator: identity.validator || null })
  }

  const nextAttempt = {
    ...attempt,
    status: "bound",
    response: boundResponse,
    failure: null,
  }
  const attempts = (job.attempts || []).map((item) => (item.attemptId === attemptId ? nextAttempt : item))
  const next = cloneJob(job, { attempts, activeAttemptId: attemptId })
  return {
    ok: true,
    idempotent: false,
    attempt: nextAttempt,
    job: next,
    validator: identity.validator || null,
    ...remainingAttemptBudget(next, attempt.purpose),
  }
}

export function failAttempt(job, input = {}) {
  if (!job) return failure("no-job")
  const provider = input.provider || job.provider
  const matched = assertProvider(job, provider)
  if (!matched.ok) return matched

  const attemptId = String(input.attemptId || input.attempt || job.activeAttemptId || "")
  const attempt = (job.attempts || []).find((item) => item.attemptId === attemptId)
  if (!attempt) return failure("attempt-not-ready")
  if (attempt.status === "collected") return failure("attempt-not-ready")
  if (attempt.status === "failed") {
    const budget = remainingAttemptBudget(job, attempt.purpose)
    return {
      ok: true,
      idempotent: true,
      attempt,
      job,
      recoveryEligible: RECOVERY_ELIGIBLE_ERRORS.includes(attempt.failure?.error),
      ...budget,
    }
  }

  const error = String(input.error || "")
  if (!ATTEMPT_FAILURE_ERRORS.includes(error)) return failure("invalid-request")
  // Never persist arbitrary page text — only the closed error code.
  const nextAttempt = {
    ...attempt,
    status: "failed",
    failure: { error },
  }
  const attempts = (job.attempts || []).map((item) => (item.attemptId === attemptId ? nextAttempt : item))
  const next = cloneJob(job, {
    attempts,
    activeAttemptId: null,
    lastError: error,
  })
  const budget = remainingAttemptBudget(next, attempt.purpose)
  const recoveryEligible = RECOVERY_ELIGIBLE_ERRORS.includes(error) && budget.recoveryRemaining > 0
  const fillEligible =
    BASE_PURPOSES.includes(attempt.purpose) &&
    budget.baseRemaining > 0 &&
    (job.candidates || []).length < (job.requestedCount || 0)

  return {
    ok: true,
    idempotent: false,
    attempt: nextAttempt,
    job: next,
    recoveryEligible,
    fillEligible,
    ...budget,
  }
}

/**
 * Deterministic next action after reloading job state from disk.
 * `observation` is optional page evidence for a prepared attempt crash window.
 */
export function nextAttemptAction(job, observation = null) {
  if (!job) return failure("no-job")
  if (job.migrationUnprovable === true) {
    return failure("selection-expired", { nextAction: "expire" })
  }

  const open = activeOpenAttempt(job)
  if (open?.status === "prepared") {
    if (observation && typeof observation === "object") {
      if (observation.ambiguous === true || observation.status === "ambiguous") {
        return failure("submission-ambiguous", { nextAction: "stop", attemptId: open.attemptId })
      }
      if (observation.submitted === false || observation.status === "not-submitted") {
        return {
          ok: true,
          nextAction: "continue-prepared",
          attemptId: open.attemptId,
          purpose: open.purpose,
        }
      }
      if (observation.uniqueResponse === true || observation.responseKey || observation.status === "unique") {
        return {
          ok: true,
          nextAction: "attempt-bind",
          attemptId: open.attemptId,
          purpose: open.purpose,
        }
      }
    }
    return {
      ok: true,
      nextAction: "attempt-bind",
      attemptId: open.attemptId,
      purpose: open.purpose,
    }
  }

  if (open?.status === "bound") {
    return {
      ok: true,
      nextAction: "collect",
      attemptId: open.attemptId,
      purpose: open.purpose,
    }
  }

  const collected = [...realAttempts(job)].reverse().find((item) => item.status === "collected")
  if (collected) {
    const have = (job.candidates || []).length
    const need = Number(job.requestedCount) || 0
    if (need > 0 && have >= need) {
      return {
        ok: true,
        nextAction: job.workflow === "user" && job.selectionMode === "single" ? "await-selection" : "await-selection",
        attemptId: collected.attemptId,
      }
    }
    const fillBudget = remainingAttemptBudget(job, "fill")
    if (fillBudget.baseRemaining > 0 && have < need) {
      return {
        ok: true,
        nextAction: "attempt-start",
        purpose: "fill",
        attemptId: null,
      }
    }
    const recoveryBudget = remainingAttemptBudget(job, "recovery")
    const lastFailure = [...realAttempts(job)].reverse().find((item) => item.status === "failed")
    if (
      recoveryBudget.recoveryRemaining > 0 &&
      RECOVERY_ELIGIBLE_ERRORS.includes(lastFailure?.failure?.error) &&
      have < need
    ) {
      return {
        ok: true,
        nextAction: "attempt-start",
        purpose: "recovery",
        attemptId: null,
      }
    }
    if (have > 0) {
      return {
        ok: true,
        nextAction: "await-selection",
        incomplete: have < need,
        attemptId: collected.attemptId,
      }
    }
    return failure("attempt-budget-exhausted", { nextAction: "stop" })
  }

  const failed = [...realAttempts(job)].reverse().find((item) => item.status === "failed")
  if (failed) {
    const budget = remainingAttemptBudget(job, "recovery")
    if (budget.recoveryRemaining > 0 && RECOVERY_ELIGIBLE_ERRORS.includes(failed.failure?.error)) {
      return {
        ok: true,
        nextAction: "attempt-start",
        purpose: "recovery",
        attemptId: null,
      }
    }
    const fillBudget = remainingAttemptBudget(job, "fill")
    if (fillBudget.baseRemaining > 0) {
      return {
        ok: true,
        nextAction: "attempt-start",
        purpose: failed.purpose === "initial" ? "fill" : "fill",
        attemptId: null,
      }
    }
    return failure("attempt-budget-exhausted", { nextAction: "stop", attemptId: failed.attemptId })
  }

  return {
    ok: true,
    nextAction: "attempt-start",
    purpose: "initial",
    attemptId: null,
  }
}

export function markAttemptCollected(job, attemptId) {
  if (!job) return failure("no-job")
  const attempt = (job.attempts || []).find((item) => item.attemptId === attemptId)
  if (!attempt || attempt.status !== "bound") return failure("attempt-not-ready")
  const nextAttempt = { ...attempt, status: "collected" }
  const attempts = (job.attempts || []).map((item) => (item.attemptId === attemptId ? nextAttempt : item))
  const next = cloneJob(job, {
    attempts,
    activeAttemptId: null,
  })
  return { ok: true, attempt: nextAttempt, job: next }
}

export function debugAttempts(job) {
  const budget = remainingAttemptBudget(job, "initial")
  return {
    provider: job?.provider || null,
    attempts: (job?.attempts || []).map((item) => ({
      attemptId: item.attemptId,
      purpose: item.purpose,
      status: item.status,
      assetCount: Array.isArray(item.response?.assetKeys) ? item.response.assetKeys.length : 0,
      error: item.failure?.error || null,
      synthetic: item.synthetic === true,
    })),
    baseRemaining: budget.baseRemaining,
    recoveryRemaining: budget.recoveryRemaining,
    migrationUnprovable: job?.migrationUnprovable === true,
  }
}
