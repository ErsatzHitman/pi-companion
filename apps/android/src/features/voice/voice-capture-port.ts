/**
 * Voice-capture port (T36D, plan.md §9.2/§12.4).
 *
 * `features/composer/mic-permission-port.ts` (T33B7) ONCE owned the
 * microphone *permission* check behind the mic icon; this module was
 * deliberately just the next step, actual capture, extending that same
 * `PermissionPort` shape (`getPermissionStatus`/`requestPermission`)
 * rather than declaring a fourth permission vocabulary.
 *
 * CORRECTED (P6-W5 merge gate): `mic-permission-port.ts` was DELETED by T94 (`bb6a9fe`) once T83
 * collapsed the double microphone prompt onto `VoiceCapturePort` and
 * left it with zero production consumers.
 * T83 had already collapsed both prompts onto this port, so THIS module
 * is now the single owner of the microphone permission as well as the
 * capture. Nothing to consult in that file any more — the shape it
 * established lives on here.
 *
 * **No audio-recording dependency is installed in this workspace.**
 * `apps/android/package.json` carries no `expo-audio` today (confirmed
 * via `ls node_modules | grep -i audio` at this task's start — nothing
 * matched under `apps/android/node_modules`; the repo-root hoist has
 * `expo-audio`/`expo-speech` only because some *other* worktree's
 * install put them there, not this app's), and this task may not run
 * `npm install`. `createUnavailableVoiceCapturePort` below is
 * therefore this module's only production implementation. (The
 * precedent this once cited, `mic-permission-port.ts`'s identically
 * shaped `createUnavailableMicPermissionPort`, was deleted by T94 —
 * `../notifications/push-registration-port.ts` and
 * `../composer/attachment-source-port.ts` still follow the same
 * pattern.)
 *
 * To wire a real capture port once available (version pinned exactly
 * per *this app's own* installed `expo`
 * (`apps/android/node_modules/expo/bundledNativeModules.json`, not the
 * differently-versioned `expo` hoisted into the repo root from other
 * worktrees' installs — the same note
 * `../notifications/push-registration-port.ts` carries):
 *
 *   npm install --workspace=@picompanion/android expo-audio@~1.1.1
 *
 * — then implement `start`/`stop`/`cancel` against `expo-audio`'s
 * `AudioModule.RecordingPresets` + `useAudioRecorder`/
 * `AudioRecorder.record()`/`.stop()`, and either:
 *
 *  1. resolve `stop()` with `{ kind: "audio", audioBase64, format }`
 *     read from the recorder's output file via `expo-file-system`,
 *     for a daemon that transcribes server-side (see this directory's
 *     `README`-equivalent note in `voice-model.ts`'s header on why
 *     that is the wire shape this repo's protocol already expects —
 *     `packages/protocol/src/messages.ts`'s `VoiceAudioChunkMessage` /
 *     `TranscriptionResultMessage`, and
 *     `packages/client/src/daemon-client.ts`'s
 *     `sendVoiceAudioChunk`/`setVoiceMode`); or
 *  2. resolve `stop()` with `{ kind: "transcript", text }` directly,
 *     if an on-device speech-to-text module is added instead (none is
 *     installed or evaluated by this task).
 *
 * `voice-model.ts` accepts either outcome kind already — see that
 * module's header for what this wave actually does with each.
 */
import type { PermissionPort } from "../composer/permission-recovery.js";

/**
 * What one finished recording produced. A port MAY resolve either kind
 * — `voice-model.ts`'s controller only ever forwards a `"transcript"`
 * into the outbox (see that module's header for why a `"audio"`
 * outcome is deliberately *not* persisted anywhere this wave).
 */
export type VoiceCaptureOutcome =
  | { kind: "transcript"; text: string }
  | { kind: "audio"; audioBase64: string; format: string };

export interface VoiceCapturePort extends PermissionPort {
  /**
   * Begins recording. Only ever called after `getPermissionStatus`/
   * `requestPermission` (via `resolvePermission`, reused from
   * `../composer/permission-recovery.js`) has already reported
   * `"granted"` — see `voice-model.ts`'s `requestStart`.
   */
  start(): Promise<void>;
  /**
   * Stops recording and resolves the captured result. Never called
   * except after a matching `start()` with no intervening `cancel()`.
   */
  stop(): Promise<VoiceCaptureOutcome>;
  /**
   * Stops recording (if any) and discards whatever was captured so
   * far — the audio must not be retrievable afterward. Safe to call
   * even when nothing is recording (a no-op).
   */
  cancel(): Promise<void>;
}

/** This build's only production `VoiceCapturePort` — see module docstring. */
export function createUnavailableVoiceCapturePort(): VoiceCapturePort {
  return {
    async getPermissionStatus() {
      return "unavailable";
    },
    async requestPermission() {
      return "unavailable";
    },
    async start() {
      // Nothing to start — no native recorder exists in this build.
    },
    async stop() {
      // Nothing was recorded; an empty transcript is `voice-model.ts`'s
      // own "empty-transcript" no-op outcome, never enqueued.
      return { kind: "transcript", text: "" };
    },
    async cancel() {
      // Nothing to discard.
    },
  };
}
