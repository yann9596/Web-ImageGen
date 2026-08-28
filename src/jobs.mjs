import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"
import { JOB_STATES, PENDING_STATES, canStartNewBatch, normalizeIds } from "./contract.mjs"
import { findSessionDir } from "./paths.mjs"

const memory = new Map()

export const TRANSITIONS = Object.freeze({
  preparing: Object.freeze(["generating", "cancelled", "replaced-by-new-batch"]),
  generating: Object.freeze([
    "awaiting-user-selection",
    "candidates-ready",
    "cancelled",
    "redraw",
    "selection-expired",
    "replaced-by-new-batch",
  ]),
  "awaiting-user-selection": Object.freeze(["chosen", "cancelled", "redraw", "selection-expired", "replaced-by-new-batch"]),
  "candidates-ready": Object.freeze(["chosen", "cancelled", "redraw", "selection-expired", "replaced-by-new-batch"]),
  chosen: Object.freeze([]),
  cancelled: Object.freeze([]),
  redraw: Object.freeze([]),
  "selection-expired": Object.freeze([]),
  "replaced-by-new-batch": Object.freeze([]),
})

export function newBatchKey(now = Date.now()) {
  return `${now.toString(36)}-${randomBytes(4).toString("hex")}`
}

function stripCandidates(list) {
  if (!Array.isArray(list)) return []
  return list.map(({ buf, ...candidate }) => candidate)
}

export function createBatch(opts = {}) {
  const workflow = opts.workflow || "ai"
  const candidates = stripCandidates(opts.candidates)
  return {
    batchKey: opts.batchKey || newBatchKey(),
    sessionID: opts.sessionID || "_",
    workspace: opts.workspace || null,
    sessionDir: opts.sessionDir || null,
    jobDir: opts.jobDir || null,
    workflow,
    goal: opts.goal || null,
    reqs: opts.reqs || null,
    sessionTitle: opts.sessionTitle || null,
    state: opts.state || "preparing",
    selectionMode: opts.selectionMode || opts.selection || "single",
    prompt: String(opts.prompt || ""),
    originalPrompt: opts.originalPrompt ? String(opts.originalPrompt) : null,
    quality: opts.quality || (workflow === "ai" ? "standard" : "auto"),
    aspect: opts.aspect || "auto",
    refFiles: Array.isArray(opts.refFiles) ? opts.refFiles.map(String) : [],
    referenceIds: Array.isArray(opts.referenceIds) ? opts.referenceIds : [],
    beforeKeys: Array.isArray(opts.beforeKeys) ? opts.beforeKeys : [],
    candidateKeys: Array.isArray(opts.candidateKeys) ? opts.candidateKeys : [],
    candidates,
    requestedCount: opts.requestedCount ?? (workflow === "ai" ? 2 : 1),
    actualCount: opts.actualCount ?? candidates.length,
    incomplete: opts.incomplete === true,
    recoveryRetryCount: Number(opts.recoveryRetryCount) || 0,
    refinementBudget: opts.refinementBudget ?? (opts.refine === 1 ? 1 : 0),
    refinementUsed: Number(opts.refinementUsed) || 0,
    refinementReason: opts.refinementReason || null,
    chosenId: opts.chosenId || (Array.isArray(opts.chosenIds) ? opts.chosenIds[0] : null) || null,
    chosenIds: Array.isArray(opts.chosenIds) ? opts.chosenIds : [],
    chosenBy: opts.chosenBy || null,
    chosenAt: opts.chosenAt || null,
    chooseSource: opts.chooseSource || null,
    idempotencyKey: opts.idempotencyKey || null,
    saved: Array.isArray(opts.saved) ? opts.saved : [],
    lastChooseResult: opts.lastChooseResult || null,
    artifact: opts.artifact || null,
    lastError: opts.lastError || null,
    expirationReason: opts.expirationReason || null,
    createdAt: opts.createdAt || new Date().toISOString(),
    updatedAt: opts.updatedAt || new Date().toISOString(),
  }
}

export function jobJsonPath(jobDir) {
  return join(jobDir, "job.json")
}

