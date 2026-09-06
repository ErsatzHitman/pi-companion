/**
 * Android haptics platform module (T33B6, plan.md §9.3).
 *
 * ## What a call site needs
 *
 * ```ts
 * import { createRNVibrationPlatform, fireHaptic } from "../../platform/haptics/index.js";
 *
 * const vibrationPlatform = createRNVibrationPlatform(); // construct once, e.g. in app-shell
 *
 * fireHaptic(vibrationPlatform, {
 *   trigger: "approval",
 *   hapticsEnabled: settings.hapticsEnabled, // read from wherever the app's haptics toggle lives
 *   visibleSignal: "approval-banner", // the visible cue this haptic accompanies
 * });
 * ```
 *
 * ## Where the four triggers actually fire (P5-W13)
 *
 * This module is mounted. `createRNVibrationPlatform()` is constructed
 * exactly once, in `app-shell/core.ts` (T32S9), and exposed as
 * `AppCore.vibrationPlatform`; features receive it as a prop rather than
 * constructing a second one. All four plan.md §9.3 triggers now fire from
 * real call sites, each alongside the visible signal `fireHaptic`'s
 * `visibleSignal` argument names:
 *
 * - **blocked** -- `features/approvals/approvals-haptics-model.ts`
 *   (`fireBlockedHapticOnNewRequest`, T32S9), the instant a new request
 *   becomes the current one and the approvals sheet opens.
 * - **approval** -- the same module's `fireApprovalDecisionHaptic`
 *   (T32S9), the instant the user's own Approve/Deny decision is
 *   registered, before any network round trip.
 * - **finished** -- `features/transcript/transcript-status-haptics-model.
 *   ts` (`fireTranscriptStatusHaptic`, T33A6), on a `streaming` ->
 *   `connected` `TranscriptStatus` transition, alongside
 *   `TranscriptStatusStrip`.
 * - **error** -- the same function, on any transition into `error`.
 *
 * Both firing modules import `fireHaptic` from `./haptic.js` directly
 * rather than through this barrel, because this barrel re-exports
 * `createRNVibrationPlatform`, which imports `react-native` -- and this
 * workspace's vitest cannot parse it. Keep that split when adding a
 * trigger: the decision half stays react-native-free and unit tested,
 * and only the thin view/route layer touches this barrel.
 *
 * ## Suppression is not optional
 *
 * Every call site goes through `fireHaptic`, never `platform.vibrate()`
 * directly, so the `hapticsEnabled` check and the `visibleSignal`
 * requirement cannot be bypassed;
 * `features/approvals/approvals-haptics-model.test.ts` asserts exactly
 * that over its own source. No settings surface exists in `apps/android`
 * yet, so both call sites pass `hapticsEnabled: true` today -- a future
 * settings task owns threading a real toggle down to both at once.
 */
export {
  fireHaptic,
  HAPTIC_PATTERNS,
  HAPTIC_TRIGGERS,
  type FireHapticRequest,
  type FireHapticResult,
  type HapticTrigger,
  type VibrationPattern,
  type VibrationPlatform,
} from "./haptic.js";
export { createFakeVibrationPlatform } from "./fake-vibration-platform.js";
export { createRNVibrationPlatform } from "./vibration-platform.js";
