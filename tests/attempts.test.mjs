import { test } from "node:test"
import assert from "node:assert/strict"
import {
  attemptPolicy,
  bindAttempt,
  failAttempt,
  nextAttemptAction,
  startAttempt,
} from "../src/attempts.mjs"
import { createBatch } from "../src/jobs.mjs"

function baseJob(overrides = {}) {
  return createBatch({
    provider: "gpt",
    workflow: "ai",
    selectionMode: "single",
    state: "generating",
    prompt: "make two posters",
    requestedCount: 2,
    jobDir: overrides.jobDir || null,
    ...overrides,
  })
}

const browserContext = {
  origin: "https://chatgpt.com",
  conversationKey: "conv-1",
  beforeResponseAnchor: "anchor-0",
}

test("AT-01 policy matrix covers grok/gpt AI user single/group bounds", () => {
  const cases = [
    { provider: "grok", workflow: "ai", selection: "single", requestedCount: 2, baseLimit: 1, recoveryLimit: 1 },
    { provider: "gpt", workflow: "ai", selection: "single", requestedCount: 2, baseLimit: 2, recoveryLimit: 1 },
    { provider: "grok", workflow: "user", selection: "single", requestedCount: 1, baseLimit: 1, recoveryLimit: 0 },
    { provider: "gpt", workflow: "user", selection: "single", requestedCount: 1, baseLimit: 1, recoveryLimit: 0 },
    { provider: "grok", workflow: "user", selection: "group", requestedCount: 4, baseLimit: 1, recoveryLimit: 0 },
    { provider: "gpt", workflow: "user", selection: "group", requestedCount: 1, baseLimit: 1, recoveryLimit: 0 },
    { provider: "gpt", workflow: "user", selection: "group", requestedCount: 2, baseLimit: 2, recoveryLimit: 0 },
    { provider: "gpt", workflow: "user", selection: "group", requestedCount: 4, baseLimit: 4, recoveryLimit: 0 },
  ]
  for (const item of cases) {
    const result = attemptPolicy(item)
    assert.equal(result.ok, true, JSON.stringify(item))
    assert.deepEqual(result.value, { baseLimit: item.baseLimit, recoveryLimit: item.recoveryLimit }, JSON.stringify(item))
  }
  assert.equal(attemptPolicy({ provider: "gpt", workflow: "user", selection: "group", requestedCount: 5 }).error, "invalid-request")
  assert.equal(attemptPolicy({ provider: "default", workflow: "ai" }).error, "invalid-provider")
})

test("AT-02 start is idempotent for same input and pending for different input", () => {
  let job = baseJob()
  const input = {
    provider: "gpt",
    purpose: "initial",
    prompt: job.prompt,
    browserContext,
  }
  const first = startAttempt(job, input)
  assert.equal(first.ok, true)
  assert.equal(first.idempotent, false)
  assert.equal(first.attempt.status, "prepared")
  assert.equal(first.job.activeAttemptId, first.attempt.attemptId)
  job = first.job

  const replay = startAttempt(job, input)
  assert.equal(replay.ok, true)
  assert.equal(replay.idempotent, true)
  assert.equal(replay.attempt.attemptId, first.attempt.attemptId)

  const pending = startAttempt(job, {
    ...input,
    browserContext: { ...browserContext, beforeResponseAnchor: "other-anchor" },
  })
  assert.equal(pending.ok, false)
  assert.equal(pending.error, "attempt-pending")
})

