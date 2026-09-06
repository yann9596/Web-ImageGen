import { main } from "../../../scripts/skill-provider.mjs"

try {
  const result = await main(process.argv.slice(2))
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: error.code || "provider-switch-failed", detail: error.message })}\n`,
  )
  process.exitCode = 1
}
