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
 * **T276: a real capture implementation now exists.** The owner
 * installed `expo-audio@~1.0.13` (resolves 1.0.16) at `fad6be1` for
 * this exact task — see `docs/issues-from-plan.md`'s T276 section,
 * which settles the dependency question and forbids re-opening it. The
 * real port is `createExpoAudioVoiceCapturePort`
 * (`./expo-audio-voice-capture-port.ts`), deliberately **not**
 * declared in this file: that module's own top-level `import ...  from
 * "expo-audio"` transitively imports `react-native` (`ExpoAudio.js`
 * imports `Platform`), which is exactly the "RN-in-vitest limitation"
 * this repository's `CLAUDE.md` catalogues — any test importing a
 * module that reaches `react-native` fails. Keeping that import out of
 * *this* file is what keeps `createUnavailableVoiceCapturePort` below,
 * and every test that imports it, `react-native`-free.
 * `Composer.tsx` now defaults `voiceCapture` to the real port; this
 * file's `createUnavailableVoiceCapturePort` remains exported as an
 * explicit, honest "no capture" choice — a caller that wants voice
 * entry deliberately disabled (or a test standing in for one) still
 * has it, but it is no longer this build's *only* production
 * `VoiceCapturePort`, and no longer the default.
 *
 * `expo-audio-voice-capture-port.ts`'s own header covers: why
 * `expo-file-system` (mentioned as available in T276's brief) is
 * NOT used for reading the finished clip or deleting a cancelled one
 * (measured, not assumed — that package is not actually a declared
 * dependency of `apps/android`, and the only copy that resolves from
 * this app's source tree today is a different SDK generation's stray
 * hoist); the REQUESTED vs. MEASURED recording format distinction
 * T276's brief requires; and the one disclosed gap this task leaves
 * (a cancelled recording's file is not deleted from device storage).
 *
 * `voice-model.ts` accepts either `VoiceCaptureOutcome` kind already —
 * see that module's header for what this wave actually does with
 * each. T276 ships the real `"audio"`-producing capture; closing the
 * `"raw-audio-unsupported"` dead end on the receiving side is T277's
 * job, not this one (T276's brief is explicit about that boundary).
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

/**
 * An explicit "no capture" `VoiceCapturePort` — no longer this build's
 * only production implementation (T276 added
 * `createExpoAudioVoiceCapturePort`, `./expo-audio-voice-capture-port.ts`,
 * now `Composer.tsx`'s default), but still a real, honest choice for a
 * caller that wants voice entry disabled outright. See module docstring.
 */
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
