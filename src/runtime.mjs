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
import { debugAttempts } from "./attempts.mjs"
import { assertProviderMatch, validateChoose, validateInit } from "./contract.mjs"
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
    candidates: (job.candidates || []).map(({ id, path, key, contentKey: hash, type, width, height }) => ({
      id,
      path,
      key,
      contentKey: hash,
      type,
      width,
      height,
    })),
    chosenIds: job.chosenIds || [],
    chosenBy: job.chosenBy,
    saved: job.saved || [],
    lastError: job.lastError || null,
  }
}

function requireProvider(job, provider) {
  if (provider == null || provider === "") return job
  const checked = assertProviderMatch(job, provider)
  if (!checked.ok) fail(checked.error)
  return job
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
  return { status: "generating", ...safeJob(job), prompt: job.prompt, quality: job.quality, aspect: job.aspect, clickQuality: value.clickQuality, clickAspect: value.clickAspect }
}

async function inputItems(manifest) {
  const raw = Array.isArray(manifest.files) ? manifest.files : []
  return Promise.all(raw.map(async (item) => {
    const entry = typeof item === "string" ? { path: item } : item || {}
    const path = resolve(String(entry.path || ""))
    if (!entry.path || !existsSync(path)) return { ...entry, path, error: "no-job" }
    try {
      await assertSourceFile(path, { minLongEdge: 512 })
    } catch (error) {
      return { ...entry, path, error: error.message }
    }
    const buf = readFileSync(path)
    return { ...entry, path, buf, src: entry.src || entry.url || entry.key || `file:${basename(path)}` }
  }))
}

function appendCandidates(job, items) {
  const candidates = [...(job.candidates || [])]
  const seenKeys = new Set(candidates.map((item) => item.key).filter(Boolean))
  const seenContent = new Set(candidates.map((item) => item.contentKey).filter(Boolean))
  const beforeKeys = new Set(job.beforeKeys || [])
  const rejected = []
  for (const item of items) {
    if (item.error) {
      rejected.push({ path: item.path, error: item.error })
      continue
    }
    const accepted = acceptCandidate(item, { beforeKeys, seenKeys, seenContent })
    if (!accepted.ok) {
      rejected.push({ path: item.path, error: accepted.error })
      continue
    }
    if (!extMatchesType(item.path, accepted.type)) {
      rejected.push({ path: item.path, error: "ext-mismatch" })
      continue
    }
    const id = String(candidates.length + 1)
    const destination = join(job.jobDir, `${id}${extFor(accepted.type)}`)
    copyFileSync(item.path, destination)
    candidates.push({
      id,
      path: destination,
      originalPath: item.path,
      key: accepted.key,
      contentKey: accepted.contentKey,
      type: accepted.type,
      width: accepted.width,
      height: accepted.height,
    })
    seenKeys.add(accepted.key)
    seenContent.add(accepted.contentKey)
  }
  return { candidates, rejected }
}

export async function collectJob(jobDir, manifestPath) {
  return withJobLockAsync(jobDir, async () => {
    const job = requireJob(jobDir)
    if (job.state !== "generating") fail("batch-not-ready", `cannot collect from ${job.state}`)
    const manifest = jsonFile(manifestPath)
    if (manifest.batchKey !== job.batchKey) fail("selection-stale", "manifest batchKey does not match job")

    if (job.workflow === "user" && job.selectionMode === "single") {
      const frozen = manifest.candidates || manifest.keys || []
      const keys = candidateIdentityKeys(frozen.map((item) => typeof item === "string" ? { key: item } : item))
      if (!keys.length) fail("selection-not-ready", "single-selection manifest has no stable candidate identity")
      const next = transition(job, "awaiting-user-selection", {
        candidateKeys: keys,
        actualCount: Number(manifest.actualCount) || frozen.length,
        incomplete: false,
        lastError: null,
      })
      return { status: "awaiting-user-selection", ...safeJob(next) }
    }

    const { candidates, rejected } = appendCandidates(job, await inputItems(manifest))
    const requested = job.workflow === "ai" ? 2 : job.requestedCount
    const enough = job.workflow === "ai" ? candidates.length >= 2 : candidates.length > 0
    if (!enough) {
      if (job.workflow === "ai" && job.recoveryRetryCount < 1) {
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
      const error = job.workflow === "ai" ? "insufficient-candidates" : "timeout"
      writeBatch({ ...job, candidates, actualCount: candidates.length, incomplete: true, lastError: error })
      fail(error, `${candidates.length}/${requested} valid candidates`, { rejected })
    }
    const finalCandidates = candidates.slice(0, requested)
    const next = transition(job, "candidates-ready", {
      candidates: finalCandidates,
      candidateKeys: candidateIdentityKeys(finalCandidates),
      actualCount: finalCandidates.length,
      incomplete: finalCandidates.length < requested,
      lastError: null,
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
    const job = requireJob(jobDir)
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

export function redrawJob(jobDir, { refine = false, reason = null, prompt = null } = {}) {
  return withJobLock(jobDir, () => {
    const job = requireJob(jobDir)
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

export function expireJob(jobDir, { reason = "selection-expired" } = {}) {
  return withJobLock(jobDir, () => {
    const job = requireJob(jobDir)
    if (job.state === "selection-expired") return { status: "selection-expired", idempotent: true, ...safeJob(job) }
    if (!["generating", "awaiting-user-selection", "candidates-ready"].includes(job.state)) fail("batch-not-ready")
    const next = transition(job, "selection-expired", {
      lastError: "selection-expired",
      expirationReason: String(reason).slice(0, 120),
    })
    return { status: "selection-expired", idempotent: false, ...safeJob(next) }
  })
}

export function cancelJob(jobDir) {
  return withJobLock(jobDir, () => {
    const job = requireJob(jobDir)
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
