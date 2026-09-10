/**
 * Pure decisions behind the Android pinned live-extension area (plan.md
 * §9.2 "pinned live extension area above the composer", §11.5 "`pinned`
 * remains visible near the composer or in the web rail"; T34A4).
 *
 * `pinned-live-extension-area.tsx` is a thin React Native view over this
 * module, for the same reason every other renderer in this directory keeps
 * its decisions RN-free: this workspace's `vitest` cannot parse
 * `react-native`'s Flow-annotated source (see `registry.test.ts`'s doc
 * comment), so anything worth unit-testing has to live somewhere that
 * import never reaches.
 *
 * This module owns two decisions:
 *
 * 1. **which elements belong in the area at all** — `selectPinnedElements`,
 *    the Android counterpart of the web rail's `selectRailElements`
 *    (`apps/web/src/features/rail/select-rail-elements.ts`): only
 *    `placement: "pinned"` elements, in stable store order;
 * 2. **whether the area collapses** — `resolvePinnedAreaVisibility`. "Empty"
 *    means *no pinned element exists*, not "no pinned element rendered
 *    successfully". A pinned element with an unrecognized kind, a payload
 *    that failed validation, or no renderer registered yet still renders —
 *    as one `ExtensionDiagnostic` via `registry-view.tsx`'s existing
 *    pipeline — so the area must stay visible for it. Collapsing on
 *    anything other than a truly empty pinned set would silently hide a
 *    diagnostic the user needs to see.
 *
 * It also declares, as plain data, the layout contract the component
 * builds to: bounded height, its own internal scroll, and no overlay of
 * either the composer or the keyboard. This is the one thing about
 * "never covers the composer or the IME" that a `vitest` run — with no
 * real layout engine, no emulator, no IME — can actually prove: that the
 * component *declares* a bounded, non-overlaying contract, not that a real
 * device *honors* it. See `pinned-live-extension-area.tsx`'s doc comment
 * for what remains for T37 (Maestro) and T59 (real device) to prove.
 */
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * Only `pinned`-placement elements ever belong in this area (plan.md
 * §11.5). `status` belongs in the header/status strip, `inline` becomes a
 * transcript-adjacent card, `sheet`/`screen` each own a focused panel or
 * route — none of those placements are this area's concern.
 */
export function selectPinnedElements(elements: readonly PiUiElement[]): PiUiElement[] {
  return elements.filter((element) => element.placement === "pinned");
}

export type PinnedAreaVisibility = "collapsed" | "visible";

/**
 * "Collapses only when genuinely empty": collapsed exactly when the
 * `pinned`-placement subset is empty, regardless of whether any element in
 * that subset would go on to render as a full kind view or as a
 * diagnostic. A pinned element that is present but unrenderable is still
 * present — it must keep the area visible so its diagnostic shows.
 */
export function resolvePinnedAreaVisibility(
  elements: readonly PiUiElement[],
): PinnedAreaVisibility {
  return selectPinnedElements(elements).length > 0 ? "visible" : "collapsed";
}

/** The layout contract `pinned-live-extension-area.tsx` builds to. */
export interface PinnedAreaLayoutContract {
  /** The area never grows past this height; it scrolls internally instead. */
  maxHeightDp: number;
  /** ...nor past this share of the window's height, whichever is smaller (T342). */
  maxWindowShare: number;
  /** The area's content scrolls within its own bounded region. */
  scrolls: true;
  /** The area sits in normal document flow above the composer, never over it. */
  overlaysComposer: false;
  /** The area is not a Modal/overlay, so it never competes for IME ownership. */
  overlaysKeyboard: false;
}

/**
 * The absolute bounded-height cap the pinned area's `ScrollView` enforces,
 * the same shape as `LogRenderer`'s own `LOG_SCROLL_MAX_HEIGHT` precedent
 * (`renderers/log.tsx`): a pinned element nested inside this area is
 * capped at both levels. (CORRECTED at T342: this said the two were
 * "capped consistently", but this was 240 against the log renderer's 320,
 * and 240dp was too short for the two cards the `extension-sheets` flow
 * pins at once — Maestro run 34485299369 laid out a one-row roster card
 * at 172dp and the loop panel's title just below it, with the panel's
 * sections clipped past the cap; the flow's `pi-panel-loop-loop-sections`
 * assertion could only ever pass by scrolling a strip a user would not
 * know scrolls. The cap is now 360dp, bounded further by
 * `resolvePinnedAreaMaxHeightDp` to `PINNED_AREA_MAX_WINDOW_SHARE` of the
 * window so a short phone still keeps transcript and composer room.)
 */
export const PINNED_AREA_MAX_HEIGHT_DP = 360;

/** The pinned area never takes more than this share of the window's height (T342). */
export const PINNED_AREA_MAX_WINDOW_SHARE = 0.45;

/**
 * T342: the cap the area actually applies for a window `windowHeightDp`
 * tall — `PINNED_AREA_MAX_HEIGHT_DP`, or `PINNED_AREA_MAX_WINDOW_SHARE` of
 * the window, whichever is smaller. A non-finite or non-positive height
 * (nothing measured yet) falls back to the absolute cap alone.
 */
export function resolvePinnedAreaMaxHeightDp(windowHeightDp: number): number {
  if (!Number.isFinite(windowHeightDp) || windowHeightDp <= 0) {
    return PINNED_AREA_MAX_HEIGHT_DP;
  }
  return Math.min(
    PINNED_AREA_MAX_HEIGHT_DP,
    Math.round(windowHeightDp * PINNED_AREA_MAX_WINDOW_SHARE),
  );
}

export const PINNED_AREA_LAYOUT_CONTRACT: PinnedAreaLayoutContract = {
  maxHeightDp: PINNED_AREA_MAX_HEIGHT_DP,
  maxWindowShare: PINNED_AREA_MAX_WINDOW_SHARE,
  scrolls: true,
  overlaysComposer: false,
  overlaysKeyboard: false,
};
