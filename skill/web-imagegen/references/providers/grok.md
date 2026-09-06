# Grok provider

Use only when `provider.mjs status` returned `provider: "grok"`. Do not read GPT provider instructions in the same turn.

## Preconditions

- Work only in the ChatGPT desktop app with the Chrome extension connected.
- Require the user to supply the target Grok tab explicitly through Chrome or a tab mention. Do not search for or open a replacement tab.
- Require that tab to be on Grok Imagine and already authenticated. If any precondition fails, stop with the missing setup step.
- Follow the installed Chrome control skill for all browser operations. Do not reproduce its connection internals here.

## Page and Post identity

- Prove the current Grok Post belongs to the active batch before materializing media.
- Extract the response ID from the verified Post URL. That frozen ID is the only download identity key.
- Do not refresh, navigate home, or accept a historic Post before a successful choice.
- Use `expire` when the supplied Chrome tab closes or the current page can no longer be proven to belong to the frozen batch.

## AI-led page options

1. Initialize with `workflow=ai`, `selection=single`, `count=2`, and `--provider grok` on every mutating command.
2. Before every submission, open Grok's image-count control and select `×2`; verify that `×2` is active. Never leave AI-led generation in `自动模式`, because one submission can create far more than the two candidates this workflow needs.
3. Use speed quality by default. Select quality only when the parent task explicitly requires it.
4. Apply a supported aspect ratio only when the parent task supplies or clearly requires one: `1:1`, `2:3`, `3:2`, `9:16`, or `16:9`.
5. Upload validated local reference files when present, then submit the Codex-authored prompt in the user-supplied Grok tab.
6. Record the submission with `attempt-start` / `attempt-bind` using Grok Post identity, then materialize originals and `collect` with `provider`, `attemptId`, and each file's `providerAssetKey`.
7. Require exactly two valid candidates before choosing. If fewer than two remain, Grok recovery may return `status: "retry"` once for the same prompt; if still short, stop with `insufficient-candidates`.

## User-led page options

- Submit the user's prompt unchanged unless they explicitly ask for rewriting.
- Do not click quality or aspect controls for the user.
- Upload validated local reference files when present and submit in the user-supplied Grok tab.
- Single selection: freeze identities at `awaiting-user-selection`, ask the user to open one current-batch Grok image and reply `选好了`, then materialize and `choose --source post --by user --provider grok`.
- Group selection: materialize current-batch originals in page order, show numbered candidates, and accept numbered IDs, `全部`, `重画`, or `取消`.

## Materialize originals

Import `snapshotDownloads` and `resolveProviderDownload` from `<skill-directory>/scripts/downloads.mjs`. Call `snapshotDownloads(downloadDirectory, { responseId })` immediately before each download action; the required frozen response ID keeps unrelated download filenames out of the snapshot. Use the first successful Chrome-bound path:

1. For an observed file asset, use the claimed tab's page-asset capability to bundle the exact asset whose identity matches the verified Post.
2. Otherwise call Chrome's `downloadMedia()` on the main Post image once. Snapshot again and resolve the one new or changed file whose provider filename contains the exact frozen response ID.
3. If `downloadMedia()` completes without a resolvable file, take a fresh snapshot, trigger the page's Download button once, snapshot again, and resolve by the same exact identity rule.

If both actions produce no file delta, call the resolver once with `allowExisting=true`. Reuse is allowed only when exactly one existing provider filename contains the exact frozen response ID and that file passes local validation. Zero matches stop with `download-missing`; multiple exact matches stop with `download-ambiguous`. Never scan by recency or guess among unrelated downloads. Never navigate to an asset URL, issue HTTP requests, replay Grok media URLs, inspect cookies or storage, or treat the browser reference itself as a file.

## Reporting

Report the final saved path, the submitted prompt, the workflow, and that Grok Chrome was used.
