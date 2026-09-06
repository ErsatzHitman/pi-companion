/**
 * T33A6: pure, `react-native`-free firing logic for the two §9.3 haptic
 * triggers this task owns from `features/transcript/` — "finished" and
 * "error" (plan.md §9.3; see `platform/haptics/index.ts`'s "What a call
 * site needs" and `../approvals/approvals-haptics-model.ts`'s identical
 * split for "approval"/"blocked", filed by T32S9 this same wave).
 *
 * Imports `fireHaptic`/`VibrationPlatform` from `../../platform/haptics/
 * haptic.js` directly, **not** the feature barrel `../../platform/
 * haptics/index.js`, for the identical reason `approvals-haptics-model.ts`
 * does: that barrel re-exports `createRNVibrationPlatform`, which imports
 * `react-native`'s `Vibration`, and this workspace's `vitest` cannot
 * import anything that reaches `react-native`.
 *
 * ## Which transition fires which trigger
 *
 * Both triggers key off `status-model.ts`'s own `TranscriptStatus`
 * vocabulary — the single ordered status this screen already computes,
 * never a private second status of this module's own:
 *
 * - **"error"** fires the instant `next === "error"` and `previous !==
 *   "error"` — an agent/turn error just became visible. The status
 *   strip's own error text (`buildTranscriptStatusViewModel("error",
 *   ...)`) is the visible signal it accompanies.
 * - **"finished"** fires the instant a turn that *was* `"streaming"`
 *   settles back to `"connected"` — the agent stopped actively streaming
 *   a response. `deriveTranscriptStatus`'s own doc comment confirms this
 *   is the only status `"streaming"` can fall back to once
 *   `agentActivity` is no longer `"streaming"`/`"error"` and the
 *   connection itself is healthy, so this is the one unambiguous
 *   "a turn just finished" edge this status vocabulary can express. The
 *   status strip's own settled text ("Connected") is the visible signal.
 *
 * Neither fires when `previous === next` (an unrelated recompute that
 * lands on the same status must never refire the same haptic — the exact
 * "no-op recompute" guard `fireBlockedHapticOnNewRequest` documents for
 * its own trigger).
 *
 * No settings surface exists yet for a haptics on/off toggle anywhere in
 * `apps/android` (searched; matches `approvals-haptics-model.ts`'s
 * identical finding) — `hapticsEnabled` is threaded through unchanged
 * rather than read from a private toggle here; a future settings task
 * owns adding a real one.
 *
 * **Mounted** by the P5-W13 merge gate, in `app/h/[serverId]/session/
 * [agentId]/index.tsx`'s `SessionTranscript`: it holds the `previous`
 * `TranscriptStatus` in a ref updated after each call, and passes
 * `AppCore.vibrationPlatform` (T32S9, `app-shell/core.ts`). T33A6 could
 * not do that itself - both files are outside its `Owns` grant - and
 * T32S9's commit landed before this module existed, so the gate took the
 * seam rather than leaving a third wave-P5 module with no live importer.
 * The status this route passes is the same one it renders through
 * `TranscriptStatusStrip`, which is what makes that strip a truthful
 * `visibleSignal` for both triggers.
 */
import { fireHaptic, type VibrationPlatform } from "../../platform/haptics/haptic.js";

import type { TranscriptStatus } from "./status-model.js";

/**
 * Fires the "error"/"finished" §9.3 triggers off a `TranscriptStatus`
 * transition. Returns whether a trigger fired (independent of
 * `hapticsEnabled` suppression, matching `fireBlockedHapticOnNewRequest`'s
 * own return-value contract), so a caller/test can assert the transition
 * was actually detected.
 */
export function fireTranscriptStatusHaptic(
  platform: VibrationPlatform,
  hapticsEnabled: boolean,
  previous: TranscriptStatus | null,
  next: TranscriptStatus,
): boolean {
  if (previous === next) {
    return false;
  }
  if (next === "error") {
    fireHaptic(platform, {
      trigger: "error",
      hapticsEnabled,
      visibleSignal: "transcript-status-strip",
    });
    return true;
  }
  if (previous === "streaming" && next === "connected") {
    fireHaptic(platform, {
      trigger: "finished",
      hapticsEnabled,
      visibleSignal: "transcript-status-strip",
    });
    return true;
  }
  return false;
}
