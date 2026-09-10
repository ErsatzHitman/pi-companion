/**
 * T346 — the composer slot's height bounds in `compact-shell.tsx`: a cap
 * that applies only while the pinned live-extension area is drawing, and
 * a floor that makes that cap safe.
 *
 * Why a cap exists at all. `extension-sheets` (Maestro run 34502151872,
 * shard-4) failed on `assertVisible id: pi-panel-loop-loop-sections` with
 * the keyboard closed. The hierarchy dump that run captured shows why,
 * and it is a space argument, not a rendering one: on a 1080x2400
 * emulator the shell had 2138px, of which the composer slot held 1106px
 * (its full natural height — a heading, a 584px controls `ScrollView`,
 * and a prompt bar whose input and send button stack into 341px), the
 * transcript was squeezed to nothing, and the pinned area was left 608px
 * for roughly 877px of content. `pi-panel-loop-loop` rendered and was
 * visible; its card was clipped at the pinned area's bottom edge, and
 * `panel.tsx`'s `${testId}-sections` `ScrollView` begins below that edge,
 * so it was pruned from the view hierarchy entirely rather than reported
 * as a zero-height node. Capping the composer hands those pixels to the
 * pinned area, which is what uncovers the sections node.
 *
 * Why a floor exists, and why the cap would be unsafe without it. The
 * same flow types into the composer and taps send while both cards are
 * still pinned, so that state also has to survive the keyboard. With the
 * IME up the shell loses roughly 775px (T343's evidence: 84px left for
 * the composer when the pinned slot could not shrink at all), both
 * shrinkable slots are squeezed, and the composer lands near the height
 * of the parts of it that never scroll. `resolveComposerMinHeight`
 * (`features/composer/composer-min-height-model.ts`) already measures
 * exactly those parts — heading, prompt bar, two gaps — but it is applied
 * to the composer's own root, one level INSIDE this slot, so the slot can
 * still be shrunk smaller than its child and leave the prompt bar drawn
 * under the keyboard. Lifting that measured height onto the slot as a
 * `minHeight` makes the pinned area give way first, and it is what makes
 * the cap above safe at any value: CSS and Yoga both resolve a `minHeight`
 * that exceeds a `maxHeight` in favour of the `minHeight`, so a cap can
 * never squeeze the prompt bar out, however short the window.
 *
 * Both halves are pure here and applied in `compact-shell.tsx`, the same
 * split `features/extensions/pinned-model.ts`'s
 * `resolvePinnedAreaMaxHeightDp` uses for the pinned area's own cap.
 */

/**
 * The composer slot's ceiling beside a drawing pinned area, in dp.
 *
 * 320dp is the upper bound; on a tall window the share below binds first.
 * Chosen against the measured geometry above rather than picked: it is
 * comfortably above the ~191dp the composer's unshrinkable parts occupy
 * on that emulator, so the prompt bar and a usable slice of the controls
 * `ScrollView` both survive the cap, while still freeing enough for the
 * pinned area to reach its own `resolvePinnedAreaMaxHeightDp` ceiling.
 */
export const COMPOSER_SLOT_MAX_HEIGHT_DP_BESIDE_PINNED = 320;

/**
 * The same ceiling as a share of the window, so a short window caps the
 * composer harder than a tall one instead of handing it a third of a
 * small screen. 0.32 is deliberately below the pinned area's own 0.45
 * share (`PINNED_AREA_MAX_WINDOW_SHARE`): when both want room, the pinned
 * area is the one being asserted against.
 */
export const COMPOSER_SLOT_MAX_WINDOW_SHARE_BESIDE_PINNED = 0.32;

export interface ComposerSlotCapInput {
  /** `useWindowDimensions().height`, in dp. */
  windowHeightDp: number;
  /**
   * Whether the pinned live-extension area is actually drawing content.
   * `compact-shell.tsx` cannot tell: its `liveExtension` prop is an
   * element on every render and returns `null` from inside when there is
   * nothing pinned, so this comes from the route, which holds the
   * elements and can ask `resolvePinnedAreaVisibility`.
   */
  liveExtensionOccupied: boolean;
}

export interface ComposerSlotFloorInput {
  /**
   * `resolveComposerMinHeight`'s measured height for the composer's own
   * content — the parts of it that never shrink. `0` until the composer
   * has reported a measurement.
   */
  contentMinHeight: number;
  /** The slot's own vertical padding, top and bottom summed. */
  verticalPadding: number;
}

/**
 * The composer slot's `maxHeight`, or `undefined` (no cap) whenever the
 * pinned area is not drawing — an idle session keeps today's layout
 * exactly, so no flow that drives the composer's controls with nothing
 * pinned can be affected by this.
 */
export function resolveComposerSlotMaxHeightDp(input: ComposerSlotCapInput): number | undefined {
  if (!input.liveExtensionOccupied) {
    return undefined;
  }
  if (!Number.isFinite(input.windowHeightDp) || input.windowHeightDp <= 0) {
    return COMPOSER_SLOT_MAX_HEIGHT_DP_BESIDE_PINNED;
  }
  return Math.min(
    COMPOSER_SLOT_MAX_HEIGHT_DP_BESIDE_PINNED,
    Math.round(input.windowHeightDp * COMPOSER_SLOT_MAX_WINDOW_SHARE_BESIDE_PINNED),
  );
}

/**
 * The composer slot's `minHeight`: the composer's own measured floor plus
 * the slot's padding, or `undefined` (no floor) until that measurement
 * exists. Never a guess — an unmeasured floor is no floor, the same rule
 * `resolveComposerMinHeight` itself follows.
 */
export function resolveComposerSlotMinHeight(input: ComposerSlotFloorInput): number | undefined {
  if (!Number.isFinite(input.contentMinHeight) || input.contentMinHeight <= 0) {
    return undefined;
  }
  const padding =
    Number.isFinite(input.verticalPadding) && input.verticalPadding > 0 ? input.verticalPadding : 0;
  return input.contentMinHeight + padding;
}
