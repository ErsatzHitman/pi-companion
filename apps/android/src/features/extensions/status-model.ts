/**
 * Pure decision behind the Android status strip (plan.md §9.2 "compact
 * status strip", §11.3's placement table — `status`'s Android presentation
 * is "compact status strip", §11.5 "`status` appears in the session
 * header/status strip"; T34A4's `pinned-model.ts` is the sibling decision).
 *
 * This is the third placement selector, alongside `pinned-model.ts`'s
 * `selectPinnedElements` and `inline-model.ts`'s `selectInlineElements`.
 * Until it existed, nothing in the app ever selected `placement ===
 * "status"`: the daemon synthesizes status-placement elements for
 * `workflow:progress` and `pi-goal:status`
 * (`packages/server/src/server/agent/providers/pi/ui-bridge/state.ts`),
 * the `minimal-status`/`prompt-arbitrage`/plan-mode extensions publish
 * them, and `selectPinnedElements` keeps only `pinned` — so every one sat
 * in the live store unrendered.
 *
 * RN-free, like `pinned-model.ts`, so it is directly unit testable in this
 * workspace (see `registry.test.ts`'s note on `react-native`'s
 * Flow-annotated source never entering a `vitest` graph).
 */
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * Only `status`-placement elements ever belong in the session status strip.
 * `pinned` is the area above the composer, `inline` is transcript-adjacent,
 * `sheet`/`screen` each own a focused panel or route — none of those
 * placements are this selector's concern. Store order is preserved as
 * arrival order.
 */
export function selectStatusElements(elements: readonly PiUiElement[]): PiUiElement[] {
  return elements.filter((element) => element.placement === "status");
}