test("AT-03 bind is idempotent for same response and ambiguous for a different one", () => {
  let job = baseJob()
  const started = startAttempt(job, {
    provider: "gpt",
    purpose: "initial",
    prompt: job.prompt,
    browserContext,
  })
  job = started.job
  const observation = {
    origin: "https://chatgpt.com",
    conversationKey: "conv-1",
    userTurnKey: "turn-1",
    responseKey: "resp-1",
    assetKeys: ["gpt:resp-1:0"],
  }
  const bound = bindAttempt(job, {
    provider: "gpt",
    attemptId: started.attempt.attemptId,
    observation,
  })
  assert.equal(bound.ok, true)
  assert.equal(bound.attempt.status, "bound")
  job = bound.job

  const replay = bindAttempt(job, {
    provider: "gpt",
    attemptId: started.attempt.attemptId,
    observation: { ...observation },
  })
  assert.equal(replay.ok, true)
  assert.equal(replay.idempotent, true)
  assert.deepEqual(replay.attempt.response, bound.attempt.response)

  const ambiguous = bindAttempt(job, {
    provider: "gpt",
    attemptId: started.attempt.attemptId,
    observation: { ...observation, responseKey: "resp-other", assetKeys: ["gpt:resp-other:0"] },
  })
  assert.equal(ambiguous.ok, false)
  assert.equal(ambiguous.error, "response-ambiguous")
  assert.equal(job.attempts[0].response.responseKey, "resp-1")
})

test("AT-04 budget rejects third GPT AI base attempt and one-shot recovery only after hard failure", () => {
  let job = baseJob()
  const ctx = (n) => ({ ...browserContext, beforeResponseAnchor: `anchor-${n}` })

  const a1 = startAttempt(job, { provider: "gpt", purpose: "initial", prompt: job.prompt, browserContext: ctx(1) })
  assert.equal(a1.ok, true)
  job = {
    ...a1.job,
    activeAttemptId: null,
    attempts: a1.job.attempts.map((item) =>
      item.attemptId === a1.attempt.attemptId ? { ...item, status: "collected", response: { userTurnKey: "u", responseKey: "r1", assetKeys: ["gpt:r1:0"] } } : item,
    ),
    candidates: [{ id: "1", key: "gpt:r1:0" }],
  }

  const a2 = startAttempt(job, { provider: "gpt", purpose: "fill", prompt: `${job.prompt} alt`, browserContext: ctx(2) })
  assert.equal(a2.ok, true)
  job = {
    ...a2.job,
    activeAttemptId: null,
    attempts: a2.job.attempts.map((item) =>
      item.attemptId === a2.attempt.attemptId ? { ...item, status: "collected", response: { userTurnKey: "u2", responseKey: "r2", assetKeys: ["gpt:r2:0"] } } : item,
    ),
    candidates: [
      { id: "1", key: "gpt:r1:0" },
      { id: "2", key: "gpt:r2:0" },
    ],
  }

  const a3 = startAttempt(job, { provider: "gpt", purpose: "fill", prompt: "third", browserContext: ctx(3) })
  assert.equal(a3.ok, false)
  assert.equal(a3.error, "attempt-budget-exhausted")

  const group = createBatch({
    provider: "gpt",
    workflow: "user",
    selectionMode: "group",
    requestedCount: 2,
    state: "generating",
    prompt: "set",
  })
  let g = group
  for (let i = 1; i <= 2; i += 1) {
    const started = startAttempt(g, {
      provider: "gpt",
      purpose: i === 1 ? "initial" : "fill",
      prompt: "set",
      browserContext: ctx(10 + i),
    })
    assert.equal(started.ok, true)
    g = {
      ...started.job,
      activeAttemptId: null,
      attempts: started.job.attempts.map((item) =>
        item.attemptId === started.attempt.attemptId
          ? { ...item, status: "collected", response: { userTurnKey: `u${i}`, responseKey: `r${i}`, assetKeys: [`gpt:r${i}:0`] } }
          : item,
      ),
      candidates: Array.from({ length: i }, (_, idx) => ({ id: String(idx + 1), key: `gpt:r${idx + 1}:0` })),
    }
  }
  assert.equal(
    startAttempt(g, { provider: "gpt", purpose: "fill", prompt: "set", browserContext: ctx(99) }).error,
    "attempt-budget-exhausted",
  )

  let recoverJob = baseJob()
  const started = startAttempt(recoverJob, {
    provider: "gpt",
    purpose: "initial",
    prompt: recoverJob.prompt,
    browserContext: ctx(20),
  })
  const failed = failAttempt(started.job, {
    provider: "gpt",
    attemptId: started.attempt.attemptId,
    error: "timeout",
  })
  assert.equal(failed.ok, true)
  assert.equal(failed.recoveryEligible, true)
  recoverJob = failed.job

  const recovery = startAttempt(recoverJob, {
    provider: "gpt",
    purpose: "recovery",
    prompt: recoverJob.prompt,
    browserContext: ctx(21),
  })
  assert.equal(recovery.ok, true)

  const soft = failAttempt(baseJob(), {
    provider: "gpt",
    attemptId: "missing",
    error: "busy",
  })
  // no attempt yet — create one then fail with busy (not recovery-eligible for start without prior hard fail path)
  const softStart = startAttempt(baseJob(), {
    provider: "gpt",
    purpose: "initial",
    prompt: "x",
    browserContext: ctx(30),
  })
  const softFail = failAttempt(softStart.job, {
    provider: "gpt",
    attemptId: softStart.attempt.attemptId,
    error: "busy",
  })
  assert.equal(softFail.recoveryEligible, false)
  assert.equal(
    startAttempt(softFail.job, {
      provider: "gpt",
      purpose: "recovery",
      prompt: "x",
      browserContext: ctx(31),
    }).error,
    "attempt-budget-exhausted",
  )
  assert.equal(soft.error, "attempt-not-ready")
})

