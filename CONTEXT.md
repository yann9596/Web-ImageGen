# Web Image Generation

This context covers provider-neutral generation, evaluation, and selection of project images for Codex.

## Language

**Web ImageGen**:
The provider-neutral Codex image-generation capability delivered by this project. Its identity remains stable as provider integrations are added.
_Avoid_: Provider-specific project names, browser generator, provider name

**Generation Provider**:
The one globally selected capability that produces raster images for Codex. Current values are OpenAI ImageGen and Grok; the set may grow without changing the Web ImageGen identity.
_Avoid_: Browser backend, workflow mode, fallback

**Provider Integration**:
A supplier-specific generation boundary selected explicitly as a Generation Provider. Provider integrations do not silently route to or fall back to one another.
_Avoid_: Compatibility layer, fallback backend, automatic route

**Provider Switch**:
The user's global choice of Generation Provider. Exactly one provider is active, and the choice is not inferred from an image prompt.
_Avoid_: Workflow switch, automatic routing, fallback chain

**Generation Batch**:
A single provider generation request and the candidate images produced for that request.
_Avoid_: Job, run, response

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
