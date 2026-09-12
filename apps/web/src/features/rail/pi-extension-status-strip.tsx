import { extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Section } from "../../ui/primitives/index.js";
import { PiUiElementView } from "../extensions/registry-index.js";
// Side-effect import: registers every known kind's real component into the
// shared `piUiRendererRegistry` singleton `PiUiElementView` reads from — see
// `rail-element-card.tsx`'s identical import for the full rationale. A
// module's side-effect imports run once, so importing it here as well as
// there is not a second registration; it co-locates the dependency with the
// second real (non-test) consumer of `PiUiElementView` in this feature.
import "../extensions/renderers/index.js";
import { selectStatusElements } from "./select-status-elements.js";
import "./pi-extension-status-strip.css";

const { piUiElementKeyOf } = extensions;

export interface PiExtensionStatusStripProps {
  /**
   * One agent's live Pi UI elements, in any placement. This component does
   * its own §11.5 placement filtering (`selectStatusElements`), so callers
   * can pass an agent's full element set straight from `PiUiElementStore`
   * without pre-filtering — the same contract `PiExtensionRail` has.
   */
  elements: readonly PiUiElement[];
  /** The agent these elements belong to (plan.md §12.3 action identity). */
  agentId: string;
  /** Dispatches and tracks Pi UI actions for this agent (T21C `ExtensionActionController`). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for the dev-mode stale-state badge. */
  revision?: number;
}

/**
 * The web session status strip (plan.md §11.5, §11.3; T29R1's placement
 * rule). §11.5: "`status` appears in the session header/status strip", and
 * §11.3's table gives `status` the web presentation "header or right-rail
 * status". Until this component existed, no code path in `apps/web`
 * rendered a `status`-placement element at all: the rail's only placement
 * filter is `pinned` (`select-rail-elements.ts`), so every `status` element
 * the daemon synthesized (`workflow:progress`'s and `pi-goal:status`'s
 * status elements, the `minimal-status` footer, plan-mode's `!mode`, and
 * prompt-arbitrage's footer status) sat in the live store unread.
 *
 * Mounted beside `PiExtensionRail` in the extension rail column
 * (`routes/root-route.tsx`'s `ExtensionRailContent`), which is the "right-
 * rail status" half of §11.3's presentation. Each surviving element renders
 * through the same per-element pipeline every other placement uses
 * (`PiUiElementView`: canonical validation, the unknown-kind/oversized/
 * invalid-payload/ok decision, a per-element error boundary, the dev-mode
 * revision badge, and the dangerous-action confirmation gate) — this
 * component only selects which elements reach it and, like
 * `PinnedLiveExtensionArea` on Android, contributes nothing when none are
 * `status`.
 *
 * Live updates flow straight through: this component owns no element state,
 * so a caller subscribed to a live `PiUiElementStore`
 * (`usePiUiRailElements`) re-renders it on every published delta, exactly
 * as `PiExtensionRail` does.
 */
export function PiExtensionStatusStrip({
  elements,
  agentId,
  actionController,
  revision,
}: PiExtensionStatusStripProps) {
  const status = selectStatusElements(elements);

  if (status.length === 0) {
    return null;
  }

  return (
    <Section title="Status" id="pi-extension-status-strip" data-testid="pi-extension-status-strip">
      <ul className="pi-extension-status-strip__list" data-testid="pi-extension-status-strip-list">
        {status.map((element) => (
          <li key={piUiElementKeyOf(element)} className="pi-extension-status-strip__item">
            <PiUiElementView
              element={element}
              agentId={agentId}
              actionController={actionController}
              revision={revision}
              testId={`pi-status-strip-${element.ns}-${element.id}`}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}
