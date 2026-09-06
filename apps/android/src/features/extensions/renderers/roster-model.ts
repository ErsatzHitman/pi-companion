/**
 * `roster` kind render model (plan.md §11.3, §11.7; T34B1) — "Agents,
 * roles, keys, or tasks with per-row actions", the shape the `subagents`
 * extension uses for its fleet (`docs/pi-extension-compatibility.md`'s
 * `subagents` line) and `switchboard` uses for its key list (same doc's
 * `switchboard` line).
 *
 * Two real extensions, two row shapes, one wire schema
 * (`PiUiRosterRowSchema`, `.passthrough()`):
 *
 * - `subagents:fleet` rows carry `{id, label, state, model, elapsedSec}`,
 *   plus a payload-level `active` flag and `selected` row id. `state`,
 *   `detail`, `progress`, and `actions` are the schema's own typed fields;
 *   `model` and `elapsedSec` are extension-specific extras that ride
 *   through passthrough on each row, and `active`/`selected` ride through
 *   passthrough on the payload itself.
 * - `switchboard`'s `keys` roster rows carry only `{id, label, detail}` —
 *   no `state`, no `model`, no `elapsedSec`, no payload-level `active`/
 *   `selected`. Every field this model reads is therefore optional and
 *   degrades to "not shown" rather than a placeholder, so a switchboard
 *   row renders as cleanly as a fleet row.
 *
 * Row actions (plan.md §4.2/§12.3): a roster row's actions dispatch
 * against the composite `${element.id}#${row.id}` element id, never the
 * bare element id — `buildRosterRowActionsModel` below composes that id
 * once so `roster.tsx` never has to. Per-action pending/feedback state
 * reuses `element-actions-model.ts`'s `buildElementActionModels` exactly,
 * just bound to the row's own composite id via `getActionState`'s optional
 * second argument — the same model that already proves "disabled while
 * pending, then a settled outcome" for every other kind's element-level
 * actions proves it here per row.
 *
 * "Stays pinned while active" (T34B1's second criterion) is a predicate on
 * this payload, not a layout claim: `resolveRosterActive` below is `true`
 * while any row is `running` or `blocked` (in-flight work, per plan.md
 * §11.7's "running/blocked/done" tri-state), or when the payload carries
 * an explicit boolean `active` extra (the raw `subagents:fleet` channel
 * fixture's own `active` flag, when a helper forwards it through). *Where*
 * the pinned area lives, and whether it actually stays mounted while this
 * is `true`, is `pinned-model.ts`'s concern (T34A4/T34A5) — this module
 * only computes the predicate so that decision (or a future one) has real
 * data to act on.
 *
 * Kept free of any React Native import so it is unit testable in this
 * workspace (see `status-model.ts`'s note and `../registry.test.ts`).
 */
import type {
  PiUiElement,
  PiUiRosterRow,
  PiUiRosterRowState,
} from "@picompanion/protocol/pi-ui-bridge/schema";

import type { extensions } from "@picompanion/frontend-core";

import type { PiUiPayloadForKind } from "../registry";
import { buildElementActionModels, type PiUiActionButtonModel } from "./element-actions-model";
import type { PiUiAnnouncedText } from "./status-model";
import { humanizeNamespace, type PiPrimitiveTone } from "./tone";

/** Row states that count as "in-flight" for `resolveRosterActive`. */
const ACTIVE_ROW_STATES: ReadonlySet<PiUiRosterRowState> = new Set(["running", "blocked"]);

const ROW_STATE_LABEL: Record<PiUiRosterRowState, string> = {
  idle: "Idle",
  running: "Running",
  blocked: "Blocked",
  done: "Done",
  error: "Error",
};

/** Same wire tone vocabulary every other kind uses (`tone.ts`), keyed by roster row state instead. */
const ROW_STATE_TONE: Record<PiUiRosterRowState, PiPrimitiveTone> = {
  idle: "neutral",
  running: "info",
  blocked: "warning",
  done: "success",
  error: "danger",
};

