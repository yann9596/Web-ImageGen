---
name: web-imagegen
description: Generate and select project raster images through the active Web ImageGen provider. The current Grok provider uses the user's explicitly supplied, signed-in Chrome tab. Use for ordinary image creation, reference-image generation, variants, and AI-led or user-led selection. Do not use for vector/code-native assets or while another global image skill is active.
---

# Web ImageGen

Web ImageGen is provider-neutral at the project boundary. This release implements only the `grok` provider. For that provider, use Codex's existing Chrome capability as the only image-generation tool. Never call built-in `image_gen`, a direct provider API or MCP, standalone Playwright, CDP, or another browser, and never fall back after failure.

## Preconditions

- Work only in the ChatGPT desktop app with the Chrome extension connected.
- Require the user to supply the target Grok tab explicitly through Chrome or a tab mention. Do not search for or open a replacement tab.
- Require that tab to be on Grok Imagine and already authenticated. If any precondition fails, stop with the missing setup step.
- Follow the installed Chrome control skill for all browser operations. Do not reproduce its connection internals here.

## Route the workflow

The active workflow is a user-controlled task setting, not something inferred from prompt wording.

1. Reuse the current task's `workflow=ai|user` value when present.
2. If it is unset, ask once whether Codex or the user will choose the result, then keep that choice for the task.
3. Read [references/runtime.md](references/runtime.md).
4. For `workflow=ai`, read only [references/ai-led.md](references/ai-led.md).
5. For `workflow=user`, read only [references/user-led.md](references/user-led.md).

Do not classify requests into generic generate/edit modes. Treat supplied local images as references for the Grok flow.

## Shared invariants

- In AI-led work, Codex authors the Grok prompt from the parent task and its existing context.
- In user-led work, submit the user's prompt unchanged unless the user explicitly requests rewriting.
- Use the local runtime for state transitions, image-byte validation, idempotency, recovery, and final file conversion. Browser page state is not persistent state.
- Accept a candidate only when it belongs to the current batch and the runtime verifies real, complete, decodable JPEG, PNG, or WebP bytes.
- A preview, thumbnail, browser-only media reference, element screenshot, or renamed file is not a successful original. Browser media becomes eligible only after Chrome materializes it to a local file and the runtime validates it.
- Materialize the verified current Post image through the Chrome media surface described in [references/runtime.md](references/runtime.md); never replay a provider HTTP request or expose its bytes in diagnostics.
- Preserve unchosen candidates and existing project assets. Do not overwrite without explicit user intent.
- Keep diagnostics free of cookies, storage, account details, full HTML, and full-page screenshots. Ask before capturing an extra page screenshot.
- Report the final saved path, the submitted prompt, the workflow, and that Grok Chrome was used.
