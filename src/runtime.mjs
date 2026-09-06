import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { randomBytes } from "node:crypto"
import { assertSourceFile, writeChosenFile } from "./artifact.mjs"
import { acceptCandidate, extMatchesType } from "./candidates.mjs"
import {
  bindAttempt,
  debugAttempts,
  failAttempt,
  markAttemptCollected,
  remainingAttemptBudget,
  startAttempt,
} from "./attempts.mjs"
import { assertProviderMatch, JOB_PROVIDERS, validateChoose, validateInit } from "./contract.mjs"
import {
  createBatch,
  lastJob,
  latestJob,
  readJobFile,
  transition,
  writeBatch,
} from "./jobs.mjs"
import { candidateIdentityKeys } from "./providers/grok-identity.mjs"
import { gateGroupChoose, replayChoose } from "./select.mjs"
import { createJobDir, ensureSessionDir, extFor, nextOut } from "./paths.mjs"

export class RuntimeError extends Error {
  constructor(code, detail = code, extra = {}) {
    super(detail)
    this.code = code
    Object.assign(this, extra)
  }
}

function fail(code, detail, extra) {
  throw new RuntimeError(code, detail, extra)
}

function jsonFile(path, error = "invalid-request") {
  if (!path || !existsSync(path)) fail(error, `missing JSON file: ${path || "(unset)"}`)
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (cause) {
    fail(error, `invalid JSON file: ${path}`, { cause })
  }
}

