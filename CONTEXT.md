# Web Image Generation

This context covers provider-neutral generation, evaluation, and selection of project images for Codex.

## Language

**Web ImageGen**:
The provider-neutral Codex image-generation capability delivered by this project. Its identity remains stable as provider integrations are added.
_Avoid_: Provider-specific project names, browser generator, provider name

**Generation Provider**:
The one globally selected capability that produces raster images for Codex. The canonical values are Default, Grok, and GPT Web; the set may grow without changing the Web ImageGen identity.
_Avoid_: Browser backend, workflow mode, fallback

**Default Provider**:
The official image-generation capability built into Codex. Its switch value is `default`; it is distinct from the browser-controlled GPT Web Provider Integration even though both use OpenAI products.
_Avoid_: OpenAI provider, built-in provider, ChatGPT provider

**Provider Integration**:
A supplier-specific generation boundary selected explicitly as a Generation Provider. Provider integrations do not silently route to or fall back to one another.
_Avoid_: Compatibility layer, fallback backend, automatic route

**Provider Switch**:
The user's global choice of Generation Provider. Exactly one provider is active, and the choice is not inferred from an image prompt.
_Avoid_: Workflow switch, automatic routing, fallback chain

**GPT Web Provider Integration**:
The planned browser-controlled integration that generates images in a user-supplied, authenticated ChatGPT web tab. Its switch value is `gpt`; it is separate from the Default Provider.
_Avoid_: ChatGPT provider, OpenAI provider, Default Provider

**Generation Batch**:
A provider-neutral request for one visual outcome and the candidate images collected for it. A batch may use a bounded number of Provider Attempts when the active provider cannot produce the requested candidate count atomically.
_Avoid_: Job, run, response

**Provider Attempt**:
One prompt submission to the active Provider Integration within a Generation Batch. Attempt limits are explicit so a provider with variable output count cannot spend quota indefinitely.
_Avoid_: Batch, retry, fallback

**Candidate Image**:
A validated image belonging to the current generation batch and eligible for selection.
_Avoid_: Preview, thumbnail, historic image

**AI-led Workflow**:
A user-selected workflow in which Codex generates a batch, collects two candidate images, and chooses the final image.
_Avoid_: Automatic mode, agent mode, scenario A

**User-led Workflow**:
A user-selected workflow in which the user directs generation and makes the final choice, either in the provider interface or from numbered candidate images.
_Avoid_: Interactive mode, manual mode, scenario B

**Workflow Mode**:
The user's explicit choice between the AI-led and user-led workflows. It remains active for the current Codex task until the user changes it and is not inferred from an image prompt.
_Avoid_: Detected mode, automatic routing

**Recovery Retry**:
One repeated generation attempt used to recover missing, corrupt, or invalid candidate files without changing the requested result.
_Avoid_: Refinement retry, fallback, unlimited retry

**Refinement Retry**:
One additional generation batch authorized by the user when valid candidate images fail the required visual outcome.
_Avoid_: Recovery retry, unlimited redraw, silent retry

**Reference Image**:
An existing local image supplied as visual input to a generation batch.
_Avoid_: Candidate image, previous result, attachment

**Chosen Image**:
The candidate image accepted as a final result of a generation batch.
_Avoid_: Selected preview, screenshot

**Materialized Original**:
Complete provider-produced image bytes exported through the active Provider Integration into a local file and accepted by hard image validation. A browser reference, data URI string, thumbnail, or screenshot is not a Materialized Original by itself.
_Avoid_: Download link, preview, browser source, screenshot
