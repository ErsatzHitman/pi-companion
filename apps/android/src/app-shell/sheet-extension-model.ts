import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * `SessionSheetExtensions`'s (`app/h/[serverId]/session/[agentId]/
 * index.tsx`) filter (T32S12, P5-W18 — T37E5's finding at the P5-W17
 * merge gate).
 *
 * `features/extensions/pinned-model.ts`'s `selectPinnedElements` (owned
 * by a different task family, not this one) is the app's *only* live
 * selector over `PiUiElementStore`'s elements today, and it keeps
 * exactly `placement === "pinned"` — nothing else. `panel.tsx`'s own
 * renderer already knows how to present a `placement === "sheet"`
 * element (it opens the shared `Sheet` primitive — see that file's doc
 * comment), but nothing in production ever selects a sheet-placement
 * element to hand it, so that path was unreachable on any device: T37E5
 * found this exact gap while writing the roster/form/panel Maestro flow.
 *
 * This is the second, sibling selector `SessionSheetExtensions` needs —
 * deliberately not added to `pinned-model.ts` itself (out of this task's
 * `apps/android/src/app/` + `app-shell/` Owns grant; `features/
 * extensions/` is unowned this wave) and deliberately not folded into
 * `selectPinnedElements` (a `"pinned"` element and a `"sheet"` element
 * are never the same element — plan.md §11.3's placement table gives
 * each its own presentation, "pinned strip" vs. "sheet, inline card, or
 * screen").
 */
export function selectSheetPlacementElements(elements: readonly PiUiElement[]): PiUiElement[] {
  return elements.filter((element) => element.placement === "sheet");
}
