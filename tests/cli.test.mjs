import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { gptAssetKey } from "../src/providers/gpt-identity.mjs"
import { imageFile, writeJson } from "./helpers.mjs"

const CLI = fileURLToPath(new URL("../scripts/web-imagegen.mjs", import.meta.url))

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    windowsHide: true,
  })
  const stdout = String(result.stdout || "")
  const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0)
  return {
    status: result.status,
    stdout,
    lines,
    json: lines.length ? JSON.parse(lines[0]) : null,
  }
}

function requestPath(workspace, name) {
  return join(workspace, ".web-imagegen", name)
}

test("CLI-01 success and failure each emit exactly one JSON line", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-cli01-"))
  const request = writeJson(requestPath(workspace, "request.json"), {
    workspace,
    provider: "gpt",
    prompt: "cli",
    workflow: "ai",
    sessionID: "cli-01",
    goal: "cli",
  })
  const ok = runCli(["init", "--request", request])
  assert.equal(ok.status, 0)
  assert.equal(ok.lines.length, 1)
  assert.equal(ok.json.status, "generating")
  assert.equal(ok.json.provider, "gpt")
  assert.equal(existsSync(request), false)

  const fail = runCli(["attempt-start", "--job", ok.json.jobDir, "--provider", "grok", "--input", requestPath(workspace, "missing.json")])
  assert.equal(fail.status, 1)
  assert.equal(fail.lines.length, 1)
  assert.equal(fail.json.error, "provider-mismatch")
})

test("CLI-02 attempt-start/bind/fail consume success inputs and keep failures", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "web-imagegen-cli02-"))
  const initReq = writeJson(requestPath(workspace, "init.json"), {
    workspace,
    provider: "gpt",
    prompt: "attempt cli",
    workflow: "ai",
    sessionID: "cli-02",
    goal: "attempt",
  })
  const init = runCli(["init", "--request", initReq])
  assert.equal(init.status, 0)
  const jobDir = init.json.jobDir

  const outside = writeJson(join(workspace, "outside-start.json"), {
    batchKey: init.json.batchKey,
    purpose: "initial",
    prompt: "attempt cli",
    browserContext: {
      origin: "https://chatgpt.com",
      conversationKey: "conv",
      beforeResponseAnchor: "",
    },
  })
  const badPath = runCli(["attempt-start", "--job", jobDir, "--provider", "gpt", "--input", outside])
  assert.equal(badPath.status, 1)
  assert.equal(badPath.lines.length, 1)
  assert.equal(badPath.json.error, "invalid-request")
  assert.equal(existsSync(outside), true)

  const startInput = writeJson(requestPath(workspace, "start.json"), {
    batchKey: init.json.batchKey,
    purpose: "initial",
    prompt: "attempt cli",
    browserContext: {
      origin: "https://chatgpt.com",
      conversationKey: "conv",
      beforeResponseAnchor: "",
    },
  })
  const started = runCli(["attempt-start", "--job", jobDir, "--provider", "gpt", "--input", startInput])
  assert.equal(started.status, 0)
  assert.equal(started.lines.length, 1)
  assert.equal(started.json.attempt.status, "prepared")
  assert.equal(existsSync(startInput), false)

  const badBind = writeJson(requestPath(workspace, "bad-bind.json"), {
    batchKey: init.json.batchKey,
    attemptId: started.json.attempt.attemptId,
    observation: {
      origin: "https://grok.com",
      conversationKey: "conv",
      responseKey: "resp-1",
      assetKeys: [gptAssetKey("resp-1", 0)],
    },
  })
  const bindFail = runCli(["attempt-bind", "--job", jobDir, "--provider", "gpt", "--input", badBind])
  assert.equal(bindFail.status, 1)
  assert.equal(bindFail.lines.length, 1)
  assert.equal(bindFail.json.error, "wrong-provider-page")
  assert.equal(existsSync(badBind), true)

  const bindInput = writeJson(requestPath(workspace, "bind.json"), {
    batchKey: init.json.batchKey,
    attemptId: started.json.attempt.attemptId,
    observation: {
      origin: "https://chatgpt.com",
      conversationKey: "conv",
      responseKey: "resp-1",
      assetKeys: [gptAssetKey("resp-1", 0), gptAssetKey("resp-1", 1)],
    },
  })
  const bound = runCli(["attempt-bind", "--job", jobDir, "--provider", "gpt", "--input", bindInput])
  assert.equal(bound.status, 0)
  assert.equal(bound.lines.length, 1)
  assert.equal(bound.json.attempt.status, "bound")
  assert.equal(existsSync(bindInput), false)

  const a = await imageFile(join(workspace, "downloads"), "a.png", { color: "red" })
  const b = await imageFile(join(workspace, "downloads"), "b.png", { color: "blue" })
  const manifest = writeJson(requestPath(workspace, "collect.json"), {
    batchKey: init.json.batchKey,
    provider: "gpt",
    attemptId: started.json.attempt.attemptId,
    files: [
      { path: a, providerAssetKey: gptAssetKey("resp-1", 0) },
      { path: b, providerAssetKey: gptAssetKey("resp-1", 1) },
    ],
  })
  const collected = runCli(["collect", "--job", jobDir, "--manifest", manifest])
  assert.equal(collected.status, 0)
  assert.equal(collected.lines.length, 1)
  assert.equal(collected.json.status, "candidates-ready")

  const status = runCli(["status", "--job", jobDir, "--provider", "gpt"])
  assert.equal(status.status, 0)
  assert.equal(status.lines.length, 1)
  assert.equal(status.json.provider, "gpt")

  const debug = runCli(["debug", "--job", jobDir, "--provider", "gpt"])
  assert.equal(debug.status, 0)
  assert.equal(debug.lines.length, 1)
  assert.ok(Array.isArray(debug.json.debug.attempts))
  assert.equal("prompt" in (debug.json.debug.attempts[0] || {}), false)

  // Fresh job for attempt-fail
  const failInit = runCli([
    "init",
    "--request",
    writeJson(requestPath(workspace, "fail-init.json"), {
      workspace,
      provider: "gpt",
      prompt: "fail me",
      workflow: "ai",
      sessionID: "cli-02-fail",
      goal: "fail",
    }),
  ])
  const failStart = runCli([
    "attempt-start",
    "--job",
    failInit.json.jobDir,
    "--provider",
    "gpt",
    "--input",
    writeJson(requestPath(workspace, "fail-start.json"), {
      batchKey: failInit.json.batchKey,
      purpose: "initial",
      prompt: "fail me",
      browserContext: {
        origin: "https://chatgpt.com",
        conversationKey: "c2",
        beforeResponseAnchor: "",
      },
    }),
  ])
  const failed = runCli([
    "attempt-fail",
    "--job",
    failInit.json.jobDir,
    "--provider",
    "gpt",
    "--attempt",
    failStart.json.attempt.attemptId,
    "--error",
    "timeout",
  ])
  assert.equal(failed.status, 0)
  assert.equal(failed.lines.length, 1)
  assert.equal(failed.json.attempt.status, "failed")
  assert.equal(failed.json.recoveryEligible, true)

  const badError = runCli([
    "attempt-fail",
    "--job",
    failInit.json.jobDir,
    "--provider",
    "gpt",
    "--attempt",
    failStart.json.attempt.attemptId,
    "--error",
    "page said nope",
  ])
  // Idempotent fail already recorded, or invalid-request if treated as new — closed set only.
  assert.equal(badError.lines.length, 1)
  assert.ok(badError.json.error === "invalid-request" || badError.json.attempt?.status === "failed")
})
