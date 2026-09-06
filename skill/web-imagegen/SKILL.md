---
name: web-imagegen
description: Generate and select project raster images through the active Web ImageGen provider. Uses the user's explicitly supplied, signed-in Chrome tab for the active grok or gpt integration. Use for ordinary image creation, reference-image generation, variants, and AI-led or user-led selection. Do not use for vector/code-native assets or while the official ImageGen skill owns the request (provider=default).
---

# Web ImageGen

Web ImageGen is provider-neutral at the project boundary. Exactly one Generation Provider is active at a time. Use Codex's existing Chrome capability as the only browser tool. Never call built-in `image_gen`, a direct provider API or MCP, a standalone browser-automation stack, raw browser-debug protocol clients, or another browser, and never fall back to another provider after failure.

## Resolve the active provider

1. Run `node <skill-directory>/scripts/provider.mjs status` and read the single JSON object.
2. If the result has `error: "provider-config-mismatch"`, report the configuration problem and stop. Do not open a browser and do not read any provider document.
3. If `provider` is `default`, stop Web ImageGen immediately so the official ImageGen skill can handle the request. Do not continue any Web ImageGen workflow.
4. If `provider` is `grok`, read only [references/providers/grok.md](references/providers/grok.md).
5. If `provider` is `gpt`, read only [references/providers/gpt.md](references/providers/gpt.md).
6. Otherwise stop with the unexpected provider status.

Never load both provider documents in one turn. Official ImageGen and Web ImageGen must not both respond to the same request.

## Route the workflow

The active workflow is a user-controlled task setting, not something inferred from prompt wording.

1. Reuse the current task's `workflow=ai|user` value when present.
2. If it is unset, ask once whether Codex or the user will choose the result, then keep that choice for the task.
3. Read [references/runtime.md](references/runtime.md).
4. For `workflow=ai`, read only [references/ai-led.md](references/ai-led.md).
5. For `workflow=user`, read only [references/user-led.md](references/user-led.md).

Do not classify requests into generic generate/edit modes. Treat supplied local images as references for the active provider flow.

## Shared invariants

- Pass `--provider` matching the active job on every mutating runtime command. A mismatch returns `provider-mismatch`; never continue under another provider.
- In AI-led work, Codex authors the provider prompt from the parent task and its existing context.
- In user-led work, submit the user's prompt unchanged unless the user explicitly requests rewriting.
- Use the local runtime for state transitions, image-byte validation, idempotency, recovery, and final file conversion. Browser page state is not persistent state.
- Accept a candidate only when it belongs to the current batch and the runtime verifies real, complete, decodable JPEG, PNG, or WebP bytes.
- A preview, thumbnail, browser-only media reference, element screenshot, or renamed file is not a successful original. Browser media becomes eligible only after Chrome materializes it to a local file and the runtime validates it.
- Preserve unchosen candidates and existing project assets. Do not overwrite without explicit user intent.
- Keep diagnostics free of cookies, storage, account details, full HTML, and full-page screenshots. Ask before capturing an extra page screenshot.
- Report the final saved path, the submitted prompt, the workflow, and which web provider Chrome session was used.
