# Local runtime

Use the one-shot runtime through:

```text
node <skill-directory>/scripts/cli.mjs <command> ...
```

Every command prints one JSON object. Treat a non-zero exit code or an `error` field as failure; do not compensate with browser-only state.

Mutating commands require `--provider` matching the job's frozen provider. Provider-specific page and identity steps live in the active provider document under `references/providers/`.

## Commands

### Initialize a batch

Write a UTF-8 request JSON file inside the target workspace, then run:

```text
node <skill-directory>/scripts/cli.mjs init --request <absolute-request-json>
```

The request contains `workspace`, `provider`, `prompt`, `workflow`, and optional `selection`, `count`, `aspect`, `quality`, `refFiles`, `refine`, `goal`, and `reqs`. Use the returned `jobDir` and `batchKey` for every later step. The runtime consumes no browser credentials.

### Inspect recoverable state

```text
node <skill-directory>/scripts/cli.mjs status --workspace <absolute-workspace> [--session <id>] [--provider <grok|gpt>]
```

### Record a provider attempt

Before clicking submit in the browser, write an attempt-start JSON under `<workspace>/.web-imagegen/` and run:

```text
node <skill-directory>/scripts/cli.mjs attempt-start --job <absolute-job-dir> --input <absolute-attempt-start-json> --provider <grok|gpt>
```

After the page shows a uniquely identifiable new response, bind it:

```text
node <skill-directory>/scripts/cli.mjs attempt-bind --job <absolute-job-dir> --input <absolute-attempt-bind-json> --provider <grok|gpt>
```

On a closed attempt failure from the allowed error set:

```text
node <skill-directory>/scripts/cli.mjs attempt-fail --job <absolute-job-dir> --attempt <attempt-id> --error <closed-set-code> --provider <grok|gpt>
```

These commands only update local job state. They do not claim the browser click succeeded until bind proves the new response.

### Materialize original browser media

Follow the active provider document for Chrome materialization. Shared rules:

- Never emit or transfer a full data URI, or save it in job JSON, request JSON, manifests, or diagnostics.
- Import download helpers from `<skill-directory>/scripts/downloads.mjs` when the provider document requires download-directory snapshots.
- Never navigate to an asset URL, issue HTTP requests, replay provider media URLs, inspect cookies or storage, or treat the browser reference itself as a file.
- The local runtime remains the final authority for complete decoding, dimensions, format, and batch identity.

### Freeze materialized candidates

After Chrome has materialized original media for a bound attempt, write a manifest JSON containing the current `batchKey`, `provider`, `attemptId`, and absolute local file paths. Each `files` item must include a stable `providerAssetKey` observed for the current bound response:

```text
node <skill-directory>/scripts/cli.mjs collect --job <absolute-job-dir> --manifest <absolute-manifest-json>
```

Do not put DOM screenshots, data URIs, cookies, or browser storage in this manifest.

For user-led single selection, do not download all candidates. Instead, pass `candidates` containing the stable current-batch asset identities. The runtime freezes those identities at `awaiting-user-selection`.

GPT AI shortfalls stay in `generating` with `fillEligible` / `recoveryEligible` when budget remains. Grok AI shortfalls may return `retry` per the Grok provider document. Do not mix those signals across providers.

### Choose, redraw, or cancel

```text
node <skill-directory>/scripts/cli.mjs choose --job <absolute-job-dir> --source candidates --ids 1 --by agent --provider <grok|gpt>
node <skill-directory>/scripts/cli.mjs choose --job <absolute-job-dir> --source candidates --ids 1,2 --by user --provider <grok|gpt>
node <skill-directory>/scripts/cli.mjs choose --job <absolute-job-dir> --source post --file <absolute-downloaded-file> --key <verified-current-batch-identity> --by user --provider <grok|gpt>
node <skill-directory>/scripts/cli.mjs redraw --job <absolute-job-dir> --provider <grok|gpt> [--prompt <explicit-new-prompt>]
node <skill-directory>/scripts/cli.mjs cancel --job <absolute-job-dir> --provider <grok|gpt>
node <skill-directory>/scripts/cli.mjs expire --job <absolute-job-dir> --reason <short-reason> --provider <grok|gpt>
```

Use `expire` when the supplied Chrome tab closes or the current page can no longer be proven to belong to the frozen batch. Do not use it for a routine download retry.

For the one permitted AI aesthetic refinement, call `redraw` with `--refine`, `--reason`, and a targeted `--prompt` change. In user-led work, omit `--prompt` unless the user explicitly requested a rewrite. Redraw inherits the job provider; it never switches providers.

Use `--out` only when the user named an explicit `.jpg`, `.jpeg`, `.png`, or `.webp` destination.

### Debug

```text
node <skill-directory>/scripts/cli.mjs debug --job <absolute-job-dir> --provider <grok|gpt>
```

The result is deliberately redacted. Do not supplement it with browser secrets.

## Temporary request files

Place request and manifest JSON under `<workspace>/.web-imagegen/`. They may contain prompts and local file paths, but never browser credentials or page storage. The runtime removes a successfully consumed request file and leaves failed input in place for diagnosis.
