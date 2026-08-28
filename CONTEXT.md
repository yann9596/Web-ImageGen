# Grok Image Generation

This context covers generating, evaluating, and choosing images through Grok.

## Language

**Generation Provider**:
The one globally selected capability that produces or edits raster images for Codex: either OpenAI ImageGen or Grok through the user's Chrome tab.
_Avoid_: Browser backend, workflow mode, fallback

**Provider Switch**:
The user's global choice of Generation Provider. Exactly one provider is active, and the choice is not inferred from an image prompt.
_Avoid_: Workflow switch, automatic routing, fallback chain

**Generation Batch**:
A single Grok generation request and the candidate images produced for that request.
_Avoid_: Job, run, response

**Candidate Image**:
A validated image belonging to the current generation batch and eligible for selection.
_Avoid_: Preview, thumbnail, historic image

**AI-led Workflow**:
A user-selected workflow in which Codex generates a batch, collects two candidate images, and chooses the final image.
_Avoid_: Automatic mode, agent mode, scenario A

**User-led Workflow**:
A user-selected workflow in which the user directs generation and makes the final choice. In its single-image branch the user chooses in Grok; in its multi-image branch the user chooses from numbered candidate images.
_Avoid_: Interactive mode, manual mode, scenario B

**Workflow Mode**:
The user's explicit choice between the AI-led and user-led workflows for generation. It remains active for the current Codex task until the user changes it and is not inferred from the wording or content of an image prompt.
_Avoid_: Detected mode, automatic routing

**Refinement Retry**:
One additional generation batch authorized by the user when valid candidate images fail the required visual outcome. It is distinct from an automatic recovery retry for missing or invalid candidates.
_Avoid_: Failure retry, unlimited redraw, silent retry

**Reference Image**:
An existing local image supplied as visual input to a generation batch.
_Avoid_: Candidate image, previous result, attachment

**Chosen Image**:
The one candidate image accepted as the final result of a generation batch.
_Avoid_: Selected preview, screenshot
