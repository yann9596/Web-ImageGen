import { extname } from "node:path"

export const WORKFLOWS = Object.freeze(["ai", "user"])
export const SELECTIONS = Object.freeze(["single", "group"])
export const SOURCES = Object.freeze(["candidates", "post"])
export const CHOSEN_BY = Object.freeze(["agent", "user"])
export const ASPECTS = Object.freeze(["auto", "1:1", "16:9", "9:16", "2:3", "3:2"])
export const QUALITIES = Object.freeze(["auto", "standard", "high"])
export const OUT_EXTS = Object.freeze([".jpg", ".jpeg", ".png", ".webp"])

export const DEFAULTS = Object.freeze({
  quality: "standard",
  aspect: "auto",
  groupN: 8,
  chosenFile: "chosen.jpg",
  chosenMime: "image/jpeg",
})

export const JOB_STATES = Object.freeze([
  "preparing",
  "generating",
  "awaiting-user-selection",
  "candidates-ready",
  "chosen",
  "cancelled",
  "redraw",
  "selection-expired",
  "replaced-by-new-batch",
])

export const PENDING_STATES = Object.freeze(["preparing", "generating", "awaiting-user-selection", "candidates-ready"])

export const ERRORS = Object.freeze([
  "login-wall",
  "timeout",
  "quota",
  "blocked",
  "ui-changed",
  "busy",
  "batch-pending",
  "batch-not-ready",
  "no-job",
  "ref-missing",
  "prompt-required",
  "workspace-required",
  "workflow-required",
  "unknown-id",
  "invalid-request",
  "invalid-out-format",
  "invalid-aspect",
  "invalid-quality",
  "ids-required",
  "selection-required",
  "insufficient-candidates",
  "selection-not-ready",
  "selection-stale",
  "selection-expired",
  "empty",
  "truncated",
  "undecodable",
  "invalid-size",
  "ext-mismatch",
  "preview-size",
  "download-missing",
  "download-ambiguous",
  "runtime-failed",
])

const QUALITY_HIGH_RE = /质量档|质量模式|高质量模式|(改用|切换|使用|用)质量|quality\s*mode/i

export function parseQuality(prompt) {
  return QUALITY_HIGH_RE.test(String(prompt || "")) ? "high" : "standard"
}

export function parseAspect(prompt) {
  const text = String(prompt || "")
  if (/9\s*[:：]\s*16|竖屏|竖版|9x16/i.test(text)) return "9:16"
  if (/16\s*[:：]\s*9|宽屏|横版|16x9|widescreen/i.test(text)) return "16:9"
  if (/1\s*[:：]\s*1|正方形|方图|square/i.test(text)) return "1:1"
  if (/3\s*[:：]\s*2|3x2/i.test(text)) return "3:2"
  if (/2\s*[:：]\s*3|2x3/i.test(text)) return "2:3"
  return "auto"
}

export function qualityClickTarget(quality) {
  if (quality === "high") return "质量"
  if (quality === "standard") return "速度"
  return null
}

export function aspectClickTarget(aspect) {
  if (!aspect || aspect === "auto") return null
  return ASPECTS.includes(aspect) ? aspect : null
}

export function outFormat(outPath) {
  const ext = extname(String(outPath || "chosen.jpg")).toLowerCase()
  if (ext === ".jpg" || ext === ".jpeg") return { ext, mime: "image/jpeg" }
  if (ext === ".png") return { ext, mime: "image/png" }
  if (ext === ".webp") return { ext, mime: "image/webp" }
  return { error: "invalid-out-format" }
}

export function normalizeIds(ids) {
  const raw = String(ids ?? "").trim()
  if (!raw) return []
  if (/^(all|全部)$/i.test(raw)) return ["all"]
  return raw.split(/[,，\s]+/).filter(Boolean)
}

export function chooseIdempotencyKey({ batchKey, source, ids } = {}) {
  const src = source || "candidates"
  const list = normalizeIds(ids)
  const idPart = list[0] === "all" ? "all" : list.slice().sort().join(",")
  return `${batchKey || ""}::${src}::${idPart}`
}

function failure(error) {
  return { ok: false, error }
}

export function validateInit(input = {}) {
  const workspace = String(input.workspace || "").trim()
  const prompt = String(input.prompt || "").trim()
  const workflow = String(input.workflow || "").trim()
  if (!workspace) return failure("workspace-required")
  if (!prompt) return failure("prompt-required")
  if (!WORKFLOWS.includes(workflow)) return failure("workflow-required")

  let selection = input.selection || null
  let requestedCount
  let quality
  let aspect
  if (workflow === "ai") {
    selection = "single"
    requestedCount = 2
    quality = input.quality || parseQuality(prompt)
    aspect = input.aspect || parseAspect(prompt)
  } else {
    if (!SELECTIONS.includes(selection)) return failure("selection-required")
    requestedCount = selection === "group" ? Number(input.count ?? input.groupN ?? DEFAULTS.groupN) : 1
    quality = "auto"
    aspect = "auto"
  }
  if (!QUALITIES.includes(quality)) return failure("invalid-quality")
  if (!ASPECTS.includes(aspect)) return failure("invalid-aspect")
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 8) return failure("invalid-request")

  const refine = input.refine === 1 || input.refine === true || input.refine === "1" ? 1 : 0
  const refFiles = Array.isArray(input.refFiles) ? input.refFiles.map(String) : input.ref ? [String(input.ref)] : []
  return {
    ok: true,
    value: {
      workspace,
      prompt,
      originalPrompt: input.originalPrompt ? String(input.originalPrompt) : null,
      workflow,
      selection,
      requestedCount,
      quality,
      aspect,
      refine,
      refFiles,
      clickQuality: workflow === "ai" ? qualityClickTarget(quality) : null,
      clickAspect: workflow === "ai" ? aspectClickTarget(aspect) : null,
    },
  }
}

export function validateChoose(input = {}) {
  if (!input.batchKey && !input.jobDir) return failure("no-job")
  const source = input.source || "candidates"
  const chosenBy = input.chosenBy || input.by || (source === "post" ? "user" : null)
  if (!SOURCES.includes(source) || !CHOSEN_BY.includes(chosenBy)) return failure("invalid-request")
  if (source === "post" && chosenBy !== "user") return failure("invalid-request")
  const ids = normalizeIds(input.ids)
  if (source === "candidates" && ids.length === 0) return failure("ids-required")
  if (input.out && outFormat(input.out).error) return failure("invalid-out-format")
  return {
    ok: true,
    value: {
      source,
      chosenBy,
      ids,
      idempotencyKey: chooseIdempotencyKey({ batchKey: input.batchKey, source, ids: input.ids }),
    },
  }
}

export function canStartNewBatch(state, { redraw, replaceBatch, resume } = {}) {
  if (!state || !PENDING_STATES.includes(state)) return { ok: true }
  if (redraw === true || replaceBatch === true) return { ok: true }
  if (resume === true && state === "generating") return { ok: true }
  return { ok: false, error: "batch-pending" }
}
