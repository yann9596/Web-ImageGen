# Switch image generation providers globally

Web ImageGen uses an explicit global Generation Provider switch rather than prompt-routed or fallback backends. The current choices are official OpenAI ImageGen and the Web ImageGen Skill configured for Grok; a user-invoked switch enables exactly one path in Codex configuration and then requires a Codex restart. Future provider integrations may add explicit switch values, but they must preserve mutual exclusion, supplier-specific boundaries, and visible failures.
