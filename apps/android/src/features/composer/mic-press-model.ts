/**
 * The mic-press decision (T83, plan.md §9.2).
 *
 * RN-free for the same reason as `composer-focus-model.ts`/
 * `composer-model.ts` (see either's header): `vitest` cannot render
 * `Composer.tsx` under this workspace's plain setup (a `react-native`
 * RolldownError — the "RN-in-vitest limitation" this repo's `CLAUDE.md`
 * catalogues), so the decision a mic press makes lives here as a plain
 * async function over an injected `VoiceCaptureController`, independent
 * of any `useState`/`useCallback`. `Composer.tsx`'s `handleMicPress` is
 * now a thin wrapper that calls this function and folds its result into
 * `setVoiceState`/`setVoiceOutcome`/`setMicPermissionState` — see that
 * file's own doc comment above `handleMicPress`.
 *
 * ## The bug this closes
 *
 * Before this task, `Composer.tsx`'s `handleMicPress` resolved
 * microphone permission **twice** per press, against **two separate
 * ports**:
 *
 *  1. `resolvePermission(resolvedMicPermission)` — T33B7's own
 *     precheck, over `mic-permission-port.ts`'s `MicPermissionPort`.
 *  2. `voiceController.requestStart()` — T70's real recording toggle,
 *     which internally calls its OWN `resolvePermission(port)`
 *     (`../voice/voice-model.ts`'s `requestStart`) over the SEPARATE
 *     `resolvedVoiceCapture` port.
 *
 * Both currently default to `createUnavailable*Port()` (no recorder
 * installed — see `../voice/voice-capture-port.ts`'s header), so the
 * double call was invisible: two `"unavailable"` reads look the same as
 * one. With a real recorder wired, this is two OS permission prompts
 * for the ONE permission Android itself tracks — a user-visible defect,
 * and a likely denial on the second, redundant prompt. T70 filed this
 * exactly, in `Composer.tsx`'s `voiceCapture` prop doc comment: "`
 * VoiceCapturePort` extends the same `PermissionPort` shape as
 * `MicPermissionPort`, so once a real recorder is wired, passing the
 * identical object to both props avoids two separate OS permission
 * prompts for what is, on-device, one permission."
 *
 * ## The fix
 *
 * There is exactly one call into permission resolution per press now:
 * `voiceController.requestStart()`'s own internal one, when starting.
 * Stopping a recording that is already in progress never resolves
 * permission at all (it was already granted, or `requestStart` would
 * never have transitioned to `"recording"`). `MicPermissionPort`/
 * `createUnavailableMicPermissionPort` are no longer referenced by the
 * mic action at all — see `Composer.tsx`'s own doc comment.
 *
 * CORRECTED (P6-W5 merge gate): an earlier version of this comment said that
 * module was "kept (not deleted)" and pointed at its header. That is no
 * longer true — `mic-permission-port.ts` was DELETED by T94 (`bb6a9fe`) once T83
 * collapsed the double microphone prompt onto `VoiceCapturePort` and
 * left it with zero production consumers.
 * The history above is left as written because it explains WHY the
 * collapse happened; only the claim about the file's continued
 * existence was wrong.
 *
 * `mic-press-model.test.ts` proves the "exactly one resolution" claim
 * with a counting fake `VoiceCapturePort` wired through the REAL
 * `createVoiceCaptureController` (`../voice/voice-model.ts`) — not a
 * further fake standing in for that controller — so the assertion
 * exercises the actual production call graph this function drives.
 */
import type { PermissionState } from "./permission-recovery.js";
import type { VoiceCaptureController, VoiceState, VoiceStopOutcome } from "../voice/voice-model.js";

/** The narrow slice of `VoiceCaptureController` a mic press needs — same "narrow surface" pattern used across this feature (e.g. `voice-model.ts`'s own `VoiceTranscriptionClient`). */
export type MicPressVoiceController = Pick<
  VoiceCaptureController,
  "getState" | "requestStart" | "requestStop"
>;

export interface MicPressResult {
  /** The controller's state immediately after this press settled. */
  voiceState: VoiceState;
  /** Set only when this press was a stop (a start press never produces one — `voice-model.ts`'s `VoiceStartOutcome` carries no stop-shaped outcome). */
  voiceOutcome: VoiceStopOutcome | null;
  /** Set only when a start press came back permission-denied. `null` for a stop press, and for a granted start — never a value from a second, separate permission read. */
  micPermissionState: PermissionState | null;
}

/**
 * Runs one mic press to completion. Toggles start vs. stop purely from
 * `voiceController.getState()` — never a flag this function or its
 * caller tracks separately — exactly the decision `Composer.tsx`'s
 * pre-T83 `handleMicPress` made; the only change is that permission is
 * resolved by `requestStart()` alone, never a second time here.
 */
export async function runMicPress(
  voiceController: MicPressVoiceController,
): Promise<MicPressResult> {
  if (voiceController.getState().status === "recording") {
    const outcome = await voiceController.requestStop();
    return {
      voiceState: voiceController.getState(),
      voiceOutcome: outcome,
      micPermissionState: null,
    };
  }

  const startOutcome = await voiceController.requestStart();
  return {
    voiceState: voiceController.getState(),
    voiceOutcome: null,
    micPermissionState: startOutcome.outcome === "permission-denied" ? startOutcome.state : null,
  };
}