function isWithin(child, parent) {
  const rel = relative(resolve(parent), resolve(child))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function withJobLock(jobDir, action) {
  const lockPath = join(jobDir, ".runtime.lock")
  let fd
  try {
    fd = openSync(lockPath, "wx")
  } catch (error) {
    if (error?.code === "EEXIST") fail("busy", `job is locked: ${jobDir}`)
    throw error
  }
  try {
    return action()
  } finally {
    closeSync(fd)
    unlinkSync(lockPath)
  }
}

async function withJobLockAsync(jobDir, action) {
  const lockPath = join(jobDir, ".runtime.lock")
  let fd
  try {
    fd = openSync(lockPath, "wx")
  } catch (error) {
    if (error?.code === "EEXIST") fail("busy", `job is locked: ${jobDir}`)
    throw error
  }
  try {
    return await action()
  } finally {
    closeSync(fd)
    unlinkSync(lockPath)
  }
}

function requireJob(jobDir) {
  const job = readJobFile(jobDir)
  if (!job) fail("no-job", `no job.json under ${jobDir || "(unset)"}`)
  return job
}

function budgetFields(job, purpose = "initial") {
  const budget = remainingAttemptBudget(job, purpose)
  return {
    attemptPolicy: job?.attemptPolicy || null,
    baseRemaining: budget.baseRemaining,
    recoveryRemaining: budget.recoveryRemaining,
  }
}

function safeJob(job) {
  if (!job) return null
  return {
    batchKey: job.batchKey,
    provider: job.provider || null,
    sessionID: job.sessionID,
    jobDir: job.jobDir,
    workflow: job.workflow,
    selection: job.selectionMode,
    state: job.state,
    requestedCount: job.requestedCount,
    actualCount: job.actualCount,
    incomplete: job.incomplete,
    recoveryRetryCount: job.recoveryRetryCount,
    refinementBudget: job.refinementBudget,
    refinementUsed: job.refinementUsed,
    activeAttemptId: job.activeAttemptId || null,
    attemptCount: Array.isArray(job.attempts) ? job.attempts.length : 0,
    ...budgetFields(job),
    candidates: (job.candidates || []).map(({
      id,
      path,
      key,
      contentKey: hash,
      type,
      width,
      height,
      provider,
      attemptId,
      providerAssetKey,
    }) => ({
      id,
      path,
      key,
      contentKey: hash,
      type,
      width,
      height,
      provider: provider || job.provider || null,
      attemptId: attemptId || null,
      providerAssetKey: providerAssetKey || key || null,
    })),
    chosenIds: job.chosenIds || [],
    chosenBy: job.chosenBy,
    saved: job.saved || [],
    lastError: job.lastError || null,
  }
}

function requireProvider(job, provider, { required = false } = {}) {
  if (!required && (provider == null || provider === "")) return job
  const checked = assertProviderMatch(job, provider)
  if (!checked.ok) fail(checked.error)
  return job
}

function requireWorkspaceInput(job, inputPath) {
  const workspace = job?.workspace
  if (!workspace) fail("workspace-required")
  const requestRoot = join(resolve(workspace), ".web-imagegen")
  if (!isWithin(inputPath, requestRoot)) {
    fail("invalid-request", "request JSON must be under <workspace>/.web-imagegen")
  }
}

function publicAttempt(attempt) {
  if (!attempt) return null
  return {
    attemptId: attempt.attemptId,
    purpose: attempt.purpose,
    status: attempt.status,
    ordinal: attempt.ordinal,
    assetCount: Array.isArray(attempt.response?.assetKeys) ? attempt.response.assetKeys.length : 0,
    error: attempt.failure?.error || null,
  }
}

async function validateReferences(paths) {
  return Promise.all((paths || []).map(async (path) => {
    try {
      return await assertSourceFile(path)
    } catch (error) {
      fail("ref-missing", `invalid reference image: ${path} (${error.message})`)
    }
  }))
}

export async function initFromRequest(requestPath) {
  const input = jsonFile(requestPath)
  const checked = validateInit(input)
  if (!checked.ok) fail(checked.error)
  const value = checked.value
  const requestRoot = join(resolve(value.workspace), ".web-imagegen")
  if (!isWithin(requestPath, requestRoot)) fail("invalid-request", "request JSON must be under <workspace>/.web-imagegen")
  const referenceIds = await validateReferences(value.refFiles)

  const sessionID = String(input.sessionID || `codex-${randomBytes(6).toString("hex")}`)
  const current = lastJob(sessionID, { workspace: value.workspace })
  if (current && ["preparing", "generating", "awaiting-user-selection", "candidates-ready"].includes(current.state)) {
    fail("batch-pending", `pending batch: ${current.batchKey}`, { job: safeJob(current) })
  }
  const sessionDir = ensureSessionDir({
    workspace: value.workspace,
    sessionID,
    sessionTitle: input.sessionTitle,
    prompt: value.prompt,
    anchor: input.anchor,
  })
  const jobDir = createJobDir(sessionDir, {
    goal: input.goal || value.prompt,
    reqs: input.reqs,
    redraw: input.redraw === true,
    prompt: value.prompt,
  })
  let job = writeBatch(
    createBatch({
      ...value,
      sessionID,
      sessionDir,
      jobDir,
      goal: input.goal || value.prompt,
      reqs: input.reqs || null,
      sessionTitle: input.sessionTitle || null,
      selectionMode: value.selection,
      state: "preparing",
      referenceIds: referenceIds.map(({ path, type, width, height }) => ({ path, type, width, height })),
    }),
  )
  job = transition(job, "generating")
  unlinkSync(requestPath)
  return {
    status: "generating",
    ...safeJob(job),
    prompt: job.prompt,
    quality: job.quality,
    aspect: job.aspect,
    clickQuality: value.clickQuality,
    clickAspect: value.clickAspect,
  }
}

export function startAttemptJob(jobDir, inputPath, { provider } = {}) {
  return withJobLock(jobDir, () => {
    const job = requireProvider(requireJob(jobDir), provider, { required: true })
    requireWorkspaceInput(job, inputPath)
    const input = jsonFile(inputPath)
    if (input.batchKey && input.batchKey !== job.batchKey) fail("selection-stale", "attempt-start batchKey does not match job")
    if (job.state !== "generating" && job.state !== "preparing") fail("batch-not-ready", `cannot start attempt from ${job.state}`)
    const result = startAttempt(job, {
      provider,
      purpose: input.purpose,
      prompt: input.prompt ?? job.prompt,
      browserContext: input.browserContext,
    })
    if (!result.ok) fail(result.error, result.error, { attemptId: result.attemptId || null })
    writeBatch(result.job)
    unlinkSync(inputPath)
    return {
      status: "ok",
      idempotent: result.idempotent === true,
      attempt: publicAttempt(result.attempt),
      ...budgetFields(result.job, result.attempt.purpose),
      ...safeJob(result.job),
    }
  })
}

export function bindAttemptJob(jobDir, inputPath, { provider } = {}) {
  return withJobLock(jobDir, () => {
    const job = requireProvider(requireJob(jobDir), provider, { required: true })
    requireWorkspaceInput(job, inputPath)
    const input = jsonFile(inputPath)
    if (input.batchKey && input.batchKey !== job.batchKey) fail("selection-stale", "attempt-bind batchKey does not match job")
    const result = bindAttempt(job, {
      provider,
      attemptId: input.attemptId,
      observation: input.observation || input.identity,
    })
    if (!result.ok) fail(result.error, result.error, { attemptId: result.attemptId || input.attemptId || null })
    writeBatch(result.job)
    unlinkSync(inputPath)
    return {
      status: "ok",
      idempotent: result.idempotent === true,
      attempt: publicAttempt(result.attempt),
      validator: result.validator || null,
      ...budgetFields(result.job, result.attempt.purpose),
      ...safeJob(result.job),
    }
  })
}

export function failAttemptJob(jobDir, { provider, attempt, error } = {}) {
  return withJobLock(jobDir, () => {
    const job = requireProvider(requireJob(jobDir), provider, { required: true })
    const result = failAttempt(job, { provider, attemptId: attempt, error })
    if (!result.ok) fail(result.error, result.error, { attemptId: result.attemptId || attempt || null })
    writeBatch(result.job)
    return {
      status: "ok",
      idempotent: result.idempotent === true,
      attempt: publicAttempt(result.attempt),
      recoveryEligible: result.recoveryEligible === true,
      fillEligible: result.fillEligible === true,
      ...budgetFields(result.job, result.attempt.purpose),
      ...safeJob(result.job),
    }
  })
}

function rejectEntry(pathOrName, error) {
  const raw = String(pathOrName || "")
  return { name: basename(raw) || raw || "(unknown)", error: String(error || "invalid-request") }
}

function requireCollectAttempt(job, manifest) {
  const provider = String(manifest.provider || "")
  const attemptId = String(manifest.attemptId || "")
  if (!JOB_PROVIDERS.includes(provider)) fail("invalid-provider")
  if (!attemptId) fail("invalid-request", "collect manifest requires attemptId")
  if (job.provider !== provider) fail("provider-mismatch")
  const attempt = (job.attempts || []).find((item) => item.attemptId === attemptId)
  if (!attempt || attempt.status !== "bound") fail("attempt-not-ready")
  const assetKeys = new Set((attempt.response?.assetKeys || []).map(String))
  return { provider, attemptId, attempt, assetKeys }
}

function resolveProviderAssetKey(entry) {
  if (!entry || typeof entry !== "object") return ""
  if (entry.providerAssetKey != null && String(entry.providerAssetKey).trim()) return String(entry.providerAssetKey)
  if (entry.key != null && String(entry.key).trim()) return String(entry.key)
  return ""
}

async function inputItems(manifest, { assetKeys }) {
  const raw = Array.isArray(manifest.files) ? manifest.files : []
  return Promise.all(raw.map(async (item) => {
    const entry = typeof item === "string" ? { path: item } : item || {}
    const path = resolve(String(entry.path || ""))
    const providerAssetKey = resolveProviderAssetKey(entry)
    if (!providerAssetKey) return { ...entry, path, providerAssetKey, error: "asset-identity-missing" }
    if (!assetKeys.has(providerAssetKey)) return { ...entry, path, providerAssetKey, error: "asset-identity-missing" }
    if (!entry.path || !existsSync(path)) return { ...entry, path, providerAssetKey, error: "no-job" }
    try {
      await assertSourceFile(path, { minLongEdge: 512 })
    } catch (error) {
      return { ...entry, path, providerAssetKey, error: error.message }
    }
    const buf = readFileSync(path)
    return {
      ...entry,
      path,
      providerAssetKey,
      key: providerAssetKey,
      buf,
      src: entry.src || entry.url || providerAssetKey,
    }
  }))
}

function appendCandidates(job, items, { provider, attemptId }) {
  const candidates = [...(job.candidates || [])]
  const seenKeys = new Set(candidates.map((item) => item.key || item.providerAssetKey).filter(Boolean))
  const seenContent = new Set(candidates.map((item) => item.contentKey).filter(Boolean))
  const beforeKeys = new Set(job.beforeKeys || [])
  const rejected = []
  for (const item of items) {
    if (item.error) {
      rejected.push(rejectEntry(item.path || item.providerAssetKey, item.error))
      continue
    }
    const accepted = acceptCandidate(item, { beforeKeys, seenKeys, seenContent })
    if (!accepted.ok) {
      rejected.push(rejectEntry(item.path, accepted.error))
      continue
    }
    if (!extMatchesType(item.path, accepted.type)) {
      rejected.push(rejectEntry(item.path, "ext-mismatch"))
      continue
    }
    const id = String(candidates.length + 1)
    const destination = join(job.jobDir, `${id}${extFor(accepted.type)}`)
    copyFileSync(item.path, destination)
    const providerAssetKey = item.providerAssetKey || accepted.key
    candidates.push({
      id,
      path: destination,
      originalPath: item.path,
      key: providerAssetKey,
      providerAssetKey,
      provider,
      attemptId,
      contentKey: accepted.contentKey,
      type: accepted.type,
      width: accepted.width,
      height: accepted.height,
    })
    seenKeys.add(providerAssetKey)
    seenContent.add(accepted.contentKey)
  }
  return { candidates, rejected }
}

function finalizeCollectedAttempt(job, attemptId, patch) {
  const marked = markAttemptCollected(job, attemptId)
  if (!marked.ok) fail(marked.error || "attempt-not-ready")
  return transition(marked.job, patch.state, {
    ...patch,
    attempts: marked.job.attempts,
    activeAttemptId: marked.job.activeAttemptId,
  })
}

function requestedCandidateCount(job) {
  return job.workflow === "ai" ? 2 : Number(job.requestedCount) || 0
}

/**
 * Grok AI keeps a single initial attempt bound across one in-attempt retry
 * (page ×2 / recoveryRetryCount). GPT finalizes each attempt and uses fill.
 */
export async function collectJob(jobDir, manifestPath) {
  return withJobLockAsync(jobDir, async () => {
    const job = requireJob(jobDir)
    if (job.state !== "generating") fail("batch-not-ready", `cannot collect from ${job.state}`)
    const manifest = jsonFile(manifestPath)
    if (manifest.batchKey !== job.batchKey) fail("selection-stale", "manifest batchKey does not match job")
    const { provider, attemptId, assetKeys } = requireCollectAttempt(job, manifest)

    if (job.workflow === "user" && job.selectionMode === "single") {
      const frozen = manifest.candidates || manifest.keys || []
      if (!frozen.length) fail("selection-not-ready", "single-selection manifest has no stable candidate identity")
      const normalized = []
      for (const item of frozen) {
        const entry = typeof item === "string" ? { providerAssetKey: item, key: item } : item || {}
        const providerAssetKey = resolveProviderAssetKey(entry)
        if (!providerAssetKey || !assetKeys.has(providerAssetKey)) {
          fail("asset-identity-missing", "single-selection identity is not bound to this attempt")
        }
        normalized.push({ ...entry, key: providerAssetKey, providerAssetKey })
      }
      const keys = candidateIdentityKeys(normalized)
      if (!keys.length) fail("selection-not-ready", "single-selection manifest has no stable candidate identity")
      const next = finalizeCollectedAttempt(job, attemptId, {
        state: "awaiting-user-selection",
        candidateKeys: keys,
        actualCount: Number(manifest.actualCount) || frozen.length,
        incomplete: false,
        lastError: null,
      })
      return { status: "awaiting-user-selection", ...safeJob(next) }
    }

    const { candidates, rejected } = appendCandidates(job, await inputItems(manifest, { assetKeys }), {
      provider,
      attemptId,
    })
    const requested = requestedCandidateCount(job)
    const enough = candidates.length >= requested

    // Grok AI: one initial attempt; keep bound for a single same-attempt retry.
    if (provider === "grok" && job.workflow === "ai" && !enough) {
      if (job.recoveryRetryCount < 1) {
        const next = writeBatch({
          ...job,
          candidates,
          actualCount: candidates.length,
          incomplete: true,
          recoveryRetryCount: job.recoveryRetryCount + 1,
          lastError: "insufficient-candidates",
        })
        return { status: "retry", retry: true, rejected, ...safeJob(next) }
      }
      writeBatch({ ...job, candidates, actualCount: candidates.length, incomplete: true, lastError: "insufficient-candidates" })
      fail("insufficient-candidates", `${candidates.length}/${requested} valid candidates`, { rejected })
    }

    // Grok user group: any positive set is ready (possibly incomplete); zero fails.
    if (provider === "grok") {
      if (candidates.length === 0) {
        writeBatch({ ...job, candidates, actualCount: 0, incomplete: true, lastError: "timeout" })
        fail("timeout", `0/${requested} valid candidates`, { rejected })
      }
      const finalCandidates = candidates.slice(0, requested)
      const next = finalizeCollectedAttempt(job, attemptId, {
        state: "candidates-ready",
        candidates: finalCandidates,
        candidateKeys: candidateIdentityKeys(finalCandidates),
        actualCount: finalCandidates.length,
        incomplete: finalCandidates.length < requested,
        lastError: null,
      })
      return { status: "candidates-ready", rejected, ...safeJob(next) }
    }

    // GPT: always close the current attempt after collect; fill/recovery are new attempts.
    if (enough) {
      const finalCandidates = candidates.slice(0, requested)
      const next = finalizeCollectedAttempt(job, attemptId, {
        state: "candidates-ready",
        candidates: finalCandidates,
        candidateKeys: candidateIdentityKeys(finalCandidates),
        actualCount: finalCandidates.length,
        incomplete: false,
        lastError: null,
      })
      return { status: "candidates-ready", rejected, ...safeJob(next) }
    }

    const marked = markAttemptCollected(job, attemptId)
    if (!marked.ok) fail(marked.error || "attempt-not-ready")
    const afterCollect = {
      ...marked.job,
      candidates,
      candidateKeys: candidateIdentityKeys(candidates),
      actualCount: candidates.length,
      incomplete: true,
      lastError: candidates.length === 0 ? "insufficient-candidates" : null,
    }
    const budget = remainingAttemptBudget(afterCollect, "fill")
    const recoveryBudget = remainingAttemptBudget(afterCollect, "recovery")

    if (candidates.length === 0) {
      // Group: never auto-retry. AI: only continue when fill/recovery budget remains.
      if (job.workflow === "user" || (budget.baseRemaining <= 0 && recoveryBudget.recoveryRemaining <= 0)) {
        writeBatch({ ...afterCollect, lastError: job.workflow === "ai" ? "attempt-budget-exhausted" : "timeout" })
        fail(
          job.workflow === "ai" ? "attempt-budget-exhausted" : "timeout",
          `0/${requested} valid candidates`,
          { rejected, ...budgetFields(afterCollect) },
        )
      }
      const next = writeBatch({ ...afterCollect, state: "generating" })
      return {
        status: "generating",
        rejected,
        fillEligible: budget.baseRemaining > 0,
        recoveryEligible: recoveryBudget.recoveryRemaining > 0,
        ...safeJob(next),
      }
    }

    if (budget.baseRemaining > 0 && job.workflow === "ai") {
      const next = writeBatch({ ...afterCollect, state: "generating", lastError: null })
      return {
        status: "generating",
        rejected,
        fillEligible: true,
        recoveryEligible: false,
        ...safeJob(next),
      }
    }

    if (budget.baseRemaining > 0 && job.workflow === "user" && job.selectionMode === "group") {
      const next = writeBatch({ ...afterCollect, state: "generating", lastError: null })
      return {
        status: "generating",
        rejected,
        fillEligible: true,
        recoveryEligible: false,
        ...safeJob(next),
      }
    }

    // Budget exhausted with at least one candidate → ready incomplete (group) or AI fail.
    if (job.workflow === "ai") {
      writeBatch({ ...afterCollect, lastError: "attempt-budget-exhausted" })
      fail("attempt-budget-exhausted", `${candidates.length}/${requested} valid candidates`, {
        rejected,
        ...budgetFields(afterCollect),
      })
    }

    const finalCandidates = candidates.slice(0, requested)
    const next = transition(afterCollect, "candidates-ready", {
      candidates: finalCandidates,
      candidateKeys: candidateIdentityKeys(finalCandidates),
      actualCount: finalCandidates.length,
      incomplete: finalCandidates.length < requested,
      lastError: null,
      attempts: afterCollect.attempts,
      activeAttemptId: afterCollect.activeAttemptId,
    })
    return { status: "candidates-ready", rejected, ...safeJob(next) }
  })
}

function identityMatches(job, value) {
  const expected = new Set(candidateIdentityKeys((job.candidateKeys || []).map((key) => ({ key }))))
  const actual = candidateIdentityKeys([{ key: value }])
  return actual.some((key) => expected.has(key))
}

function candidateIds(job, ids) {
  const list = ids[0] === "all" ? (job.candidates || []).map((item) => String(item.id)) : ids
  const byId = new Map((job.candidates || []).map((item) => [String(item.id), item]))
  const chosen = list.map((id) => byId.get(String(id)))
  if (chosen.some((item) => !item)) fail("unknown-id")
  return { list, chosen }
}

export async function chooseJob(jobDir, options = {}) {
  return withJobLockAsync(jobDir, async () => {
    const job = requireProvider(requireJob(jobDir), options.provider, { required: true })
    const checked = validateChoose({ ...options, jobDir, batchKey: job.batchKey })
    if (!checked.ok) fail(checked.error)
    const value = checked.value
    const replay = replayChoose(job, { source: value.source, ids: options.ids })
    if (replay.idempotent) return { ...replay.result, idempotent: true }

    let chosenIds
    let sources
    if (value.source === "post") {
      if (job.state !== "awaiting-user-selection") fail("selection-not-ready")
      if (!options.file) fail("invalid-request", "post selection requires --file")
      if (!options.key || !identityMatches(job, options.key)) fail("selection-stale", "post identity does not belong to this batch")
      await assertSourceFile(options.file, { minLongEdge: 512 })
      chosenIds = [String(options.key)]
      sources = [{ id: String(options.key), path: resolve(options.file) }]
    } else {
      if (job.state !== "candidates-ready") fail("batch-not-ready")
      if (job.workflow === "ai" && (value.chosenBy !== "agent" || value.ids.length !== 1)) fail("invalid-request")
      const gate = gateGroupChoose(job, { ids: options.ids })
      if (!gate.ok) fail(gate.error)
      const resolved = candidateIds(job, gate.ids)
      chosenIds = resolved.list
      sources = resolved.chosen
    }
    if (sources.length > 1 && options.out) fail("invalid-request", "--out is only valid for one chosen image")

    const saved = []
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i]
      const output = options.out
        ? nextOut(resolve(options.out))
        : join(job.jobDir, sources.length === 1 ? "chosen.jpg" : `chosen-${source.id}.jpg`)
      saved.push(await writeChosenFile(source.path, output, { artifact: value.source }))
    }
    const result = {
      status: "chosen",
      batchKey: job.batchKey,
      chosenIds,
      chosenId: chosenIds[0] || null,
      chosenBy: value.chosenBy,
      source: value.source,
      saved,
      idempotent: false,
    }
    transition(job, "chosen", {
      chosenId: result.chosenId,
      chosenIds,
      chosenBy: value.chosenBy,
      chosenAt: new Date().toISOString(),
      chooseSource: value.source,
      idempotencyKey: value.idempotencyKey,
      saved,
      artifact: saved[0] || null,
      lastChooseResult: result,
      lastError: null,
    })
    return result
  })
}

