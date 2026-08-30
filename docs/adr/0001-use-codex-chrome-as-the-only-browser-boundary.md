---
status: accepted
---

# Use Codex Chrome as the only browser boundary when Grok is selected

When the global Generation Provider is Grok, Web ImageGen supports only Codex in the ChatGPT desktop app with the connected Chrome extension and an authenticated Grok session. Browser interaction is owned by Codex's existing Chrome capability and is limited to the Grok tab the user explicitly supplies; the workflow does not search for or open a replacement tab. Authenticated image bytes may be materialized only from the verified current Post through Chrome's media or page-asset surfaces, then passed to the local validator; the integration never replays raw Grok HTTP requests or reads cookies or browser storage. An existing download may be reused only when its provider filename uniquely contains the exact frozen Post identity and its bytes pass the same hard validation, which preserves idempotency without recency guessing. The Grok Provider Integration uses one-shot local commands, with no MCP server, HTTP daemon, self-managed Chromium or profile, CDP connection, second browser backend, compatibility layer, or fallback to another provider, because the signed-in user tab is the required source of browser state and provider failures must remain visible.
