/**
 * `widget` kind renderer (plan.md §11.3; T29A2) — "Persistent summary",
 * presented as a right-rail card. A widget payload carries free `text`,
 * pre-split `lines`, or labelled `rows`; exactly one of the three is
 * typically populated, so this renderer picks the richest one present.
 */
import { useMemo } from "react";
import type { Clock } from "@picompanion/frontend-core";
import type { PiUiWidgetPayload, PiUiWidgetRow } from "@picompanion/protocol/pi-ui-bridge/schema";

import { createBrowserClock } from "../../../platform/clock.js";
import { Card, Chip } from "../../../ui/primitives/index.js";
import type { PiUiElementRendererProps } from "../registry.js";
import { ElementActionsRow } from "./element-actions.js";
import { readStartedAt, useElapsedSince } from "./elapsed-time.js";
import { piUiToneToPrimitiveTone } from "./tone.js";
import "./renderers.css";

function rowLabel(row: PiUiWidgetRow, index: number): string {
  return row.label ?? row.id ?? `Row ${index + 1}`;
}

function WidgetRows({ rows }: { rows: readonly PiUiWidgetRow[] }) {
  return (
    <dl className="pc-pi-widget__rows">
      {rows.map((row, index) => (
        <div className="pc-pi-widget__row" key={row.id ?? index}>
          <dt className="pc-pi-widget__row-label">{rowLabel(row, index)}</dt>
          <dd className="pc-pi-widget__row-value">
            <span>{row.value ?? row.text ?? ""}</span>
            {row.tone ? (
              <Chip
                label={row.tone.charAt(0).toUpperCase() + row.tone.slice(1)}
                tone={piUiToneToPrimitiveTone(row.tone)}
              />
            ) : null}
            {row.detail ? <span className="pc-pi-widget__row-detail">{row.detail}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function WidgetBody({ payload }: { payload: PiUiWidgetPayload }) {
  if (payload.rows && payload.rows.length > 0) {
    return <WidgetRows rows={payload.rows} />;
  }
  if (payload.lines && payload.lines.length > 0) {
    return (
      <ul className="pc-pi-widget__lines">
        {payload.lines.map((line, index) => (
          // Lines have no stable identity on the wire; index is the best available key.
          <li key={index}>{line}</li>
        ))}
      </ul>
    );
  }
  if (payload.text) {
    return <p className="pc-pi-widget__text">{payload.text}</p>;
  }
  return <p className="pc-pi-widget__empty">No details provided.</p>;
}

export interface WidgetRendererProps extends PiUiElementRendererProps<"widget"> {
  /**
   * Overrides the default browser-backed clock (plan.md §7.3). Production
   * call sites (the renderer registry) never pass one, so this always
   * defaults to `createBrowserClock()`; a test supplies a controllable
   * fake instead of asserting against the wall clock.
   */
  clock?: Clock;
}

export function WidgetRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
  clock,
}: WidgetRendererProps) {
  const title = element.title ?? "Widget";
  const resolvedClock = useMemo(() => clock ?? createBrowserClock(), [clock]);
  const elapsedLabel = useElapsedSince(readStartedAt(payload), resolvedClock);
  return (
    <div data-testid={`pi-widget-${element.ns}-${element.id}`}>
      <Card className="pc-pi-widget">
        <h3 className="pc-pi-widget__title">{title}</h3>
        <WidgetBody payload={payload} />
        {elapsedLabel !== undefined ? (
          <p
            className="pc-pi-elapsed"
            data-testid={`pi-widget-elapsed-${element.ns}-${element.id}`}
          >
            {elapsedLabel}
          </p>
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
