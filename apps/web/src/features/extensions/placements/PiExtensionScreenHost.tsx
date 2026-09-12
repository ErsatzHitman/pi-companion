import { extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { useMemo } from "react";

import { Section } from "../../../ui/primitives/index.js";
import { PiUiElementView } from "../registry-index.js";
// Side-effect import: registers every known kind's real component into the
// shared `piUiRendererRegistry` singleton `PiUiElementView` reads from — the
// same import `rail-element-card.tsx` makes for the same reason.
import "../renderers/index.js";
import { selectScreenElements } from "./select-placement-elements.js";
import "./placements.css";

const { piUiElementKeyOf } = extensions;

export interface PiExtensionScreenHostProps {
  /** One agent's live Pi UI elements, in any placement; the host filters. */
  elements: readonly PiUiElement[];
  /** The agent these elements belong to (plan.md §12.3 action identity). */
  agentId: string;
  /** Dispatches and tracks Pi UI actions for this agent (T21C). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for the dev-mode badge. */
  revision?: number;
}

/**
 * The web `screen`-placement destination (plan.md §11.5: "`screen` owns a
 * route").
 *
 * Rendered as the session's screen area — the session route
 * (`routes/screens/host-session-screen.tsx`) mounts it directly below the
 * session header — because a web route with no inbound navigation
 * affordance is unreachable, and `PiUiElement` carries no "open this
 * screen" action of its own (a `screen` element's actions are the owning
 * extension's, e.g. btw's `close`). The element's own `close`/`stop`
 * actions still dispatch through the normal round trip; the daemon removing
 * the element is what closes the region. This is the same adaptation the
 * plan's Android surface makes ("Focused extension panels open as bottom
 * sheets or full screens", plan.md §9.2) without inventing a second route
 * no extension can navigate to.
 *
 * Every surviving element renders through `PiUiElementView`, so a
 * screen-placement `panel` (e.g. btw's secondary conversation: a `status`,
 * a `markdown` thread, and a `form` composer) composes its sections through
 * the one shared registry. It renders nothing when no element is
 * `screen`-placed.
 */
export function PiExtensionScreenHost({
  elements,
  agentId,
  actionController,
  revision,
}: PiExtensionScreenHostProps) {
  const screens = useMemo(() => selectScreenElements(elements), [elements]);

  if (screens.length === 0) {
    return null;
  }

  return (
    <Section
      title="Screen"
      id="pi-extension-screen-host"
      className="pi-extension-screen-host"
      data-testid="pi-extension-screen-host"
    >
      <ul className="pi-extension-screen-host__list" data-testid="pi-extension-screen-host-list">
        {screens.map((element) => (
          <li key={piUiElementKeyOf(element)} className="pi-extension-screen-host__item">
            <div className="pi-extension-flow-block">
              <PiUiElementView
                element={element}
                agentId={agentId}
                actionController={actionController}
                revision={revision}
                testId={`pi-screen-${element.ns}-${element.id}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
