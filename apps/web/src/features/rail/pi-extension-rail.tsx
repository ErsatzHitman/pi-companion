import { extensions } from "@picompanion/frontend-core";
import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { EmptyState, Section } from "../../ui/primitives/index.js";
import { ContextMeter } from "./context-meter.js";
import { RailElementCard } from "./rail-element-card.js";
import { selectRailElements } from "./select-rail-elements.js";
import "./pi-extension-rail.css";

const { piUiElementKeyOf } = extensions;

export interface PiExtensionRailProps {
  /**
   * One agent's live Pi UI elements, in any placement. This component does
   * its own §11.5 placement filtering (`selectRailElements`), so callers can
   * pass an agent's full element set straight from `PiUiElementStore` without
   * pre-filtering.
   */
  elements: readonly PiUiElement[];
  /** The agent these elements belong to (plan.md §12.3 action identity). */
  agentId: string;
  /** Dispatches and tracks Pi UI actions for this agent (T21C `ExtensionActionController`). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for the dev-mode stale-state badge. */
  revision?: number;
  /**
   * The agent's latest derived context-window/cache-hit snapshot (T29C1).
   * Optional so every existing caller/test that only ever passed `elements`
   * keeps working unchanged; when present, renders `ContextMeter` above the
   * pinned element list regardless of whether that list is empty — context/
   * cache usage is live agent state, not an extension element (T29C2).
   */
  telemetry?: coreTelemetry.ContextWindowTelemetry;
}

/**
 * The web right extension rail's content (plan.md §8.3, §11.5; T29R1, T29R2).
 *
 * Mounts into `Shell`'s `extensionRail` slot (`ui/shell.tsx`, owned by
 * T27S1 and not edited here). The rules this component is responsible for:
 *
 * - only `pinned`-placement elements ever appear here (`selectRailElements`);
 * - every pinned element renders in full, every time, at full per-kind
 *   fidelity (`RailElementCard` → `PiUiElementView`, T29R2) — plan.md §8.3:
 *   "A running subagent fleet, workflow, loop, or goal remains visible in
 *   the right rail. It does not disappear into a collapsed status chip."
 *   There is deliberately no summarizing/collapsing behavior in this
 *   component: one element in, one full card out, for as long as the
 *   element is live. This is what plan.md §11.7's documented shapes for
 *   `subagents` (fleet, `roster`), `workflow(s)` (`progress`/`roster`/
 *   `panel`/`log`), `loop` (`panel`), and `pi-goal` (`status`) actually look
 *   like once rendered — none of the four collapses into any other, because
 *   each arrives as its own `PiUiElement` and gets its own `<li>`/card;
 * - live updates flow straight through: this component owns no element
 *   state of its own, so a caller subscribed to a live `PiUiElementStore`
 *   (`usePiUiRailElements`, T29R1) re-renders this list on every published
 *   delta — fleet/workflow/loop/goal content is exactly as live as the
 *   store it is read from, never a one-time snapshot.
 *
 * `T29C2` (context/cache meter) lands here too: the optional `telemetry`
 * prop renders `ContextMeter` above the pinned element list, independent of
 * whether that list itself is empty, since context/cache usage is live agent
 * state rather than a pinned Pi UI element.
 */
export function PiExtensionRail({
  elements,
  agentId,
  actionController,
  revision,
  telemetry,
}: PiExtensionRailProps) {
  const pinned = selectRailElements(elements);

  return (
    <>
      {telemetry ? <ContextMeter telemetry={telemetry} /> : null}
      {pinned.length === 0 ? (
        <EmptyState
          title="No live extensions"
          description="Fleet, workflow, loop, and goal activity appear here while a session runs."
          testId="pi-extension-rail-empty"
        />
      ) : (
        <Section title="Live extensions" id="pi-extension-rail">
          <ul className="pi-extension-rail__list" data-testid="pi-extension-rail-list">
            {pinned.map((element) => (
              <li key={piUiElementKeyOf(element)} className="pi-extension-rail__item">
                <RailElementCard
                  element={element}
                  agentId={agentId}
                  actionController={actionController}
                  revision={revision}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
