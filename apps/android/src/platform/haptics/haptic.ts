/**
 * T33B6: the four §9.3 haptic patterns (approval, finished, error, blocked)
 * and the single gated entry point that fires them.
 *
 * plan.md §9.3 says only that these four states "have haptic patterns" — it
 * gives no concrete durations. `HAPTIC_PATTERNS` below is this task's own
 * design, not a value read out of the spec; see its doc comment for the
 * rationale. If a later task tightens the spec with real values, update the
 * table there — nothing else in this module should need to change.
 *
 * This file is deliberately `react-native`-free (per the repo's vitest
 * limitation: any module reaching `react-native` cannot be render-tested
 * here) so the actual trigger/suppression/visible-signal logic is provable
 * with plain unit tests. The real device output lives behind the
 * `VibrationPlatform` port in `./vibration-platform.ts`.
 */

/** The four §9.3 states that carry a haptic pattern. */
export type HapticTrigger = "approval" | "finished" | "error" | "blocked";

export const HAPTIC_TRIGGERS: readonly HapticTrigger[] = [
  "approval",
  "finished",
  "error",
  "blocked",
];

/**
 * A vibration pattern in React Native's `Vibration.vibrate(pattern)` shape:
 * alternating `[off, on, off, on, ...]` millisecond durations, starting with
 * an initial `off` (usually `0`). Kept as a plain `number[]` rather than a
 * richer type so it maps directly onto both `Vibration.vibrate` (React
 * Native's built-in API — see `./vibration-platform.ts` for why that was
 * chosen over `expo-haptics`) and `expo-haptics`' pattern-less API, if a
 * later task swaps the platform in.
 */
export type VibrationPattern = readonly number[];

/**
 * This task's own chosen durations (plan.md §9.3 specifies only that these
 * four states have patterns, not what they are). Each pattern is built from
 * three constraints:
 *
 * - every pattern must be tellable apart from the other three by feel alone
 *   (distinct pulse counts and/or rhythm, not just distinct total duration);
 * - total duration stays under ~450ms so none of them reads as a stuck
 *   buzzer on a device with haptics on for every message;
 * - the two "good/neutral" outcomes (approval, finished) stay short and
 *   light; the two "needs attention" outcomes (error, blocked) run longer
 *   and heavier, and are told apart from each other by rhythm — error is
 *   three even, deliberate pulses; blocked is four quick, clipped pulses
 *   that read as a stutter rather than a single event.
 *
 * approval — one short, light pulse: a quiet "received".
 * finished — two short pulses: a distinct "done" cadence, still light.
 * error    — three firm, evenly-spaced pulses: heavier, demands attention.
 * blocked  — four quick, clipped pulses: a "stopped short" stutter, distinct
 *            from error's even rhythm even though both are multi-pulse.
 */
export const HAPTIC_PATTERNS: Readonly<Record<HapticTrigger, VibrationPattern>> = {
  approval: [0, 40],
  finished: [0, 30, 60, 30],
  error: [0, 80, 60, 80, 60, 80],
  blocked: [0, 20, 40, 20, 40, 20, 40, 20],
};

/** The port a caller vibrates through. See `./vibration-platform.ts` for the real Android adapter and `./fake-vibration-platform.ts` for the test double. */
export interface VibrationPlatform {
  vibrate(pattern: VibrationPattern): void;
}

export interface FireHapticRequest {
  trigger: HapticTrigger;
  /**
   * Whether haptics are enabled by the system/app setting, sourced by the
   * caller — this module never reads a global setting itself, the same way
   * `features/transcript/thinking-row.tsx` threads `useTheme().reduceMotion`
   * into `shouldAnimateShimmer` rather than reading `AccessibilityInfo`
   * inside the model.
   *
   * **The gate is by convention at the boundary, not structurally
   * unbypassable.** `fireHaptic` is the only *function* this module
   * exports that vibrates, but `createRNVibrationPlatform()`
   * (`./vibration-platform.ts`, re-exported from `./index.ts`) returns an
   * object with a public `vibrate(pattern)`, so a call site holding the
   * platform could call it directly and skip both this flag and
   * `visibleSignal`. Nothing in the repository does today (there is no
   * call site at all yet — see `./index.ts`'s "Nothing imports this yet"),
   * and every call site named there must go through `fireHaptic`. Whoever
   * mounts the first one owns keeping it that way; if direct `.vibrate`
   * calls ever appear, the honest fix is to stop handing the raw platform
   * to features and hand them a pre-bound `fireHaptic` instead.
   */
  hapticsEnabled: boolean;
  /**
   * Names the visible UI signal this haptic accompanies, e.g.
   * `"approval-banner"`, `"toast"`, `"error-banner"`. Required and
   * validated non-empty: a haptic must never be the only signal for a
   * state change (plan.md §9.3 pairs the approval haptic with visible
   * Approve/Deny actions), and this is the one thing this module can
   * actually enforce about that rule from inside its own grant — it
   * cannot see whether the named surface really renders. See this file's
   * top-level doc comment section "What this module cannot prove" in the
   * task report for which surfaces are responsible for rendering it.
   */
  visibleSignal: string;
}

export interface FireHapticResult {
  trigger: HapticTrigger;
  /** True if the platform was asked to vibrate; false when suppressed by `hapticsEnabled: false`. */
  fired: boolean;
}

/**
 * The single entry point a call site uses to fire one of the four §9.3
 * patterns. Every rule lives here so no call site can bypass it:
 *
 * - throws if `visibleSignal` is missing/blank (haptics never stand alone);
 * - returns `{ fired: false }` without touching `platform` at all when
 *   `hapticsEnabled` is false (the suppression gate);
 * - otherwise vibrates the pattern for `trigger` from `HAPTIC_PATTERNS` and
 *   returns `{ fired: true }`.
 */
export function fireHaptic(
  platform: VibrationPlatform,
  request: FireHapticRequest,
): FireHapticResult {
  if (!request.visibleSignal || request.visibleSignal.trim().length === 0) {
    throw new Error(
      `fireHaptic("${request.trigger}") requires a non-empty visibleSignal naming the visible ` +
        "cue it accompanies -- a haptic must never be the only signal for a state change " +
        "(plan.md §9.3).",
    );
  }

  if (!request.hapticsEnabled) {
    return { trigger: request.trigger, fired: false };
  }

  platform.vibrate(HAPTIC_PATTERNS[request.trigger]);
  return { trigger: request.trigger, fired: true };
}
