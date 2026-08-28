import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"

export async function imageFile(dir, name, { color = "red", format = "png", width = 640, height = 512 } = {}) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  const buffer = await sharp({ create: { width, height, channels: 3, background: color } }).toFormat(format).toBuffer()
  writeFileSync(path, buffer)
  return path
}

export function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8")
  return path
}
