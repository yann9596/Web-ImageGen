import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { join } from "node:path"

export function slug(text, max = 24) {
  const s = String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!s) return ""
  return s.slice(0, max).replace(/-+$/g, "")
}

export function isDummyTitle(title) {
  const t = String(title || "").trim()
  if (!t) return true
  return /^(new\s*session|untitled|新会话|未命名)\b/i.test(t)
}

export function pickSessionLabel({ sessionTitle, prompt, now = new Date() }) {
  const fromTitle = slug(sessionTitle)
  if (fromTitle && !isDummyTitle(sessionTitle)) return fromTitle
  const fromPrompt = slug(prompt)
  if (fromPrompt) return fromPrompt
  const hhmm = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`
  return `对话_${hhmm}`
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function dayStamp(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function uniqueDir(base) {
  if (!existsSync(base)) return base
  let n = 2
  while (existsSync(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

function walkSessionJson(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walkSessionJson(p, out)
    else if (name === "session.json") out.push(p)
  }
  return out
}

export function findSessionDir(workspace, sessionID) {
  if (!sessionID) return null
  const root = join(workspace, "imagine")
  for (const file of walkSessionJson(root)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"))
      if (data.sessionID === sessionID) return join(file, "..")
    } catch {}
  }
  return null
}

export function ensureSessionDir({ workspace, sessionID, sessionTitle, prompt, anchor }) {
  const existing = findSessionDir(workspace, sessionID)
  if (existing) return existing

  const now = new Date()
  const label = slug(anchor) || pickSessionLabel({ sessionTitle, prompt, now })
  const dir = uniqueDir(join(workspace, "imagine", `${dayStamp(now)}_${label}`))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "session.json"),
    JSON.stringify(
      {
        sessionID: sessionID || null,
        label,
        title: sessionTitle || null,
        firstPrompt: String(prompt || "").slice(0, 500),
        createdAt: now.toISOString(),
      },
      null,
      2,
    ),
  )
  return dir
}

export function nextJobVersion(sessionDir, goal) {
  if (!existsSync(sessionDir)) return 0
  const re = new RegExp(`^${escapeRegExp(goal)}(?:-V(\\d+))?(?:_|$)`)
  let max = 0
  for (const name of readdirSync(sessionDir)) {
    const m = String(name).match(re)
    if (!m) continue
    max = Math.max(max, m[1] ? Number(m[1]) : 1)
  }
  return max
}

export function jobDirName(goal, reqs, redraw, sessionDir) {
  const g = slug(goal) || "job"
  const extra = String(reqs || "")
    .split(/[_，,\s]+/)
    .map((x) => slug(x))
    .filter(Boolean)
  const tail = extra.length ? `_${extra.join("_")}` : ""
  let ver = 0
  if (redraw) ver = Math.max(2, nextJobVersion(sessionDir, g) + 1)
  let name = ver >= 2 ? `${g}-V${ver}${tail}` : `${g}${tail}`
  if (sessionDir && existsSync(join(sessionDir, name))) {
    ver = Math.max(2, nextJobVersion(sessionDir, g) + 1)
    name = `${g}-V${ver}${tail}`
  }
  return name
}

export function createJobDir(sessionDir, { goal, reqs, redraw, prompt } = {}) {
  const name = jobDirName(goal || prompt, reqs, redraw, sessionDir)
  const dir = uniqueDir(join(sessionDir, name))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function nextOut(path) {
  if (!existsSync(path)) return path
  const dot = path.lastIndexOf(".")
  const base = dot === -1 ? path : path.slice(0, dot)
  const ext = dot === -1 ? "" : path.slice(dot)
  let n = 2
  while (existsSync(`${base}-v${n}${ext}`)) n += 1
  return `${base}-v${n}${ext}`
}

export function extFor(type) {
  if (type && type.includes("png")) return ".png"
  if (type && type.includes("webp")) return ".webp"
  return ".jpg"
}