export function redrawJob(jobDir, { refine = false, reason = null, prompt = null, provider } = {}) {
  return withJobLock(jobDir, () => {
    const job = requireProvider(requireJob(jobDir), provider, { required: true })
    const retryableFailure = job.state === "generating" && Boolean(job.lastError)
    if (!["awaiting-user-selection", "candidates-ready"].includes(job.state) && !retryableFailure) fail("batch-not-ready")
    if (refine) {
      if (job.workflow !== "ai" || job.refinementUsed >= job.refinementBudget) fail("invalid-request", "refinement budget exhausted")
      if (!reason) fail("invalid-request", "refinement requires a reason")
      if (!prompt || String(prompt).trim() === job.prompt.trim()) fail("invalid-request", "refinement requires a targeted prompt change")
    }
    const nextPrompt = prompt ? String(prompt) : job.prompt
    const ended = transition(job, "redraw", { refinementReason: refine ? String(reason) : job.refinementReason })
    const nextDir = createJobDir(job.sessionDir, { goal: job.goal || basename(job.jobDir), reqs: job.reqs, redraw: true, prompt: job.prompt })
    let next = writeBatch(createBatch({
      ...ended,
      batchKey: undefined,
      createdAt: undefined,
      jobDir: nextDir,
      prompt: nextPrompt,
      state: "preparing",
      candidates: [],
      candidateKeys: [],
      actualCount: 0,
      incomplete: false,
      recoveryRetryCount: 0,
      refinementUsed: job.refinementUsed + (refine ? 1 : 0),
      chosenId: null,
      chosenIds: [],
      chosenBy: null,
      chosenAt: null,
      chooseSource: null,
      idempotencyKey: null,
      saved: [],
      lastChooseResult: null,
      artifact: null,
      lastError: null,
      attempts: [],
      activeAttemptId: null,
      migrationUnprovable: false,
    }))
    next = transition(next, "generating")
    return { status: "generating", redraw: true, refine, ...safeJob(next), prompt: next.prompt, quality: next.quality, aspect: next.aspect }
  })
}

