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
 * `createExpoAudioVoiceCapturePort` (T276; was
 * `createUnavailableVoiceCapturePort` before that) directly and drives
 * them from the mic action, over the SAME `outbox`/`sessionId`/
 * `onSubmit` a text send already uses — see that file's `voiceCapture`
 * prop doc comment and `../composer/composer-voice-wiring.test.ts` for
 * the proof.**
 *
 * `createExpoAudioVoiceCapturePort` (T276) is exported from its own
 * file, `expo-audio-voice-capture-port.ts`, not from `voice-capture-
 * port.ts` — that file's own header explains why (its real `expo-audio`
 * import transitively reaches `react-native`, which every existing
 * RN-free test in this directory needs to stay clear of).
 * `VoiceCaptureIndicator` (T276, `voice-capture-indicator.tsx`) is the
 * mic control's waveform/processing glyph, mounted by `Composer.tsx`
 * while `VoiceState.status` is `"recording"`/`"processing"`.
 *
 * **T277: a finished transcript is a DRAFT, not a send.** `voice-model.ts`
 * no longer touches an outbox — `VoiceOutboxLike`/`VoicePromptPayload` are
 * gone, and `VoiceStopOutcome`'s `"queued"`/`"send-failed"` cases are now
 * `"drafted"` (the text to insert into the composer draft) and
 * `"transcription-failed"`. `raw-audio-unsupported` is gone too:
 * `{ kind: "audio" }` now genuinely transcribes through
 * `VoiceTranscriptionClient`/`Composer.tsx`'s `transcribeClient` prop when
 * one is wired, and resolves the honest `"transcription-unavailable"` when
 * it is not (see `voice-model.ts`'s own header for why nothing wires that
 * prop in this task).
 */
export {
  applyTranscriptToDraft,
  cleanTranscript,
  createVoiceCaptureController,
  IDLE_VOICE_STATE,
} from "./voice-model";
export type {
  VoiceCancelOutcome,
  VoiceCancelReason,
  VoiceCaptureController,
  VoiceCaptureControllerDeps,
  VoiceRecordingStatus,
  VoiceStartOutcome,
  VoiceState,
  VoiceStopOutcome,
  VoiceTranscriptionClient,
} from "./voice-model";

export { createUnavailableVoiceCapturePort } from "./voice-capture-port";
export type { VoiceCaptureOutcome, VoiceCapturePort } from "./voice-capture-port";

export { createExpoAudioVoiceCapturePort } from "./expo-audio-voice-capture-port";
export type {
  ExpoPermissionResponse,
  RecorderHandle,
  VoiceCaptureBindings,
} from "./expo-audio-voice-capture-port";

export { VoiceCaptureIndicator } from "./voice-capture-indicator";
export type { VoiceCaptureIndicatorProps } from "./voice-capture-indicator";
