# User-led workflow

The user owns the prompt, page options, and final choice. Provider-specific page controls and identity rules live in the active provider document; follow those after this shared policy.

1. Submit the user's prompt unchanged unless they explicitly ask for rewriting.
2. Do not click quality, aspect, or other page option controls for the user.
3. Before initialization, require the user to choose `selection=single|group`. For a group, also obtain the desired count.
4. Initialize with the active `provider`, then follow the provider document for upload, submit, bind, and materialization.

## Single selection

- Freeze the current batch at `awaiting-user-selection` without writing a chosen file.
- Tell the user to open one current-batch image and reply `选好了`.
- After confirmation, verify the current asset belongs to the frozen batch, materialize its original media through the provider document's Chrome-bound flow, and call `choose --source post --by user --provider <active>`.
- Do not accept historic or other-conversation assets before a successful choice.

## Group selection

- Materialize originals for the stable current batch through the provider document's Chrome-bound flow and pass them to `collect` in page order with `provider`, `attemptId`, and `providerAssetKey`.
- Show every numbered candidate in Codex before asking for a decision. Do not write a chosen file yet.
- Accept numbered IDs, `全部`, `重画`, or `取消`.
- For fewer candidates than requested, show the actual set with `incomplete=true`; do not submit again automatically. With zero valid candidates, fail and ask whether the user wants to retry.
- Redraw creates a versioned batch and preserves the old candidates. Cancel produces no chosen file.
