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
  assert.deepEqual(Object.keys(packageJson.dependencies), ["sharp"])
  for (const retired of ["browser.mjs", "daemon.mjs", "generate.mjs", "chatgpt.mjs"]) {
    assert.equal(filesUnder(join(ROOT, "src")).some((path) => path.endsWith(retired)), false)
  }
  const code = filesUnder(join(ROOT, "src")).concat(filesUnder(join(ROOT, "scripts"))).filter((path) => path.endsWith(".mjs")).map((path) => readFileSync(path, "utf8")).join("\n")
  assert.doesNotMatch(code, /from\s+["']playwright["']/i)
  assert.doesNotMatch(code, /chromium\.launch|connectOverCDP|createServer\s*\(/i)
})

test("Skill is a thin Grok/Chrome orchestrator with the required resources", () => {
  const skillDir = join(ROOT, "skill", "grok-imagegen")
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8")
  assert.match(skill, /^---\r?\nname: grok-imagegen\r?\ndescription:/)
  assert.match(skill, /explicitly supplied, signed-in Grok Chrome tab/)
  assert.match(skill, /Never call built-in `image_gen`/)
  assert.equal(filesUnder(skillDir).some((path) => path.endsWith(join("scripts", "cli.mjs"))), true)
  assert.equal(filesUnder(skillDir).filter((path) => path.endsWith(".md")).length, 4)
})