/** Reads an untyped passthrough extra off a roster row or payload, tolerating any shape. */
function extra(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

function extraString(source: unknown, key: string): string | undefined {
  const value = extra(source, key);
  return typeof value === "string" ? value : undefined;
}

function extraNumber(source: unknown, key: string): number | undefined {
  const value = extra(source, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extraBoolean(source: unknown, key: string): boolean | undefined {
  const value = extra(source, key);
  return typeof value === "boolean" ? value : undefined;
}

/**
 * `"42s"` / `"1m 5s"`, mirroring the transcript feature's
 * `formatElapsedDuration` format (`features/transcript/thinking-row-model.ts`)
 * but taking whole seconds directly — the wire field is `elapsedSec`, not
 * milliseconds — so this stays a self-contained roster-only helper rather
 * than a cross-feature import.
 */
export function formatElapsedSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * `true` while the fleet is doing in-flight work — any row `running` or
 * `blocked`, or an explicit payload-level `active` extra when present (it
 * wins over the derived value, since a helper that bothers to send it
 * means it more precisely than a snapshot of row states can).
 */
export function resolveRosterActive(payload: Pick<PiUiPayloadForKind<"roster">, "rows">): boolean {
  const explicit = extraBoolean(payload, "active");
  if (explicit !== undefined) return explicit;
  return payload.rows.some((row) => row.state !== undefined && ACTIVE_ROW_STATES.has(row.state));
}

export interface PiUiRosterRowActionsModel {
  /** The composite `${element.id}#${row.id}` id this row's actions route through. */
  rowElementId: string;
  actions: PiUiActionButtonModel[];
}

/**
 * One row's action button models, bound to its own composite element id so
 * two rows sharing an action id (e.g. every fleet row has its own `kill`)
 * never read or show each other's pending/settled state.
 */
export function buildRosterRowActionsModel(
  elementId: string,
  row: Pick<PiUiRosterRow, "id" | "actions">,
  getActionState: (actionId: string, elementId?: string) => extensions.ExtensionActionState,
): PiUiRosterRowActionsModel {
  const rowElementId = `${elementId}#${row.id}`;
  return {
    rowElementId,
    actions: buildElementActionModels(row.actions, (actionId) =>
      getActionState(actionId, rowElementId),
    ),
  };
}

export interface PiUiRosterRowModel {
  /** Stable list key: the row's own id (roster rows always have one, unlike widget rows). */
  key: string;
  label: string;
  state: PiUiRosterRowState | undefined;
  stateLabel: string | undefined;
  tone: PiPrimitiveTone | undefined;
  detail: string | undefined;
  /** Extension/agent model identifier, e.g. `"opencode/deepseek-v4-flash"` (subagents' extra). */
  model: string | undefined;
  elapsed: PiUiAnnouncedText | undefined;
  /** `Progress`'s `value` prop shape, `undefined` when the row carries no `progress`. */
  progress: { value: number | null; fractionText: string | undefined } | undefined;
  /** `true` when this row's id matches the payload's `selected` extra. */
  selected: boolean;
  /** One utterance combining label, state, detail, model, and elapsed for TalkBack. */
  accessibilityLabel: string;
}

function clampFraction(value: number, max: number | undefined): number {
  if (max === undefined) return Math.min(1, Math.max(0, value));
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

function buildRowModel(row: PiUiRosterRow, selectedId: string | undefined): PiUiRosterRowModel {
  const stateLabel = row.state ? ROW_STATE_LABEL[row.state] : undefined;
  const model = extraString(row, "model");
  const elapsedSec = extraNumber(row, "elapsedSec");
  const elapsedText = elapsedSec !== undefined ? formatElapsedSeconds(elapsedSec) : undefined;
  const selected = selectedId !== undefined && selectedId === row.id;

  const progress = row.progress
    ? {
        value:
          row.progress.indeterminate === true || row.progress.value === undefined
            ? null
            : clampFraction(row.progress.value, row.progress.max),
        fractionText:
          row.progress.value !== undefined && row.progress.max !== undefined
            ? `${row.progress.value} of ${row.progress.max}`
            : undefined,
      }
    : undefined;

  const spoken = [
    row.label,
    stateLabel,
    model,
    elapsedText,
    row.detail,
    selected ? "Selected" : undefined,
  ].filter((part): part is string => Boolean(part));

  return {
    key: row.id,
    label: row.label,
    state: row.state,
    stateLabel,
    tone: row.state ? ROW_STATE_TONE[row.state] : undefined,
    detail: row.detail,
    model,
    elapsed: elapsedText
      ? {
          text: elapsedText,
          accessibilityLabel: `${row.label} elapsed: ${elapsedText}`,
          accessibilityLiveRegion: "polite",
        }
      : undefined,
    progress,
    selected,
    accessibilityLabel: spoken.join(", "),
  };
}

export interface PiUiRosterRenderModel {
  title: string;
  /** `resolveRosterActive`'s verdict for this payload. */
  active: boolean;
  rows: PiUiRosterRowModel[];
  /** Shown instead of the row list when there are no rows at all. */
  emptyText: string | undefined;
  actionsAccessibilityLabel: string;
}

export function buildRosterRenderModel(
  element: Pick<PiUiElement, "ns" | "title">,
  payload: PiUiPayloadForKind<"roster">,
): PiUiRosterRenderModel {
  const title = element.title ?? humanizeNamespace(element.ns);
  const selectedId = extraString(payload, "selected");
  return {
    title,
    active: resolveRosterActive(payload),
    rows: payload.rows.map((row) => buildRowModel(row, selectedId)),
    emptyText: payload.rows.length === 0 ? "No rows to show." : undefined,
    actionsAccessibilityLabel: `${title} actions`,
  };
}
