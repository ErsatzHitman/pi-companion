/**
 * Shared glyph/status vocabulary for the Live pane's Subagents and Workflow
 * cards (docs/ui-reference/pi-companion-web.html `.live` region: `.gl-wait`
 * `○`, `.gl-now` `◐`, `.gl-done` `✓`, `.gl-hold` `◆`).
 *
 * Every status below is distinguished by GLYPH SHAPE first, colour second
 * — never colour alone — so the four states stay tellable apart for a
 * colour-blind reader from the character alone, with colour and an
 * `aria-hidden`-paired visually-hidden text label as reinforcement, not the
 * only signal.
 *
 * `PiUiRosterRowState` (`packages/protocol/src/pi-ui-bridge/payload.ts`) has
 * five values (`idle`/`running`/`blocked`/`done`/`error`); this rail folds
 * `error` into `blocked` (`"needs attention"`, same as the mockup's single
 * `hold` bucket) rather than inventing a fifth glyph the mockup never
 * defines.
 */
import type {
  PiUiProgressPayload,
  PiUiRosterRowState,
} from "@picompanion/protocol/pi-ui-bridge/schema";

export type RailStatus = "pending" | "running" | "done" | "blocked";

export const RAIL_STATUS_GLYPH: Record<RailStatus, string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  blocked: "◆",
};

export const RAIL_STATUS_LABEL: Record<RailStatus, string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  blocked: "Blocked",
};

/** `.track`'s modifier class per mockup sample data: `done` rows get their own green fill; every non-`running` row otherwise shares the grey `is-wait` fill. */
export function railTrackModifier(status: RailStatus): "done" | "wait" | undefined {
  if (status === "done") return "done";
  if (status === "running") return undefined;
  return "wait";
}

export function rosterRowStatus(state: PiUiRosterRowState | undefined): RailStatus {
  switch (state) {
    case "running":
      return "running";
    case "done":
      return "done";
    case "blocked":
    case "error":
      return "blocked";
    case "idle":
    default:
      return "pending";
  }
}

/** A row's/element's progress fraction (`0-1`), or `undefined` when progress is not known — never a fabricated `0`. */
export function railProgressFraction(progress: {
  value?: number;
  max?: number;
  indeterminate?: boolean;
}): number | undefined {
  if (progress.indeterminate) return undefined;
  if (progress.value == null || progress.max == null || progress.max <= 0) return undefined;
  return Math.min(1, Math.max(0, progress.value / progress.max));
}

/** Status for a `progress`-kind element/payload (the Workflow card's one phase per element). */
export function progressPayloadStatus(payload: PiUiProgressPayload): RailStatus {
  if (payload.indeterminate) return "running";
  const fraction = railProgressFraction(payload);
  if (fraction === undefined) return "pending";
  if (fraction >= 1) return "done";
  if (fraction <= 0) return "pending";
  return "running";
}

/** The Workflow card's mono step counter: `"value/max"`, `"…"` for indeterminate, or `"—"` when nothing is known. */
export function progressStepCounter(payload: PiUiProgressPayload): string {
  if (payload.value != null && payload.max != null) {
    return `${payload.value}/${payload.max}`;
  }
  if (payload.indeterminate) return "…";
  return "—";
}
