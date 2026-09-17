/**
 * Drag-to-cycle physics for the footer metadata pills (A-COMPOSER;
 * `spec-delta.md` §2 A-COMPOSER, A-MOTION's drag-to-cycle paragraph).
 * `FooterPills.tsx` draws the mode/model/effort pills and wires this
 * module's numbers to a `View`'s legacy Responder System handlers (this
 * app has no `react-native-gesture-handler` dependency, so the artifact's
 * `pointerdown`/`pointermove`/`pointerup` listeners become
 * `onStartShouldSetResponder`/`onResponderMove`/`onResponderRelease`
 * rather than a gesture-handler `Gesture.Pan()`); this module is the
 * RN-free half, proven by execution rather than by rendering.
 *
 * **The artifact's own physics, quoted rather than re-derived:**
 *
 * ```js
 * const SW_ARM=6, SW_COMMIT=26, SW_MAX=34;
 * const t=SW_MAX*Math.tanh(pdrag.dx/SW_MAX/1.15);
 * pdrag.el.classList.toggle('fp-ready',Math.abs(pdrag.dx)>=SW_COMMIT);
 * stepPill(el,kind,ft,dx<0?1:-1);
 * ```
 *
 * `rubberBandOffsetPx` is 1:1 with the finger near zero and asymptotes
 * toward `±SWIPE_MAX_PX` on a long drag — the pill answers the touch
 * without ever leaving its own row, so there is no clipping and no
 * layout shift no matter how far the finger travels. `SW_ARM` (6px) is
 * not modelled here: that threshold decides whether a touch is still a
 * TAP as far as the artifact's own pointer handler is concerned, which
 * is `FooterPills.tsx`'s `onStartShouldSetResponder` decision (a real
 * `GestureResponderEvent`), not a pure function of a single `dx` number.
 *
 * The direction convention is the artifact's own and reads backwards at
 * first: a NEGATIVE `dx` (a drag to the LEFT) steps the option list
 * FORWARD (`+1`). The artifact's own comment for why: `stepPill(el, kind,
 * ft, dx<0?1:-1)` — a leftward drag reveals the NEXT value sliding in
 * from the right, the same visual sense a horizontally-paged carousel
 * uses. `resolveSwipeDirection` keeps that exact mapping so a port bug
 * cannot quietly reverse it.
 */

/** `SW_ARM` — below this, a touch is still a tap; `FooterPills.tsx`'s own decision, not this module's. */
export const SWIPE_ARM_PX = 6;
/** `SW_COMMIT` — at or beyond this, releasing cycles the pill's value. */
export const SWIPE_COMMIT_PX = 26;
/** `SW_MAX` — the asymptote `rubberBandOffsetPx` approaches but never reaches. */
export const SWIPE_MAX_PX = 34;

/**
 * `SW_MAX*Math.tanh(dx/SW_MAX/1.15)` — the artifact's own rubber-band
 * curve. `1.15` is the artifact's own divisor (not derived from the other
 * two constants); it softens the approach to the asymptote so a
 * `SWIPE_COMMIT_PX` drag is still visibly short of the `SWIPE_MAX_PX`
 * ceiling rather than already pinned against it.
 */
export function rubberBandOffsetPx(dx: number): number {
  return SWIPE_MAX_PX * Math.tanh(dx / SWIPE_MAX_PX / 1.15);
}

/** Whether a drag has travelled far enough to commit a value change on release. */
export function isSwipeReady(dx: number): boolean {
  return Math.abs(dx) >= SWIPE_COMMIT_PX;
}

/** `-1` (previous option), `0` (releases below the commit threshold — no change), or `1` (next option). */
export type SwipeStep = -1 | 0 | 1;

/** `dx<0?1:-1` guarded by the commit threshold — see this module's own doc comment for the direction convention. */
export function resolveSwipeStep(dx: number): SwipeStep {
  if (!isSwipeReady(dx)) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * One step around a pill's own option list, wrapping at both ends —
 * the artifact's `(i+dir+opts.length)%opts.length`. `currentIndex` past
 * either end of `length` (a caller's stale index) is treated as `0`
 * rather than producing a negative or out-of-range result.
 */
export function cyclePillIndex(length: number, currentIndex: number, step: SwipeStep): number {
  if (length <= 0) return 0;
  const from = currentIndex >= 0 && currentIndex < length ? currentIndex : 0;
  return (from + step + length) % length;
}

/**
 * `cyclePillIndex` for a pill whose options are option IDs rather than a
 * bare length/index — what `FooterPills.tsx` actually has in hand for
 * mode/model/effort (`SessionControlsState.modes`,
 * `ModelThinkingState.models`, the selected model's own reachable
 * `thinkingOptions`). `null` means "no change": either `step` was `0`
 * (release under the commit threshold), or `ids` is empty (nothing to
 * cycle to — the artifact's own `stepPill` never runs against an empty
 * option list either, since `PILL_OPTS` always derives from real
 * provider data).
 */
export function cycleOptionId(
  ids: readonly string[],
  currentId: string | null | undefined,
  step: SwipeStep,
): string | null {
  if (step === 0 || ids.length === 0) return null;
  const currentIndex = currentId ? ids.indexOf(currentId) : -1;
  return ids[cyclePillIndex(ids.length, currentIndex, step)] ?? null;
}
