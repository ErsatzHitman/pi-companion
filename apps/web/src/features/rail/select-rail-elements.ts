import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * §11.5 placement rule for the web right extension rail:
 *
 * > `pinned` remains visible near the composer or in the web rail.
 *
 * `status` belongs in the session header/status strip, `inline` becomes a
 * transcript-adjacent card, and `sheet`/`screen` each own a focused panel or
 * route — none of those placements are this rail's concern. Only `pinned`
 * elements surface here, in the store's stable insertion order (plan.md
 * §11.4 "one renderer for every known kind" implies deterministic order;
 * `PiUiElementStore` already preserves it, this just narrows the set).
 *
 * This is a pure filter with no React/DOM dependency so it is trivially
 * unit-testable and reusable by both a live subscription and a static
 * fixture/snapshot render.
 */
export function selectRailElements(elements: readonly PiUiElement[]): PiUiElement[] {
  return elements.filter((element) => element.placement === "pinned");
}
