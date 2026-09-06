# AI-led workflow

Codex owns the prompt and final choice for the current parent task. Do not stop the parent workflow for a routine two-way choice. Provider-specific page controls and identity rules live in the active provider document; follow those after this shared policy.

1. Initialize with `workflow=ai`, `selection=single`, and `count=2`, including the active `provider` in the request.
2. Follow the active provider document for page options, submission, attempt bind, and materialization.
3. Require exactly two valid candidates before choosing. Use `view_image` to inspect both, choose the stronger one for the parent task, and call `choose --by agent --provider <active>`.
4. Continue the parent task with the chosen workspace asset. Keep the other candidate available for later replacement.

When the runtime reports fewer than two valid candidates:

- For `grok`, follow the provider document's recovery/`retry` path.
- For `gpt`, follow `fillEligible` / `recoveryEligible` from the collect result. Do not treat GPT shortfalls as Grok `retry`.

If the total is still below two after the allowed base and recovery attempts, stop with `insufficient-candidates` or `attempt-budget-exhausted` as returned by the runtime.

`refine=1` authorizes at most one additional batch when both valid candidates are overall unusable for the parent task. Make one targeted prompt change, record the reason, and never spend a second refinement batch.
