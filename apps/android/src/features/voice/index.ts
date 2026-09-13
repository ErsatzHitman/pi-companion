/**
 * `features/voice` barrel (T36D, plan.md §9.2; mounted by T70).
 *
 * Voice entry as a composer draft: a permission-gated capture
 * lifecycle (`voice-model.ts`) over an injected `VoiceCapturePort`
 * (`voice-capture-port.ts`). No screen here — same "a model that takes
 * its dependencies as data" shape `../notifications/index.ts` (T36A)
 * left for its own next wave to mount. **T36D's own header used to say
 * "nothing imports this barrel yet" — T70 (P5-W21) is that next wave:
 * `../composer/Composer.tsx` now imports `createVoiceCaptureController`/
 * `createExpoAudioVoiceCapturePort` (T276; was
 * `createUnavailableVoiceCapturePort` before that) directly and drives
 * them from the mic action — see that file's `voiceCapture` prop doc
 * comment and `../composer/composer-voice-wiring.test.ts`.
 * CORRECTED at the P9-O merge gate: this said the mic action runs
 * "over the SAME `outbox`/`sessionId`/`onSubmit` a text send already
 * uses — see ... `composer-voice-wiring.test.ts` for the proof", which
 * T277 falsified five lines below in this same file. The cited test
 * now proves the opposite: its first case asserts
 * `expect(call).not.toMatch(/outbox/)`.**
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
 * `VoiceTranscriptionClient`/`Composer.tsx`'s `transcribeClient` prop.
 * **T282 wires that prop at the only production mount** — see
 * `voice-model.ts`'s own header ("T282 wires this at the only production
 * mount") for the exact resolve call — so a real recording against a
 * connected daemon now transcribes for real; the honest
 * `"transcription-unavailable"` outcome still covers the no-connection
 * case, never a silent no-op.
 *
 * **Voice vocabulary (this task).** `voice-vocabulary-model.ts` owns the
 * user-maintained vocabulary list (persisted words/phrases plus the
 * deterministic `applyVoiceVocabularyRepair` pass `voice-model.ts`'s
 * `requestStop` applies after cleanup) and `voice-vocabulary-section.tsx`
 * draws its settings section, mounted by `../settings/SettingsScreen.tsx`.
 * The session route threads the stored list into the voice controller via
 * `ComposerProps.vocabulary`, so saved words take effect for transcription
 * repair; the repair itself is proven in `voice-model.test.ts`.
 */
export {
  applyTranscriptToDraft,
  cleanTranscript,
  createVoiceCaptureController,
  IDLE_VOICE_STATE,
} from "./voice-model";
export {
  applyVoiceVocabularyRepair,
  createVoiceVocabularyController,
  MAX_VOICE_VOCABULARY_ENTRIES,
  MAX_VOICE_VOCABULARY_ENTRY_LENGTH,
  normalizeVoiceVocabularyEntry,
  VOICE_VOCABULARY_STORAGE_KEY,
} from "./voice-vocabulary-model";
export type {
  VoiceVocabularyAddResult,
  VoiceVocabularyController,
  VoiceVocabularyControllerDeps,
  VoiceVocabularySnapshot,
  VoiceVocabularySnapshotListener,
} from "./voice-vocabulary-model";
export { VoiceVocabularySection } from "./voice-vocabulary-section";
export type { VoiceVocabularySectionProps } from "./voice-vocabulary-section";
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
