---
status: proposed
---

# Route browser providers through one Web ImageGen Skill

Keep Grok and the planned GPT Web integration behind one installed Web ImageGen Skill instead of creating one globally discoverable Skill per browser provider. The global switch exposes `default | grok | gpt`: `default` selects Codex's built-in ImageGen capability, while a separate non-sensitive managed state selects exactly one browser Provider Integration for `grok` or `gpt`; each job freezes that provider for its lifetime. This avoids duplicate image-generation triggers and preserves one provider-neutral workflow, at the cost of requiring safely ordered configuration updates and explicit mismatch detection between Codex Skill configuration and Web ImageGen provider state.
