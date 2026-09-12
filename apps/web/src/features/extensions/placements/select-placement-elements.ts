import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * The remaining §11.5 placement filters for web (plan.md §11.3, §11.5).
 *
 * `PiUiPlacementSchema` has five members and, until this module existed,
 * `apps/web` selected only two of them: `features/rail/select-rail-
 * elements.ts` kept `pinned` and `features/rail/select-status-elements.ts`
 * kept `status`. §11.5 gives the other three their own destinations —
 * "`inline` becomes a transcript-adjacent card", "`sheet` opens a focused
 * panel", "`screen` owns a route" — so an element with any of those three
 * placements reached no screen at all.
 *
 * These are the three sibling selectors, deliberately not folded into the
 * pinned or status filters and not into each other: §11.3's table gives
 * each placement its own presentation, and a single `PiUiElement` carries
 * exactly one placement, so the sets can never overlap. Each is a pure
 * filter (no React/DOM dependency), mirroring the two existing selectors,
 * and preserves the store's stable insertion order — arrival order on the
 * wire.
 */

/** Only `inline`-placement elements belong in the transcript-adjacent stack. */
export function selectInlineElements(elements: readonly PiUiElement[]): PiUiElement[] {
  return elements.filter((element) => element.placement === "inline");
}

/** Only `sheet`-placement elements belong in the sheet host. */
export function selectSheetElements(elements: readonly PiUiElement[]): PiUiElement[] {
  return elements.filter((element) => element.placement === "sheet");
}

/** Only `screen`-placement elements belong in the session screen area. */
export function selectScreenElements(elements: readonly PiUiElement[]): PiUiElement[] {
  return elements.filter((element) => element.placement === "screen");
}
