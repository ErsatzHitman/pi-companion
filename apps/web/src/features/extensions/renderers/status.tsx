/**
 * `status` kind renderer (plan.md §11.3; T29A2) — "Glanceable state",
 * presented as a header/rail status line.
 */
import { useMemo } from "react";
import type { Clock } from "@picompanion/frontend-core";

import { createBrowserClock } from "../../../platform/clock.js";
import { StatusIndicator } from "../../../ui/primitives/index.js";
import type { PiUiElementRendererProps } from "../registry.js";
import { ElementActionsRow } from "./element-actions.js";
import { humanizeNamespace, piUiToneToPrimitiveTone } from "./tone.js";
import { readStartedAt, useElapsedSince } from "./elapsed-time.js";
import "./renderers.css";

export interface StatusRendererProps extends PiUiElementRendererProps<"status"> {
  /**
   * Overrides the default browser-backed clock (plan.md §7.3). Production
   * call sites (the renderer registry) never pass one, so this always
   * defaults to `createBrowserClock()`; a test supplies a controllable
   * fake instead of asserting against the wall clock.
   */
  clock?: Clock;
}

export function StatusRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
  clock,
}: StatusRendererProps) {
  const label = humanizeNamespace(element.ns);
  const statusText = payload.text ?? element.title ?? "Status";
  const tone = piUiToneToPrimitiveTone(payload.tone);
  const resolvedClock = useMemo(() => clock ?? createBrowserClock(), [clock]);
  const elapsedLabel = useElapsedSince(readStartedAt(payload), resolvedClock);

  return (
    <div className="pc-pi-status" data-testid={`pi-status-${element.ns}-${element.id}`}>
      <StatusIndicator label={label} tone={tone} statusText={statusText} />
      {payload.detail ? <p className="pc-pi-status__detail">{payload.detail}</p> : null}
      {elapsedLabel !== undefined ? (
        <p className="pc-pi-elapsed" data-testid={`pi-status-elapsed-${element.ns}-${element.id}`}>
          {elapsedLabel}
        </p>
      ) : null}
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        ariaLabel={`${label} actions`}
      />
    </div>
  );
}