export function expireJob(jobDir, { reason = "selection-expired", provider } = {}) {
  return withJobLock(jobDir, () => {
    const job = requireProvider(requireJob(jobDir), provider, { required: true })
    if (job.state === "selection-expired") return { status: "selection-expired", idempotent: true, ...safeJob(job) }
    if (!["generating", "awaiting-user-selection", "candidates-ready"].includes(job.state)) fail("batch-not-ready")
    const next = transition(job, "selection-expired", {
      lastError: "selection-expired",
      expirationReason: String(reason).slice(0, 120),
    })
    return { status: "selection-expired", idempotent: false, ...safeJob(next) }
  })
}

export function cancelJob(jobDir, { provider } = {}) {
  return withJobLock(jobDir, () => {
    const job = requireProvider(requireJob(jobDir), provider, { required: true })
    if (job.state === "cancelled") return { status: "cancelled", idempotent: true, ...safeJob(job) }
    if (!["preparing", "generating", "awaiting-user-selection", "candidates-ready"].includes(job.state)) fail("batch-not-ready")
    const next = transition(job, "cancelled")
    return { status: "cancelled", idempotent: false, ...safeJob(next) }
  })
}

export function statusJob({ jobDir, workspace, sessionID, provider } = {}) {
  const job = jobDir ? requireJob(jobDir) : sessionID ? lastJob(sessionID, { workspace }) : latestJob(workspace)
  if (!job) fail("no-job")
  requireProvider(job, provider)
  return { status: "ok", ...safeJob(job) }
}

export function debugJob(jobDir, { provider } = {}) {
  const job = requireJob(jobDir)
  requireProvider(job, provider)
  const attemptDebug = debugAttempts(job)
  return {
    status: "ok",
    debug: {
      batchKey: job.batchKey,
      provider: job.provider || null,
      state: job.state,
      workflow: job.workflow,
      selection: job.selectionMode,
      requestedCount: job.requestedCount,
      actualCount: job.actualCount,
      incomplete: job.incomplete,
      recoveryRetryCount: job.recoveryRetryCount,
      refinementUsed: job.refinementUsed,
      lastError: job.lastError || null,
      migrationUnprovable: attemptDebug.migrationUnprovable,
      attempts: attemptDebug.attempts,
      baseRemaining: attemptDebug.baseRemaining,
      recoveryRemaining: attemptDebug.recoveryRemaining,
      candidates: (job.candidates || []).map(({ id, type, width, height }) => ({ id, type, width, height })),
    },
  }
}
