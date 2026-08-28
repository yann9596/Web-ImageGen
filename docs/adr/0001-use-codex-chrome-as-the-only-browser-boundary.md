---
status: accepted
---

# Use Codex Chrome as the only browser boundary when Grok is selected

When the global Generation Provider is Grok, the project supports only Codex in the ChatGPT desktop app with the connected Chrome extension and an authenticated Grok session. Browser interaction is owned by Codex's existing Chrome capability and is limited to the Grok tab the user explicitly supplies; the workflow does not search for or open a replacement tab. The Grok skill uses one-shot local commands, with no MCP server, HTTP daemon, self-managed Chromium or profile, CDP connection, second browser backend, compatibility layer, or fallback to OpenAI ImageGen, because the signed-in user tab is the required source of browser state and provider failures must remain visible.
