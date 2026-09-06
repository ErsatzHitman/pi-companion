/**
 * `features/voice` barrel (T36D, plan.md §9.2; mounted by T70).
 *
 * Voice entry through the core outbox: a permission-gated capture
 * lifecycle (`voice-model.ts`) over an injected `VoiceCapturePort`
 * (`voice-capture-port.ts`). No screen here — same "a model that takes
 * its dependencies as data" shape `../notifications/index.ts` (T36A)
 * left for its own next wave to mount. **T36D's own header used to say
 * "nothing imports this barrel yet" — T70 (P5-W21) is that next wave:
 * `../composer/Composer.tsx` now imports `createVoiceCaptureController`/
 * `createUnavailableVoiceCapturePort` directly and drives them from the
 * mic action, over the SAME `outbox`/`sessionId`/`onSubmit` a text send
 * already uses — see that file's `voiceCapture` prop doc comment and
 * `../composer/composer-voice-wiring.test.ts` for the proof.**
 */
export { createVoiceCaptureController, IDLE_VOICE_STATE } from "./voice-model";
export type {
  VoiceCancelOutcome,
  VoiceCancelReason,
  VoiceCaptureController,
  VoiceCaptureControllerDeps,
  VoiceOutboxLike,
  VoicePromptPayload,
  VoiceRecordingStatus,
  VoiceStartOutcome,
  VoiceState,
  VoiceStopOutcome,
} from "./voice-model";

export { createUnavailableVoiceCapturePort } from "./voice-capture-port";
export type { VoiceCaptureOutcome, VoiceCapturePort } from "./voice-capture-port";