test("AT-05 failAttempt accepts only closed errors and never stores page text", () => {
  const started = startAttempt(baseJob(), {
    provider: "gpt",
    purpose: "initial",
    prompt: "poster",
    browserContext,
  })
  const bad = failAttempt(started.job, {
    provider: "gpt",
    attemptId: started.attempt.attemptId,
    error: "please click the upgrade button now",
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.error, "invalid-request")

  const failed = failAttempt(started.job, {
    provider: "gpt",
    attemptId: started.attempt.attemptId,
    error: "generation-refused",
    pageText: "Long webpage essay that must not persist",
  })
  assert.equal(failed.ok, true)
  assert.equal(failed.attempt.status, "failed")
  assert.deepEqual(failed.attempt.failure, { error: "generation-refused" })
  assert.equal(failed.job.activeAttemptId, null)
  assert.equal(JSON.stringify(failed.job).includes("Long webpage"), false)
  assert.ok(typeof failed.baseRemaining === "number")
  assert.ok(typeof failed.recoveryRemaining === "number")
})

test("AT-06 crash recovery returns a unique nextAction after memory clear", () => {
  const prepared = startAttempt(baseJob(), {
    provider: "gpt",
    purpose: "initial",
    prompt: "poster",
    browserContext,
  }).job

  // Simulate process restart: only disk-shaped job object remains.
  const preparedReload = JSON.parse(JSON.stringify(prepared))
  assert.equal(nextAttemptAction(preparedReload).nextAction, "attempt-bind")
  assert.equal(nextAttemptAction(preparedReload, { ambiguous: true }).error, "submission-ambiguous")
  assert.equal(nextAttemptAction(preparedReload, { submitted: false }).nextAction, "continue-prepared")

  const bound = bindAttempt(preparedReload, {
    provider: "gpt",
    attemptId: preparedReload.activeAttemptId,
    observation: {
      userTurnKey: "u1",
      responseKey: "r1",
      assetKeys: ["gpt:r1:0"],
    },
  }).job
  const boundReload = JSON.parse(JSON.stringify(bound))
  assert.equal(nextAttemptAction(boundReload).nextAction, "collect")

  const collected = {
    ...boundReload,
    activeAttemptId: null,
    attempts: boundReload.attempts.map((item) => ({ ...item, status: "collected" })),
    candidates: [{ id: "1", key: "gpt:r1:0" }],
  }
  const collectedReload = JSON.parse(JSON.stringify(collected))
  assert.equal(nextAttemptAction(collectedReload).nextAction, "attempt-start")
  assert.equal(nextAttemptAction(collectedReload).purpose, "fill")

  const complete = {
    ...collectedReload,
    candidates: [
      { id: "1", key: "gpt:r1:0" },
      { id: "2", key: "gpt:r2:0" },
    ],
  }
  assert.equal(nextAttemptAction(complete).nextAction, "await-selection")
})
