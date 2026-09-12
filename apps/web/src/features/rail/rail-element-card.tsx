import type { extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Card, CodeBlock } from "../../ui/primitives/index.js";
import { PiUiElementView } from "../extensions/registry-index.js";
// Side-effect import: registers every known kind's real component
// (`status`, `widget`, `panel`, `progress`, `roster`, `log`, `markdown`,
// `diff`, `form`, `composer` — T29A1-T29B4) into the shared
// `piUiRendererRegistry` singleton `registry-view.tsx`'s `PiUiElementView`
// reads from. Each renderer test file imports it itself, per that module's
// own header comment ("individual renderer modules never register
// themselves at their own definition site" so a test can import one renderer
// directly without double-registering it); this card and the sibling
// placement hosts (`features/extensions/placements/`) import it in the
// running app so the registrations are on before any element renders.
// Importing it from more than one host costs nothing: a module's side
// effects run once.
import "../extensions/renderers/index.js";
import "./pi-extension-rail.css";

export interface RailElementCardProps {
  element: PiUiElement;
  /** The agent this element belongs to — required to target a dispatched action (plan.md §12.3). */
  agentId: string;
  /** Dispatches and tracks this element's actions (T21C `ExtensionActionController`). */
  actionController: extensions.ExtensionActionController;
  /** This agent's current known Pi UI Bridge revision, for the dev-mode stale-state badge. */
  revision?: number;
}

/** Upper bound on the raw-payload disclosure so one runaway element cannot balloon the rail's DOM. */
const RAW_PAYLOAD_CHAR_LIMIT = 4000;

/**
 * One pinned Pi UI element, rendered at full per-kind fidelity (plan.md
 * §11.3-§11.4, §8.3; T29R2).
 *
 * T29R1 shipped this card as a generic, kind-agnostic fallback (title, kind
 * badge, one-line summary) because the per-kind renderer registry
 * (T29A1-T29B4, `features/extensions/`) did not exist yet. It now does —
 * every one of the ten frozen kinds has a real, tested component — so this
 * card delegates the entire "what does this element actually look like"
 * question to that registry's own entry point, `PiUiElementView`, which
 * already *is* plan.md §11.4's full pipeline for one element (payload
 * validation, the registered kind's real component, a per-element error
 * boundary, an unknown-kind/invalid-payload diagnostic, and a dev-mode
 * revision badge) rather than a second, parallel copy of that logic here.
 *
 * This is what actually gives fleet (`subagents` → `roster`), workflow
 * (`workflow(s)` → `progress`/`roster`/`panel`/`log`), loop (`loop` →
 * `panel` composing `status`/`markdown`/`roster`/`progress`/`log`), and
 * goal (`pi-goal` → `status`) their full documented shape in the rail
 * (plan.md §11.7's extension table; the "published channels" the same
 * section names — `subagents:fleet`, `workflow:progress`, `pi-goal:status`
 * — are a daemon-side concern, already decoded into these `PiUiElement`s
 * before they ever reach this component) instead of a lossy one-line
 * summary. The raw-payload disclosure below is the one piece of the old
 * fallback still worth keeping alongside full-fidelity rendering: cheap,
 * always-safe, keyboard-reachable support/debug detail that costs nothing
 * once boxed behind a native `<details>`.
 */
export function RailElementCard({
  element,
  agentId,
  actionController,
  revision,
}: RailElementCardProps) {
  const testId = `pi-rail-element-${element.ns}-${element.id}`;
  const rawPayload = JSON.stringify(element, null, 2);
  const rawPayloadDisplay =
    rawPayload.length > RAW_PAYLOAD_CHAR_LIMIT
      ? `${rawPayload.slice(0, RAW_PAYLOAD_CHAR_LIMIT)}\n… (truncated)`
      : rawPayload;

  return (
    <Card className="pi-extension-rail__card" data-testid={testId}>
      <PiUiElementView
        element={element}
        agentId={agentId}
        actionController={actionController}
        revision={revision}
        testId={`${testId}-view`}
      />
      <details className="pi-extension-rail__details">
        <summary>Raw payload</summary>
        <CodeBlock code={rawPayloadDisplay} language="json" testId={`${testId}-raw`} />
      </details>
    </Card>
  );
}
