import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  RuntimeError,
  cancelJob,
  chooseJob,
  collectJob,
  debugJob,
  expireJob,
  initFromRequest,
  redrawJob,
  statusJob,
} from "../src/runtime.mjs"
import { ERRORS } from "../src/contract.mjs"

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (!arg.startsWith("--")) throw new RuntimeError("invalid-request", `unexpected argument: ${arg}`)
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (key === "refine") {
      options.refine = true
      continue
    }
    const value = rest[++i]
    if (value == null) throw new RuntimeError("invalid-request", `${arg} requires a value`)
    options[key] = value
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.command === "init") return initFromRequest(options.request)
  if (options.command === "collect") return collectJob(options.job, options.manifest)
  if (options.command === "choose") return chooseJob(options.job, options)
  if (options.command === "redraw") return redrawJob(options.job, options)
  if (options.command === "cancel") return cancelJob(options.job)
  if (options.command === "expire") return expireJob(options.job, options)
  if (options.command === "status") return statusJob({ jobDir: options.job, workspace: options.workspace, sessionID: options.session })
  if (options.command === "debug") return debugJob(options.job)
  throw new RuntimeError("invalid-request", "command must be init, status, collect, choose, redraw, cancel, expire, or debug")
}

export async function runCli(argv = process.argv.slice(2)) {
  try {
    const result = await main(argv)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error) {
    const code = error.code || (ERRORS.includes(error.message) ? error.message : "runtime-failed")
    process.stdout.write(`${JSON.stringify({ error: code, detail: error.message })}\n`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli()
}
