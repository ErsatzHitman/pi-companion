/**
 * The Android rewind sheet's model — T395, `plan.md` §4.2 ("Workspace
 * checkpoint snapshots").
 *
 * `packages/frontend-core/src/rewind/` is the platform-neutral half:
 * `RewindController` drives `DaemonClient.rewindAgent` and folds the
 * daemon's answer into the typed `RewindOutcome` (`success` /
 * `unsupported` / `conflict` / `failed`). This module turns the dialog's
 * state into exactly what `RewindSheet.tsx` draws, so the `.tsx` holds no
 * decisions of its own — the convention this workspace's component tests
 * depend on, since a `react-native` component cannot be rendered under its
 * plain `vitest` setup.
 *
 * ## The three gates are stated, never hidden
 *
 * - **A turn in flight.** The daemon cancels an in-flight run before a
 *   rewind, but `agent-manager`'s rewind path is still documented to refuse
 *   a restore mid-turn, so the primary action is disabled and the sheet
 *   says why rather than sending a request the daemon would reject.
 * - **No connection.** `RewindController` needs a client; without one the
 *   request cannot even be framed.
 * - **A conflict.** A `conflict` outcome means the work tree moved under
 *   the snapshot and the daemon refused to overwrite it (`plan.md` §4.2,
 *   "A conflict refuses unless `force` is set"). The sheet replaces its
 *   primary action with an explicit "Restore anyway" — overriding is a
 *   deliberate second request, never something this model does on its own.
 *
 * ## The undone list is local, and says so
 *
 * `undoneTurns` is this app session's own record (`undone-turns.ts`), not
 * daemon state; the heading says exactly that so a user never reads the
 * list as something the daemon could have told them.
 *
 * This module imports only sibling pure modules and a type from
 * `@picompanion/frontend-core`, so every branch above is a plain
 * assertion in `rewind-sheet-model.test.ts`.
 */
import { REWIND_SCOPE_OPTIONS, rewindScopeLabel } from "./rewind-scopes";
import type { RewindMode } from "./rewind-scopes";
import type { UndoneTurn } from "./undone-turns";

/** The sheet's current phase. `idle` is "nothing sent yet". */
export type RewindStatus =
  | "idle"
  | "submitting"
  | "conflict"
  | "unsupported"
  | "failed"
  | "success";

/** The message a rewind is aimed at, with its sheet/heading snippet. */
export interface RewindTarget {
  /** The id sent on the wire (`entry.messageId ?? entry.clientMessageId`). */
  readonly messageId: string;
  readonly snippet: string;
}

export interface RewindDialogState {
  readonly open: boolean;
  readonly target: RewindTarget | null;
  readonly mode: RewindMode;
  readonly status: RewindStatus;
  /** The daemon's sentence for `conflict`/`unsupported`/`failed`, marker already stripped. */
  readonly message: string | null;
  readonly turnRunning: boolean;
  readonly connected: boolean;
  /** This app session's own record — never daemon state. */
  readonly undoneTurns: readonly UndoneTurn[];
}

export interface RewindScopeRow {
  readonly mode: RewindMode;
  readonly label: string;
  readonly description: string;
  readonly selected: boolean;
}

/** `submit` and `cancel` are the ordinary pair; a conflict swaps in `restore-anyway`. */
export type RewindActionId = "submit" | "cancel" | "restore-anyway";

export interface RewindSheetAction {
  readonly id: RewindActionId;
  readonly label: string;
  readonly enabled: boolean;
}

export interface RewindUndoneRow {
  /** The record this row returns to; handed back untouched by the sheet. */
  readonly turn: UndoneTurn;
  readonly snippet: string;
  readonly modeLabel: string;
  readonly accessibilityLabel: string;
}

export interface RewindSheetModel {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly scopes: readonly RewindScopeRow[];
  /** The daemon's sentence, a refusal's explanation, or `null` when there is nothing to say. */
  readonly statusText: string | null;
  /** Primary first. A disabled primary carries its reason in `statusText`. */
  readonly actions: readonly RewindSheetAction[];
  readonly footerHint: string;
  /** `null` when this session has not rewound anything yet. */
  readonly undoneHeading: string | null;
  readonly undoneRows: readonly RewindUndoneRow[];
  readonly accessibilityLabel: string;
}

