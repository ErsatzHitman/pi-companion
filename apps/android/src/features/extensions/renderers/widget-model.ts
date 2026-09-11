/**
 * `widget` kind render model (plan.md §11.3; T34A2) — "Persistent summary".
 *
 * A widget payload carries free `text`, pre-split `lines`, or labelled
 * `rows`; typically exactly one of the three is populated, so the richest
 * one present wins — `rows`, then `lines`, then `text`, then an explicit
 * "nothing was provided" line rather than an empty card. That is the web
 * renderer's exact precedence
 * (`apps/web/src/features/extensions/renderers/widget.tsx`), reproduced
 * here as data so `widget.tsx` only has to map it onto §10.3 primitives.
 *
 * Kept free of any React Native import so it is unit testable in this
 * workspace (see `status-model.ts`'s note and `../registry.test.ts`).
 *
 * Each row also carries the single accessible name TalkBack should read for
 * it. On the web the `<dt>`/`<dd>` pair already binds a row's label to its
 * value; React Native has no such association, and a row rendered as three
 * sibling `Text` nodes would be swiped through as three unrelated
 * fragments, so a row is one `accessible` group whose label folds label,
 * value, tone, and detail into one utterance.
 */
import type { PiUiElement, PiUiWidgetRow } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiPayloadForKind } from "../registry";
import { piUiToneToPrimitiveTone, toneChipLabel, type PiPrimitiveTone } from "./tone";

/** Shown when a widget payload carries no rows, lines, or text at all. */
export const WIDGET_EMPTY_TEXT = "No details provided.";

export interface PiUiWidgetRowModel {
  /** Stable list key: the row's own id when it has one, else its index. */
  key: string;
  label: string;
  /** May be empty when a row carries neither `value` nor `text`. */
  value: string;
  detail: string | undefined;
  /** Visible tone chip label (`"Success"`), so tone is never colour alone. */
  toneChipLabel: string | undefined;
  tone: PiPrimitiveTone | undefined;
  /** One utterance for the whole row. */
  accessibilityLabel: string;
}

export type PiUiWidgetBodyModel =
  | { type: "rows"; rows: PiUiWidgetRowModel[] }
  | { type: "lines"; lines: readonly string[] }
  | { type: "text"; text: string }
  | { type: "empty"; text: string };

export interface PiUiWidgetRenderModel {
  title: string;
  body: PiUiWidgetBodyModel;
  actionsAccessibilityLabel: string;
}

/** `label` -> `id` -> positional fallback, matching the web renderer's `rowLabel`. */
function rowLabel(row: PiUiWidgetRow, index: number): string {
  return row.label ?? row.id ?? `Row ${index + 1}`;
}

function buildRowModel(row: PiUiWidgetRow, index: number): PiUiWidgetRowModel {
  const label = rowLabel(row, index);
  const value = row.value ?? row.text ?? "";
  const chipLabel = row.tone ? toneChipLabel(row.tone) : undefined;
  const spoken = [value ? `${label}: ${value}` : label, chipLabel, row.detail].filter(
    (part): part is string => Boolean(part),
  );
  return {
    key: row.id ?? String(index),
    label,
    value,
    detail: row.detail,
    toneChipLabel: chipLabel,
    tone: row.tone ? piUiToneToPrimitiveTone(row.tone) : undefined,
    accessibilityLabel: spoken.join(", "),
  };
}

function buildBodyModel(payload: PiUiPayloadForKind<"widget">): PiUiWidgetBodyModel {
  if (payload.rows && payload.rows.length > 0) {
    return { type: "rows", rows: payload.rows.map(buildRowModel) };
  }
  if (payload.lines && payload.lines.length > 0) {
    return { type: "lines", lines: payload.lines };
  }
  if (payload.text) {
    return { type: "text", text: payload.text };
  }
  return { type: "empty", text: WIDGET_EMPTY_TEXT };
}

/**
 * The longest label in a rows body — the column every row's label pads to
 * (`padWidgetRowLabel`), so a block's values line up on one mono column.
 */
export function widgetRowLabelColumnLength(rows: readonly PiUiWidgetRowModel[]): number {
  return rows.reduce((longest, row) => Math.max(longest, row.label.length), 0);
}

/**
 * Pads a row label with spaces to the block's label column. The renderer
 * draws labels in the mono face, so the padding is real alignment, exactly
 * like the artifact's `reason   completed · 9 turns · 71k`.
 */
export function padWidgetRowLabel(label: string, columnLength: number): string {
  return label.padEnd(columnLength, " ");
}

export function buildWidgetRenderModel(
  element: Pick<PiUiElement, "title">,
  payload: PiUiPayloadForKind<"widget">,
): PiUiWidgetRenderModel {
  const title = element.title ?? "Widget";
  return {
    title,
    body: buildBodyModel(payload),
    actionsAccessibilityLabel: `${title} actions`,
  };
}
