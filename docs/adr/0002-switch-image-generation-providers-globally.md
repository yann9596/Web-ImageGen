# Switch image generation providers globally

OpenAI ImageGen and Grok ImageGen are mutually exclusive global Codex skills rather than prompt-routed backends inside one skill. A user-invoked switch enables one skill and disables the other in Codex configuration, then requires a Codex restart; this makes ordinary image requests use the selected provider without prompt conventions, prevents overlapping skill activation, and keeps the Grok skill free of an OpenAI fallback.
