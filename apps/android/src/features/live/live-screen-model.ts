/**
 * The Live (A2) screen's pure view model (T350).
 *
 * The redesign's Live screen is a per-session activity view: which
 * subagents are running, how far the current workflow has got, and how
 * much of the context window the session has spent. This module owns
 * the first two — the third arrives with the context-usage wiring — and
 * owns them as data, with no React Native import anywhere in its graph,
 * for the same reason every other `-model.ts` in this app does: this
 * workspace's `vitest` cannot parse `react-native`'s Flow-annotated
 * source, so a decision worth testing has to live where that import
 * never reaches.
 *
 * **Where the data comes from, and why it is not invented here.** A
 * session's live activity already arrives over the wire as Pi UI
 * elements (`plan.md` §11.3): the `subagents` extension publishes its
 * fleet as a `roster` payload, and step/round progress arrives as
 * `progress` payloads. This screen therefore SELECTS from the elements
 * the route already holds (`usePiUiElements` over
 * `AppCore.piUiSession.store`, the same store the pinned area reads) —
 * it opens no second subscription and defines no parallel state.
 *
 * **Placement is deliberately ignored.** `pinned-model.ts`'s
 * `selectPinnedElements` filters to `placement: "pinned"` because the
 * pinned area is a strip above the composer competing for the session
 * screen's height. This screen is a whole route with nothing to compete
 * with, and a subagent fleet published as `inline` or `screen` is
 * exactly as live as one published as `pinned` — filtering it out would
 * hide real running work behind a placement hint meant for a different
 * surface.
 *
 * The row shapes below are the artifact's, not `roster-model.ts`'s.
 * That module renders a roster as a general-purpose card anywhere in
 * the app, with per-row action buttons and a `Progress` bar; this
 * screen draws a compact mono line with a state glyph, a name and an
 * elapsed reading. Reusing `buildRosterRenderModel` would have meant
 * either drawing its shape here or widening it with a second mode, and
 * the two views genuinely differ.
 */
import type { PiUiElement, PiUiRosterRowState } from "@picompanion/protocol/pi-ui-bridge/schema";

/**
 * What a row's leading glyph says. Named for the meaning rather than
 * the drawing, so `live-screen.tsx` owns how each is painted:
 * `working` is the artifact's animated pixel loader, `waiting` its
 * hollow ring, `done` its tick, `failed` its error mark.
 */
export type LiveRowGlyph = "working" | "waiting" | "done" | "failed";

const ROW_GLYPH: Record<PiUiRosterRowState, LiveRowGlyph> = {
  running: "working",
  blocked: "waiting",
  idle: "waiting",
  done: "done",
  error: "failed",
};

/**
 * The short word beside a row that is NOT running. The artifact gives
 * an idle row a "Queued" pill and a finished row its dim elapsed time,
 * so a running row needs no word at all — its loader already says so.
 */
const ROW_STATE_WORD: Record<PiUiRosterRowState, string | undefined> = {
  running: undefined,
  blocked: "Blocked",
  idle: "Queued",
  done: undefined,
  error: "Failed",
};

export interface LiveSubagentRow {
  /** Stable list key: the roster row's own id, composed with its element's so two rosters cannot collide. */
  key: string;
  label: string;
  glyph: LiveRowGlyph;
  /** "Queued"/"Blocked"/"Failed", or `undefined` for a row whose glyph already says it. */
  stateWord: string | undefined;
  /** A coarse elapsed reading from the row's `elapsedSec` extra, when it carries one. */
  elapsedText: string | undefined;
  detail: string | undefined;
  /** One utterance for TalkBack, so a row is never read as a bare name. */
  accessibilityLabel: string;
}

export interface LiveSubagentsCard {
  title: string;
  /** "2 running · 5 total". */
  summary: string;
  rows: LiveSubagentRow[];
  /** Set only when there are no rows at all; the card still renders, so its absence is visible. */
  emptyText: string | undefined;
}

export interface LiveWorkflowRow {
  key: string;
  label: string;
  /** "2/4" when the step reports both a value and a max, else `undefined`. */
  stepText: string | undefined;
  /** 0..1 for a determinate step, `null` for an indeterminate one. */
  fraction: number | null;
  accessibilityLabel: string;
}

