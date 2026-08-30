# Local runtime

Use the one-shot runtime through:

```text
node <skill-directory>/scripts/cli.mjs <command> ...
```

Every command prints one JSON object. Treat a non-zero exit code or an `error` field as failure; do not compensate with browser-only state.

## Commands

### Initialize a batch

Write a UTF-8 request JSON file inside the target workspace, then run:

```text
node <skill-directory>/scripts/cli.mjs init --request <absolute-request-json>
```

The request contains `workspace`, `prompt`, `workflow`, and optional `selection`, `count`, `aspect`, `quality`, `refFiles`, `refine`, `goal`, and `reqs`. Use the returned `jobDir` and `batchKey` for every later step. The runtime consumes no browser credentials.

### Inspect recoverable state

```text
node <skill-directory>/scripts/cli.mjs status --workspace <absolute-workspace> [--session <id>]
```

### Materialize original browser media

First prove the current Grok Post identity belongs to the active batch and extract its response ID from the verified Post URL. Locate the unambiguous main Post image through the claimed Chrome tab. Never emit or transfer a full data URI, or save it in job JSON, request JSON, manifests, or diagnostics.

Import `snapshotDownloads` and `resolveProviderDownload` from `<skill-directory>/scripts/downloads.mjs`. Call `snapshotDownloads(downloadDirectory, { responseId })` immediately before each download action; the required frozen response ID keeps unrelated download filenames out of the snapshot. Use the first successful Chrome-bound path:

1. For an observed file asset, use the claimed tab's page-asset capability to bundle the exact asset whose identity matches the verified Post.
2. Otherwise call Chrome's `downloadMedia()` on the main Post image once. Snapshot again and resolve the one new or changed file whose provider filename contains the exact frozen response ID.
3. If `downloadMedia()` completes without a resolvable file, take a fresh snapshot, trigger the page's Download button once, snapshot again, and resolve by the same exact identity rule.

If both actions produce no file delta, call the resolver once with `allowExisting=true`. Reuse is allowed only when exactly one existing provider filename contains the exact frozen response ID and that file passes the local runtime's complete validation. Zero matches stop with `download-missing`; multiple exact matches stop with `download-ambiguous`. Never scan by recency or guess among unrelated downloads. Never navigate to an asset URL, call `fetch`, replay Grok HTTP requests, inspect cookies or storage, or treat the browser reference itself as a file. The local runtime remains the final authority for complete decoding, dimensions, format, and batch identity.

### Freeze materialized candidates

After Chrome has materialized original media, write a manifest JSON containing the current `batchKey` and absolute local file paths. Each `files` item may be a path string or an object with `path` plus a stable `key`/`src` observed for the current batch:

```text
node <skill-directory>/scripts/cli.mjs collect --job <absolute-job-dir> --manifest <absolute-manifest-json>
```

Do not put DOM screenshots, data URIs, cookies, or browser storage in this manifest.

For user-led single selection, do not download all candidates. Instead, pass `candidates` containing the stable current-batch asset identities. The runtime freezes those identities at `awaiting-user-selection`.

### Choose, redraw, or cancel

```text
node <skill-directory>/scripts/cli.mjs choose --job <absolute-job-dir> --source candidates --ids 1 --by agent
node <skill-directory>/scripts/cli.mjs choose --job <absolute-job-dir> --source candidates --ids 1,2 --by user
node <skill-directory>/scripts/cli.mjs choose --job <absolute-job-dir> --source post --file <absolute-downloaded-file> --key <verified-current-batch-identity> --by user
node <skill-directory>/scripts/cli.mjs redraw --job <absolute-job-dir> [--prompt <explicit-new-prompt>]
node <skill-directory>/scripts/cli.mjs cancel --job <absolute-job-dir>
node <skill-directory>/scripts/cli.mjs expire --job <absolute-job-dir> --reason <short-reason>
```

Use `expire` when the supplied Chrome tab closes or the current page can no longer be proven to belong to the frozen batch. Do not use it for a routine download retry.

For the one permitted AI aesthetic refinement, call `redraw` with `--refine`, `--reason`, and a targeted `--prompt` change. In user-led work, omit `--prompt` unless the user explicitly requested a rewrite.

Use `--out` only when the user named an explicit `.jpg`, `.jpeg`, `.png`, or `.webp` destination.

### Debug

```text
node <skill-directory>/scripts/cli.mjs debug --job <absolute-job-dir>
```

The result is deliberately redacted. Do not supplement it with browser secrets.

## Temporary request files

Place request and manifest JSON under `<workspace>/.web-imagegen/`. They may contain prompts and local file paths, but never browser credentials or page storage. The runtime removes a successfully consumed request file and leaves failed input in place for diagnosis.