export function readJobFile(jobDir) {
  if (!jobDir) return null
  const path = jobJsonPath(jobDir)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function readSessionFile(sessionDir) {
  if (!sessionDir) return null
  const path = join(sessionDir, "session.json")
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

export function writeBatch(batch) {
  if (!batch?.jobDir) throw new Error("no-job")
  mkdirSync(batch.jobDir, { recursive: true })
  const previous = readJobFile(batch.jobDir) || {}
  const next = createBatch({ ...previous, ...batch, updatedAt: new Date().toISOString() })
  writeFileSync(jobJsonPath(batch.jobDir), JSON.stringify(next, null, 2), "utf8")

  const sessionDir = next.sessionDir || dirname(next.jobDir)
  mkdirSync(sessionDir, { recursive: true })
  const session = readSessionFile(sessionDir) || {}
  writeFileSync(
    join(sessionDir, "session.json"),
    JSON.stringify({ ...session, sessionID: next.sessionID, lastBatchKey: next.batchKey, lastJobDir: next.jobDir }, null, 2),
    "utf8",
  )
  memory.set(next.sessionID || "_", next)
  return next
}

export function rememberJob(sessionID, job = {}) {
  const previousMemory = memory.get(sessionID || "_") || {}
  const previousDisk = readJobFile(job.jobDir) || {}
  const sameJob = Boolean(job.jobDir && previousMemory.jobDir === job.jobDir)
  const base = sameJob ? { ...previousDisk, ...previousMemory } : previousDisk
  const merged = {
    ...base,
    ...job,
    sessionID: sessionID || job.sessionID || previousMemory.sessionID || "_",
  }
  if (!sameJob && !job.batchKey) merged.batchKey = previousDisk.batchKey || newBatchKey()
  if (!sameJob && job.chosenIds == null && job.chosenId == null) {
    Object.assign(merged, {
      chosenId: null,
      chosenIds: [],
      chosenBy: null,
      chosenAt: null,
      chooseSource: null,
      idempotencyKey: null,
      saved: [],
      lastChooseResult: null,
      artifact: null,
    })
  }
  return writeBatch(merged)
}

export function lastJob(sessionID, loc = {}) {
  if (loc.jobDir) {
    const disk = readJobFile(loc.jobDir)
    if (disk && (!loc.batchKey || disk.batchKey === loc.batchKey)) {
      memory.set(disk.sessionID || sessionID || "_", disk)
      return disk
    }
  }
  const sid = sessionID || "_"
  const cached = memory.get(sid)
  if (cached && (!loc.batchKey || cached.batchKey === loc.batchKey)) return readJobFile(cached.jobDir) || cached
  if (loc.workspace) {
    const sessionDir = findSessionDir(loc.workspace, sid)
    const session = readSessionFile(sessionDir)
    const disk = session?.lastJobDir ? readJobFile(session.lastJobDir) : null
    if (disk && (!loc.batchKey || disk.batchKey === loc.batchKey)) {
      memory.set(sid, disk)
      return disk
    }
  }
  return null
}

function walkJobFiles(dir, out = []) {
  if (!dir || !existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (stat.isDirectory()) walkJobFiles(path, out)
    else if (name === "job.json") out.push({ path, mtimeMs: stat.mtimeMs })
  }
  return out
}

export function latestJob(workspace) {
  const files = walkJobFiles(join(workspace || "", "imagine"))
  let latest = null
  for (const item of files) {
    try {
      const job = JSON.parse(readFileSync(item.path, "utf8"))
      const time = Date.parse(job.updatedAt || "") || item.mtimeMs
      if (!latest || time > latest.time) latest = { time, job }
    } catch {}
  }
  return latest?.job || null
}

export function canTransition(from, to) {
  if (from === to) return true
  return (TRANSITIONS[from] || []).includes(to)
}

export function transition(batch, nextState, extra = {}) {
  if (!JOB_STATES.includes(nextState)) throw new Error(`invalid-state:${nextState}`)
  const from = batch?.state || "preparing"
  if (!canTransition(from, nextState)) throw new Error(`invalid-transition:${from}->${nextState}`)
  return writeBatch({ ...batch, ...extra, state: nextState })
}

export function assertCanStartBatch(sessionID, opts = {}) {
  const current = lastJob(sessionID, { workspace: opts.workspace, jobDir: opts.jobDir })
  if (!current) return { ok: true, current: null }
  const gate = canStartNewBatch(current.state, { redraw: opts.redraw, replaceBatch: opts.replaceBatch })
  if (!gate.ok) return { ok: false, error: "batch-pending", current }
  if (PENDING_STATES.includes(current.state)) {
    transition(current, opts.redraw ? "redraw" : "replaced-by-new-batch")
  }
  return { ok: true, current }
}

export function applyAgentChoice(batch, ids) {
  if (!batch) return { ok: false, error: "no-job" }
  if (batch.state !== "candidates-ready") return { ok: false, error: "batch-not-ready" }
  if ((batch.candidates || []).length !== 2) return { ok: false, error: "insufficient-candidates" }
  const list = normalizeIds(ids)
  if (list.length !== 1 || !["1", "2"].includes(list[0])) return { ok: false, error: "unknown-id" }
  return {
    ok: true,
    value: transition(batch, "chosen", {
      chosenId: list[0],
      chosenIds: list,
      chosenBy: "agent",
      chosenAt: new Date().toISOString(),
    }),
  }
}

export function clearJobMemory() {
  memory.clear()
}

export { PENDING_STATES, canStartNewBatch }