export interface LiveWorkflowCard {
  title: string;
  summary: string;
  rows: LiveWorkflowRow[];
  emptyText: string | undefined;
}

export interface LiveScreenViewModel {
  subagents: LiveSubagentsCard;
  workflow: LiveWorkflowCard;
}

const SUBAGENTS_TITLE = "Subagents";
const WORKFLOW_TITLE = "Workflow";
const NO_SUBAGENTS = "No subagents have reported yet.";
const NO_WORKFLOW = "No workflow steps have reported yet.";

/** Reads an untyped passthrough extra off a roster row, tolerating any shape. */
function extraNumber(source: unknown, key: string): number | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * `59` becomes `59s`, `137` becomes `2m 17s`, `3725` becomes `1h 02m`.
 * The artifact shows a coarse reading beside a subagent name, not a
 * stopwatch, so the largest two units are enough and the smallest is
 * dropped once there are hours.
 */
export function formatLiveElapsed(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * A `progress` payload's own fraction, clamped to 0..1, or `null` when
 * it is indeterminate or reports no value. An absent `max` means
 * `value` is already a fraction — the same reading
 * `renderers/progress-model.ts`'s `clampProgressFraction` takes,
 * restated rather than imported so this screen does not depend on a
 * renderer module's internals.
 */
export function resolveWorkflowFraction(
  value: number | undefined,
  max: number | undefined,
  indeterminate: boolean | undefined,
): number | null {
  if (indeterminate === true || value === undefined) return null;
  if (max === undefined) return Math.min(1, Math.max(0, value));
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

function buildSubagentsCard(elements: readonly PiUiElement[]): LiveSubagentsCard {
  const rows: LiveSubagentRow[] = [];
  let running = 0;

  for (const element of elements) {
    if (element.payload?.kind !== "roster") continue;
    for (const row of element.payload.rows) {
      const state = row.state;
      if (state === "running") running += 1;
      const elapsedSec = extraNumber(row, "elapsedSec");
      const elapsedText = elapsedSec === undefined ? undefined : formatLiveElapsed(elapsedSec);
      const stateWord = state === undefined ? undefined : ROW_STATE_WORD[state];
      const spoken = [row.label, stateWord, elapsedText, row.detail].filter(
        (part): part is string => Boolean(part),
      );
      rows.push({
        key: `${element.id}#${row.id}`,
        label: row.label,
        glyph: state === undefined ? "waiting" : ROW_GLYPH[state],
        stateWord,
        elapsedText,
        detail: row.detail,
        accessibilityLabel: spoken.join(", "),
      });
    }
  }

  return {
    title: SUBAGENTS_TITLE,
    summary: `${running} running · ${rows.length} total`,
    rows,
    emptyText: rows.length === 0 ? NO_SUBAGENTS : undefined,
  };
}

function buildWorkflowCard(elements: readonly PiUiElement[]): LiveWorkflowCard {
  const rows: LiveWorkflowRow[] = [];
  let complete = 0;

  for (const element of elements) {
    if (element.payload?.kind !== "progress") continue;
    const { label, detail, value, max, indeterminate } = element.payload;
    const fraction = resolveWorkflowFraction(value, max, indeterminate);
    if (fraction === 1) complete += 1;
    const stepText = value !== undefined && max !== undefined ? `${value}/${max}` : undefined;
    const name = label ?? element.title ?? element.ns;
    const spoken = [name, stepText, detail].filter((part): part is string => Boolean(part));
    rows.push({
      key: element.id,
      label: name,
      stepText,
      fraction,
      accessibilityLabel: spoken.join(", "),
    });
  }

  return {
    title: WORKFLOW_TITLE,
    summary: `${complete} of ${rows.length} complete`,
    rows,
    emptyText: rows.length === 0 ? NO_WORKFLOW : undefined,
  };
}

/**
 * The whole screen's data, from the elements the session route already
 * holds. Every card renders even when empty: a Live screen that hides
 * its Subagents card when nothing is running cannot be told apart from
 * one whose feed is broken.
 */
export function buildLiveScreenViewModel(elements: readonly PiUiElement[]): LiveScreenViewModel {
  return {
    subagents: buildSubagentsCard(elements),
    workflow: buildWorkflowCard(elements),
  };
}
