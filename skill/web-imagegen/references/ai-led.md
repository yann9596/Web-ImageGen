# AI-led workflow

Codex owns the Grok prompt and final choice for the current parent task. Do not stop the parent workflow for a routine two-way choice.

1. Initialize with `workflow=ai`, `selection=single`, and `count=2`.
2. Before every submission, open Grok's image-count control and select `×2`; verify that `×2` is active. Never leave AI-led generation in `自动模式`, because one submission can create far more than the two candidates this workflow needs.
3. Use speed quality by default. Select quality only when the parent task explicitly requires it.
4. Apply a supported aspect ratio only when the parent task supplies or clearly requires one: `1:1`, `2:3`, `3:2`, `9:16`, or `16:9`.
5. Upload validated local reference files when present, then submit the Codex-authored prompt in the user-supplied Grok tab.
6. Identify only stable assets belonging to the current batch. Trigger original downloads through Grok and pass their local paths to `collect`.
7. Require exactly two valid candidates before choosing. Use `view_image` to inspect both, choose the stronger one for the parent task, and call `choose --by agent`.
8. Continue the parent task with the chosen workspace asset. Keep the other candidate available for later replacement.

If fewer than two valid candidates remain, submit the same prompt/specification once more and merge new valid downloads without duplicates. If the total is still below two, stop with `insufficient-candidates`.

`refine=1` authorizes at most one additional batch when both valid candidates are overall unusable for the parent task. Make one targeted prompt change, record the reason, and never spend a second refinement batch.
