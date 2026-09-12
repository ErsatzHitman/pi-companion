import { extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Section } from "../../../ui/primitives/index.js";
import { PiUiElementView } from "../registry-index.js";
// Side-effect import: registers every known kind's real component into the
// shared `piUiRendererRegistry` singleton `PiUiElementView` reads from — the
// same import `rail-element-card.tsx`/`pi-extension-status-strip.tsx` make
// for the same reason. Module side effects run once, so this is not a
// second registration.
import "../renderers/index.js";
import { selectInlineElements } from "./select-placement-elements.js";
import "./placements.css";

const { piUiElementKeyOf } = extensions;

export interface PiExtensionInlineStackProps {
  /**
   * One agent's live Pi UI elements, in any placement. This component does
   * its own §11.5 placement filtering (`selectInlineElements`), so callers
   * pass the full element set straight from the live store.
   */
  elements: readonly PiUiElement[];
  /** The agent these elements belong to (plan.md §12.3 action identity). */
  agentId: string;
  /** Dispatches and tracks Pi UI actions for this agent (T21C). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for the dev-mode badge. */
  revision?: number;
}

/**
 * The web `inline`-placement destination (plan.md §11.5: "`inline` becomes
 * a transcript-adjacent card").
 *
 * `apps/web`'s transcript deliberately excludes extension entries from its
 * own scroll (`features/transcript/transcript.tsx`'s `isRenderableEntry`
 * renders only message/thinking/tool-call/compaction rows), so this stack
 * is mounted *beside* the transcript in the session screen's composition,
 * immediately above the composer — the same slot the session's todo dock
 * occupies — rather than by editing that exclusion. Each surviving element
 * renders through the shared per-element pipeline `PiUiElementView` (the
 * unknown-kind/oversized/invalid-payload fallback, a per-element error
 * boundary, the dev-mode revision badge, and the dangerous-action
 * confirmation gate), so an inline card gets exactly the fidelity a pinned
 * rail card gets.
 *
 * Live updates flow straight through: this component owns no element
 * state, so a caller subscribed to a live `PiUiElementStore` re-renders it
 * on every published delta. It renders nothing at all when no element is
 * `inline`-placed.
 */
export function PiExtensionInlineStack({
  elements,
  agentId,
  actionController,
  revision,
}: PiExtensionInlineStackProps) {
  const inline = selectInlineElements(elements);

  if (inline.length === 0) {
    return null;
  }

  return (
    <Section
      title="Extensions"
      id="pi-extension-inline-stack"
      className="pi-extension-inline-stack"
      data-testid="pi-extension-inline-stack"
    >
      <ul className="pi-extension-inline-stack__list" data-testid="pi-extension-inline-stack-list">
        {inline.map((element) => (
          <li key={piUiElementKeyOf(element)} className="pi-extension-inline-stack__item">
            <div className="pi-extension-flow-block">
              <PiUiElementView
                element={element}
                agentId={agentId}
                actionController={actionController}
                revision={revision}
                testId={`pi-inline-${element.ns}-${element.id}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
