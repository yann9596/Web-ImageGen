# User-led workflow

The user owns the prompt, Grok page options, and final choice.

1. Submit the user's prompt unchanged unless they explicitly ask for rewriting.
2. Do not click quality or aspect controls for the user.
3. Before initialization, require the user to choose `selection=single|group`. For a group, also obtain the desired count.
4. Upload validated local reference files when present and submit in the user-supplied Grok tab.

## Single selection

- Freeze the current batch at `awaiting-user-selection` without writing a chosen file.
- Tell the user to open one current-batch Grok image and reply `选好了`.
- After confirmation, verify the current Post/asset belongs to the batch, trigger its original download, and call `choose --source post --by user`.
- Do not refresh, navigate home, or accept an historic Post before a successful choice.

## Group selection

- Trigger original downloads for the stable current batch and pass them to `collect` in page order.
- Show every numbered candidate in Codex before asking for a decision. Do not write a chosen file yet.
- Accept numbered IDs, `全部`, `重画`, or `取消`.
- For fewer candidates than requested, show the actual set with `incomplete=true`; do not submit again automatically. With zero valid candidates, fail and ask whether the user wants to retry.
- Redraw creates a versioned batch and preserves the old candidates. Cancel produces no chosen file.