export const REWIND_SHEET_TITLE = "Rewind to here";
export const REWIND_SUBMIT_LABEL = "Rewind";
export const REWIND_SUBMITTING_LABEL = "Rewinding…";
export const REWIND_RESTORE_ANYWAY_LABEL = "Restore anyway";
export const REWIND_CANCEL_LABEL = "Cancel";
export const REWIND_SUCCESS_TEXT = "Rewound.";
export const REWIND_TURN_RUNNING_REASON =
  "A turn is running. Wait for it to finish before rewinding.";
export const REWIND_DISCONNECTED_REASON = "Not connected to the daemon — there is nothing to ask.";
export const REWIND_FOOTER_HINT = "Choose a scope, then Rewind. Cancel closes this sheet.";
export const REWIND_UNDONE_HEADING = "Undone in this session — local record, not daemon state";

/**
 * Why the primary action cannot be used right now, or `null` when it can.
 * A `conflict` is deliberately *not* a block: the sheet's answer to a
 * conflict is "Restore anyway", which is enabled by construction.
 */
export function rewindSubmitBlockedReason(state: RewindDialogState): string | null {
  if (state.status === "submitting") return REWIND_SUBMITTING_LABEL;
  if (!state.connected) return REWIND_DISCONNECTED_REASON;
  if (state.target === null) return "This message has no id the daemon could rewind to.";
  if (state.turnRunning) return REWIND_TURN_RUNNING_REASON;
  return null;
}

function statusTextFor(state: RewindDialogState, blockedReason: string | null): string | null {
  switch (state.status) {
    case "conflict":
    case "unsupported":
    case "failed":
      // The controller already stripped the wire marker, so this sentence
      // is the daemon's own and may be shown as-is.
      return state.message ?? "The daemon refused the rewind.";
    case "success":
      return REWIND_SUCCESS_TEXT;
    case "submitting":
      return blockedReason;
    case "idle":
      return blockedReason;
  }
}

export function buildRewindSheetModel(state: RewindDialogState): RewindSheetModel {
  const blockedReason = rewindSubmitBlockedReason(state);
  const target = state.target;
  const description =
    target === null
      ? "Choose what this rewind touches."
      : `Rewind to “${target.snippet}”. ${rewindScopeSentence(state.mode)}`;
  const actions: RewindSheetAction[] =
    state.status === "conflict"
      ? [
          { id: "restore-anyway", label: REWIND_RESTORE_ANYWAY_LABEL, enabled: true },
          { id: "cancel", label: REWIND_CANCEL_LABEL, enabled: true },
        ]
      : [
          {
            id: "submit",
            label: state.status === "submitting" ? REWIND_SUBMITTING_LABEL : REWIND_SUBMIT_LABEL,
            enabled: blockedReason === null,
          },
          { id: "cancel", label: REWIND_CANCEL_LABEL, enabled: true },
        ];
  return {
    open: state.open,
    title: REWIND_SHEET_TITLE,
    description,
    scopes: REWIND_SCOPE_OPTIONS.map((option) => ({
      mode: option.mode,
      label: option.label,
      description: option.description,
      selected: option.mode === state.mode,
    })),
    statusText: statusTextFor(state, blockedReason),
    actions,
    footerHint: REWIND_FOOTER_HINT,
    undoneHeading: state.undoneTurns.length > 0 ? REWIND_UNDONE_HEADING : null,
    undoneRows: state.undoneTurns.map((turn) => ({
      turn,
      snippet: turn.snippet,
      modeLabel: rewindScopeLabel(turn.mode),
      accessibilityLabel: `Return to the turn “${turn.snippet}” (${rewindScopeLabel(turn.mode)})`,
    })),
    accessibilityLabel:
      target === null ? REWIND_SHEET_TITLE : `${REWIND_SHEET_TITLE}: ${target.snippet}`,
  };
}

/** The sentence naming what the selected scope touches, for the description. */
function rewindScopeSentence(mode: RewindMode): string {
  const option = REWIND_SCOPE_OPTIONS.find((candidate) => candidate.mode === mode);
  return option === undefined ? "" : option.description;
}
