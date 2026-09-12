import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * §11.5 placement rule for the web session status strip:
 *
 * > `status` appears in the session header/status strip.
 *
 * §11.3's table gives `status` ("Glanceable state") the web presentation
 * "header or right-rail status" and Android's the "compact status strip".
 * `pinned` belongs in the right rail, `inline` becomes a transcript-
 * adjacent card, and `sheet`/`screen` each own a focused panel or route —
 * none of those placements are this strip's concern. Only `status`
 * elements surface here, in the store's stable insertion order
 * (`PiUiElementStore` preserves it; this narrows the set the same way
 * `selectRailElements` does for `pinned`).
 *
 * This is a pure filter with no React/DOM dependency, mirroring
 * `select-rail-elements.ts`.
 */
export function selectStatusElements(elements: readonly PiUiElement[]): PiUiElement[] {
  return elements.filter((element) => element.placement === "status");
}
