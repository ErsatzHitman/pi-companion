/**
 * Pure timing/shape constants for `voice-capture-indicator.tsx` (T276,
 * plan.md §9.2), split into their own RN-free module so this file's own
 * behavioural test (`./voice-capture-indicator-constants.test.ts`) can
 * assert real values directly, rather than the `.tsx` view being
 * provable only by source-text matching (the "RN-free `*-model.ts` with
 * real behavioural tests plus a thin `.tsx` view" split this
 * repository's `CLAUDE.md` calls out as the working pattern for
 * anything reachable from `react-native`).
 *
 * Every value below matches the reference artifact's `.eq`/
 * `@keyframes eq-bounce` and `.spin` rules exactly — see
 * `voice-capture-indicator.tsx`'s own header for the source and the
 * product reasoning; this file only carries the numbers.
 */

/** Five bars — `.eq` renders exactly five `<i>` children. */
export const EQ_BAR_COUNT = 5;

/**
 * Each bar's own `animation-delay`, in the artifact's own order — NOT a
 * uniform `index * 60ms` ramp. The artifact's `.eq i:nth-child(2)` is
 * 120ms, `:nth-child(3)` is 240ms, `:nth-child(4)` is 60ms, and
 * `:nth-child(5)` is 180ms, with the first bar undelayed; bar 4 starts
 * before bar 3 deliberately, per the artifact's own rules.
 */
export const EQ_BAR_DELAYS_MS: readonly number[] = [0, 120, 240, 60, 180];

/** `eq-bounce .8s ease-in-out infinite` — one full up-down cycle is 800ms, so each leg (min->max, max->min) is half that. */
export const EQ_BOUNCE_HALF_CYCLE_MS = 400;

/** `eq-bounce`'s `0%`/`100%` keyframe: `transform: scaleY(.35)`. */
export const EQ_MIN_SCALE = 0.35;

/** `eq-bounce`'s `50%` keyframe: `transform: scaleY(1)`. */
export const EQ_MAX_SCALE = 1;

/** CSS `ease-in-out`'s own cubic-bezier control points — not this app's custom "standard" motion curve, which is for other effects (press feedback, sheet transitions); the reference artifact names `ease-in-out` specifically for `eq-bounce`. */
export const EQ_EASE_IN_OUT_BEZIER: readonly [number, number, number, number] = [0.42, 0, 0.58, 1];

/** Beautiful UI's `.spin{animation:spin .7s linear infinite}` — the "processing" glyph's one full rotation. */
export const PROCESSING_SPIN_DURATION_MS = 700;
