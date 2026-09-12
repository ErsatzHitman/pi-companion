/**
 * `composer` kind renderer (plan.md §11.3; T29A3) — "Replace or prefill
 * draft", presented as a proposed-draft preview card. Example: the
 * `prompt-arbitrage` extension rewriting the composer draft (plan.md §11.7).
 *
 * This renders the proposal — mode, proposed text, and (when supplied) what
 * it would replace — plus the element's own accept/undo actions through the
 * shared action row. Actually applying the accepted text to the live
 * message-composer input, and the "composer update with undo" round trip
 * that implies, is not this renderer's concern: the route-chrome
 * subscribes to these actions' settlement through
 * `features/composer`'s `createPiUiComposerDraftSource` (wired in
 * `routes/screens/host-session-screen.tsx`) and fills/restores the live
 * draft there. The element's `accept`/`undo` actions still dispatch
 * normally through `dispatchAction`.
 */
import type { PiUiComposerPayload } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Card, Chip } from "../../../ui/primitives/index.js";
import type { PiUiElementRendererProps } from "../registry.js";
import { ElementActionsRow } from "./element-actions.js";
import "./renderers.css";

const MODE_LABEL: Record<NonNullable<PiUiComposerPayload["mode"]>, string> = {
  replace: "Replace draft",
  prefill: "Prefill draft",
  append: "Append to draft",
};

export function ComposerRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"composer">) {
  const title = element.title ?? "Composer suggestion";
  const modeLabel = MODE_LABEL[payload.mode ?? "replace"];

  return (
    <div data-testid={`pi-composer-${element.ns}-${element.id}`}>
      <Card className="pc-pi-composer">
        <div className="pc-pi-composer__header">
          <h3 className="pc-pi-composer__title">{title}</h3>
          <Chip label={modeLabel} tone="info" />
        </div>
        <p className="pc-pi-composer__proposed">{payload.text}</p>
        {payload.previousText !== undefined ? (
          <details className="pc-pi-composer__previous">
            <summary>Current draft</summary>
            <p>{payload.previousText || "(empty)"}</p>
          </details>
        ) : null}
        <ElementActionsRow
          actions={element.actions}
          dispatchAction={dispatchAction}
          getActionState={getActionState}
          ariaLabel={`${title} actions`}
        />
      </Card>
    </div>
  );
}
