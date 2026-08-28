import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import sharp from "sharp"
import { inspectImage, extMatchesType } from "./candidates.mjs"
import { outFormat } from "./contract.mjs"

export async function transcodeBuffer(buf, destExt) {
  const info = inspectImage(buf)
  if (!info.ok) throw new Error(info.error)
  try {
    await sharp(buf, { failOn: "error" }).raw().toBuffer()
  } catch {
    throw new Error("undecodable")
  }
  const ext = String(destExt || "").toLowerCase()
  if ((ext === ".jpg" || ext === ".jpeg") && info.type === "image/jpeg") return buf
  if (ext === ".png" && info.type === "image/png") return buf
  if (ext === ".webp" && info.type === "image/webp") return buf
  if (ext === ".jpg" || ext === ".jpeg") return sharp(buf).rotate().jpeg({ quality: 95 }).toBuffer()
  if (ext === ".png") return sharp(buf).rotate().png().toBuffer()
  if (ext === ".webp") return sharp(buf).rotate().webp({ quality: 95 }).toBuffer()
  throw new Error("invalid-out-format")
}

export async function writeChosenFile(src, destPath, { artifact = "file" } = {}) {
  const fmt = outFormat(destPath)
  if (fmt.error) throw new Error(fmt.error)
  const buf = Buffer.isBuffer(src) ? src : readFileSync(src)
  const input = inspectImage(buf)
  if (!input.ok) throw new Error(input.error)
  const out = await transcodeBuffer(buf, fmt.ext)
  const written = inspectImage(out)
  if (!written.ok) throw new Error("undecodable")
  if (!extMatchesType(destPath, written.type)) throw new Error("ext-mismatch")
  mkdirSync(dirname(destPath), { recursive: true })
  writeFileSync(destPath, out)
  return {
    path: destPath,
    artifact,
    type: written.type,
    width: written.width,
    height: written.height,
    sourceType: input.type,
  }
}

export async function assertSourceFile(path, { minLongEdge = 0 } = {}) {
  if (!existsSync(path)) throw new Error("no-job")
  const buf = readFileSync(path)
  const info = inspectImage(buf)
  if (!info.ok) throw new Error(info.error)
  if (!extMatchesType(path, info.type)) throw new Error("ext-mismatch")
  let decoded
  try {
    decoded = await sharp(buf, { failOn: "error" }).raw().toBuffer({ resolveWithObject: true })
  } catch {
    throw new Error("undecodable")
  }
  const width = decoded.info.width || info.width
  const height = decoded.info.height || info.height
  if (minLongEdge && Math.max(width, height) < minLongEdge) throw new Error("preview-size")
  return { path, ...info, width, height }
}
