/**
 * T32S9: pure, `react-native`-free firing logic for the two §9.3 haptic
 * triggers this task owns from `features/approvals/` — "approval" and
 * "blocked" (plan.md §9.3; see `platform/haptics/index.ts`'s "What a call
 * site needs" for the four-trigger split across features). The other two
 * triggers, "finished" and "error", belong to `features/transcript/`
 * (T33A6's grant this wave) — see this task's report for the seam filed
 * against it rather than reached into it here.
 *
 * Imports `fireHaptic`/`VibrationPlatform` from `../../platform/haptics/
 * haptic.js` directly, **not** the feature barrel
 * `../../platform/haptics/index.js`, on purpose: that barrel re-exports
 * `createRNVibrationPlatform`, which imports `react-native`'s `Vibration`,
 * and this repo's vitest cannot import anything that reaches
 * `react-native` (see this task's report). Going through `haptic.js`
 * keeps this module — and its test — real unit-testable logic, not a
 * render test.
 *
 * ## Which event fires which trigger, and why
 *
 * - **"blocked"** fires the moment a *new* request becomes
 *   `ApprovalsQueueSnapshot.current` — i.e. exactly when
 *   `ApprovalsHost`'s `Sheet` opens for a request the user has not yet
 *   seen. That is the instant the agent's turn is actually blocked
 *   pending the user's decision (plan.md §9.3's "an agent is blocked
 *   pending approval"), and the sheet itself — described by its own
 *   `HAPTIC_PATTERNS` doc comment as a "stopped short" stutter — is the
 *   visible signal it accompanies.
 * - **"approval"** fires the moment the user's own decision is
 *   registered — i.e. every call to `useApprovalsQueue`'s `respond()`
 *   while there is a `current` request. `HAPTIC_PATTERNS.approval` is
 *   documented as "a quiet 'received'": a light confirmation pulse for
 *   the user's own tap, not a second announcement of the request itself
 *   (that is "blocked", above). Fired synchronously when `respond()`
 *   runs, before any network round-trip — the same "your tap was
 *   registered locally" moment `controller.answer()` already commits at.
 *
 * `index.ts`'s own doc comment describes "approval" as firing "when a
 * permission request is shown or decided" without picking one; this
 * module picks "decided" for "approval" and reassigns "shown" to
 * "blocked" so the two triggers name two genuinely distinct moments
 * instead of firing together for the same transition.
 *
 * No settings surface exists yet for a haptics on/off toggle anywhere in
 * `apps/android` (searched; there is no `hapticsEnabled` source besides
 * this module and `platform/haptics/` itself) — both functions below
 * default `hapticsEnabled` to `true` at their call sites
 * (`use-approvals-queue.ts`) rather than inventing a private toggle. A
 * future settings task owns adding a real one and threading it through.
 */
import { fireHaptic, type VibrationPlatform } from "../../platform/haptics/haptic.js";

import type { ApprovalsQueueSnapshot } from "./approvals-queue-model.js";

/** The empty starting snapshot — matches `getApprovalsQueueSnapshot`'s own return for a controller with nothing pending. */
export const EMPTY_APPROVALS_QUEUE_SNAPSHOT: ApprovalsQueueSnapshot = {
  current: null,
  waitingCount: 0,
};

/**
 * Fires the "blocked" haptic exactly when `next.current` names a request
 * `previous` had not surfaced yet — a fresh, real `requestId`, not merely
 * "current is non-null" (which would refire on every unrelated snapshot
 * recompute while the same request is still pending). Returns whether it
 * fired, so a caller/test can assert the transition was actually
 * detected rather than only that `fireHaptic` exists.
 */
export function fireBlockedHapticOnNewRequest(
  platform: VibrationPlatform,
  hapticsEnabled: boolean,
  previous: ApprovalsQueueSnapshot,
  next: ApprovalsQueueSnapshot,
): boolean {
  const previousRequestId = previous.current?.requestId ?? null;
  const nextRequestId = next.current?.requestId ?? null;
  if (nextRequestId === null || nextRequestId === previousRequestId) {
    return false;
  }
  fireHaptic(platform, {
    trigger: "blocked",
    hapticsEnabled,
    visibleSignal: "approvals-sheet",
  });
  return true;
}

/**
 * Fires the "approval" haptic for the user's own decision. Callers must
 * only invoke this when a `current` request actually existed to answer
 * (`use-approvals-queue.ts`'s `respond()` already guards that — see its
 * `if (!current) return;` early return) so this never fires for a no-op
 * `respond()` call.
 */
export function fireApprovalDecisionHaptic(
  platform: VibrationPlatform,
  hapticsEnabled: boolean,
): void {
  fireHaptic(platform, {
    trigger: "approval",
    hapticsEnabled,
    visibleSignal: "approval-decision",
  });
}
