/**
 * Pure decision behind the Android inline extension elements (plan.md
 * §11.3's placement table: an `inline` element is "transcript-adjacent",
 * §11.5's `pinned` strip is a separate presentation).
 *
 * The reference artifact draws each of E2/E3/E4 as "an extension block in
 * the transcript, purple-tinted so a report from a policy is never
 * mistaken for the model's own reply" (`docs/ui-reference/
 * pi-companion-app.html`). Until this module existed, nothing in the app
 * ever selected `placement === "inline"`: `pinned-model.ts` keeps only
 * `pinned`, `app-shell/sheet-extension-model.ts` keeps only `sheet`, so an
 * inline element rendered nowhere at all. This is the third sibling
 * selector, deliberately not folded into either of the other two — plan.md
 * §11.3 gives each placement its own presentation.
 *
 * The session route renders the result INSIDE the transcript's own
 * scrollable content (`transcript-window.tsx`'s `footer` slot), after the
 * windowed rows and in store order — arrival order on the wire. They are
 * flow content that scrolls with the transcript, unlike the pinned area
 * (`pinned-live-extension-area.tsx`), which is its own bounded, internally
 * scrolling region above the composer.
 *
 * RN-free, like `pinned-model.ts`, so it is directly unit testable in this
 * workspace (see `registry.test.ts`'s note on `react-native`'s
 * Flow-annotated source never entering a `vitest` graph).
 */
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * Only `inline`-placement elements ever belong in the transcript's
 * trailing extension stack. `pinned` is the area above the composer,
 * `sheet`/`screen` each own a focused panel or route, `status` belongs in
 * the header/status strip — none of those placements are this selector's
 * concern. Store order is preserved as arrival order.
 */
export function selectInlineElements(elements: readonly PiUiElement[]): PiUiElement[] {
  return elements.filter((element) => element.placement === "inline");
}
