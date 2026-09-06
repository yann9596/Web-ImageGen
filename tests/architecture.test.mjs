import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")

function filesUnder(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else out.push(path)
  }
  return out
}

test("runtime has one local backend and no retired browser stack", () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  assert.equal(packageJson.name, "web-imagegen")
  assert.deepEqual(Object.keys(packageJson.dependencies), ["sharp"])
  for (const retired of ["browser.mjs", "daemon.mjs", "generate.mjs", "chatgpt.mjs"]) {
    assert.equal(filesUnder(join(ROOT, "src")).some((path) => path.endsWith(retired)), false)
  }
  const code = filesUnder(join(ROOT, "src")).concat(filesUnder(join(ROOT, "scripts"))).filter((path) => path.endsWith(".mjs")).map((path) => readFileSync(path, "utf8")).join("\n")
  assert.doesNotMatch(code, /from\s+["']playwright["']/i)
  assert.doesNotMatch(code, /chromium\.launch|connectOverCDP|createServer\s*\(/i)
  assert.doesNotMatch(code, /\bfetch\s*\(|https?\.request\s*\(/i)
})

test("select and runtime stay free of provider URL recognition", () => {
  const select = readFileSync(join(ROOT, "src", "select.mjs"), "utf8")
  assert.doesNotMatch(select, /grok\.com/)
  assert.doesNotMatch(select, /\/imagine\/post\//)
  assert.doesNotMatch(select, /chatgpt\.com/)
  const runtime = readFileSync(join(ROOT, "src", "runtime.mjs"), "utf8")
  assert.doesNotMatch(runtime, /grok\.com/)
  assert.doesNotMatch(runtime, /chatgpt\.com/)
  assert.doesNotMatch(runtime, /\/imagine\/post\//)
})

test("Web ImageGen Skill exposes the current Grok/Chrome provider", () => {
  const skillDir = join(ROOT, "skill", "web-imagegen")
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8")
  assert.match(skill, /^---\r?\nname: web-imagegen\r?\ndescription:/)
  assert.match(skill, /current Grok provider/)
  assert.match(skill, /Never call built-in `image_gen`/)
  assert.match(skill, /Browser media becomes eligible only after Chrome materializes it/)
  const runtime = readFileSync(join(skillDir, "references", "runtime.md"), "utf8")
  assert.match(runtime, /snapshotDownloads/)
  assert.match(runtime, /downloadMedia\(\)/)
  assert.match(runtime, /Never navigate to an asset URL, call `fetch`, replay Grok HTTP requests/)
  const aiLed = readFileSync(join(skillDir, "references", "ai-led.md"), "utf8")
  assert.match(aiLed, /select `×2`/)
  assert.match(aiLed, /Never leave AI-led generation in `自动模式`/)
  assert.equal(filesUnder(skillDir).some((path) => path.endsWith(join("scripts", "cli.mjs"))), true)
  assert.equal(filesUnder(skillDir).filter((path) => path.endsWith(".md")).length, 4)
})
