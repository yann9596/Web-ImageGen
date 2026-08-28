# AI-led workflow

Codex owns the Grok prompt and final choice for the current parent task. Do not stop the parent workflow for a routine two-way choice.

1. Initialize with `workflow=ai`, `selection=single`, and `count=2`.
2. Use speed quality by default. Select quality only when the parent task explicitly requires it.
3. Apply a supported aspect ratio only when the parent task supplies or clearly requires one: `1:1`, `2:3`, `3:2`, `9:16`, or `16:9`.
4. Upload validated local reference files when present, then submit the Codex-authored prompt in the user-supplied Grok tab.
5. Identify only stable assets belonging to the current batch. Trigger original downloads through Grok and pass their local paths to `collect`.
6. Require exactly two valid candidates before choosing. Use `view_image` to inspect both, choose the stronger one for the parent task, and call `choose --by agent`.
7. Continue the parent task with the chosen workspace asset. Keep the other candidate available for later replacement.

If fewer than two valid candidates remain, submit the same prompt/specification once more and merge new valid downloads without duplicates. If the total is still below two, stop with `insufficient-candidates`.

`refine=1` authorizes at most one additional batch when both valid candidates are overall unusable for the parent task. Make one targeted prompt change, record the reason, and never spend a second refinement batch.
