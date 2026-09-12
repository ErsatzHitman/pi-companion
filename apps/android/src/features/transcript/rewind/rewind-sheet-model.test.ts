import { describe, expect, it } from "vitest";

import {
  buildRewindSheetModel,
  REWIND_DISCONNECTED_REASON,
  REWIND_RESTORE_ANYWAY_LABEL,
  REWIND_SUBMIT_LABEL,
  REWIND_TURN_RUNNING_REASON,
  REWIND_UNDONE_HEADING,
  rewindSubmitBlockedReason,
} from "./rewind-sheet-model";
import type { RewindDialogState } from "./rewind-sheet-model";

/**
 * T395, Android half: every label and gate the sheet draws (plan.md §4.2).
 *
 * `RewindSheet.tsx` cannot be rendered under this workspace's plain vitest
 * setup (its import graph reaches `react-native`), so the sheet's whole
 * decision surface lives in the model this file exercises: the three gates,
 * the action pair a conflict swaps in, and the local undone-turns heading.
 */
function state(overrides: Partial<RewindDialogState> = {}): RewindDialogState {
  return {
    open: true,
    target: { messageId: "m1", snippet: "make the tests pass" },
    mode: "conversation",
    status: "idle",
    message: null,
    turnRunning: false,
    connected: true,
    undoneTurns: [],
    ...overrides,
  };
}

describe("T395 Android rewind sheet model", () => {
  it("never enables the primary action while a turn is running, and says why", () => {
    const model = buildRewindSheetModel(state({ turnRunning: true }));
    expect(model.actions[0]).toEqual({
      id: "submit",
      label: REWIND_SUBMIT_LABEL,
      enabled: false,
    });
    expect(model.statusText).toBe(REWIND_TURN_RUNNING_REASON);
    expect(rewindSubmitBlockedReason(state({ turnRunning: true }))).toBe(
      REWIND_TURN_RUNNING_REASON,
    );
  });

  it("never enables the primary action without a connection", () => {
    const model = buildRewindSheetModel(state({ connected: false }));
    expect(model.actions[0]?.enabled).toBe(false);
    expect(model.statusText).toBe(REWIND_DISCONNECTED_REASON);
  });

  it("says the same thing twice rather than sending a request the daemon would refuse", () => {
    const blocked = state({ turnRunning: true });
    expect(rewindSubmitBlockedReason(blocked)).toBe(REWIND_TURN_RUNNING_REASON);
    expect(buildRewindSheetModel(blocked).actions[0]?.enabled).toBe(false);
  });

  it("enables Submit with no gate in the way", () => {
    const model = buildRewindSheetModel(state());
    expect(model.actions[0]).toEqual({
      id: "submit",
      label: REWIND_SUBMIT_LABEL,
      enabled: true,
    });
    expect(model.statusText).toBeNull();
  });

  it("offers Restore anyway, and only after a conflict — never as the first action", () => {
    const conflict = buildRewindSheetModel(
      state({ status: "conflict", message: "The workspace moved since this checkpoint." }),
    );
    expect(conflict.actions[0]).toEqual({
      id: "restore-anyway",
      label: REWIND_RESTORE_ANYWAY_LABEL,
      enabled: true,
    });
    expect(conflict.actions.map((action) => action.id)).toEqual(["restore-anyway", "cancel"]);
    // The daemon's own sentence is shown verbatim — the controller already
    // stripped the wire marker before it reached this state.
    expect(conflict.statusText).toBe("The workspace moved since this checkpoint.");

    const ordinary = buildRewindSheetModel(state());
    expect(ordinary.actions.map((action) => action.id)).toEqual(["submit", "cancel"]);
  });

  it("shows the daemon's sentence for an unsupported mode and for a plain failure", () => {
    expect(
      buildRewindSheetModel(
        state({ status: "unsupported", message: "This host has no checkpoints." }),
      ).statusText,
    ).toBe("This host has no checkpoints.");
    expect(
      buildRewindSheetModel(state({ status: "failed", message: "rewind failed" })).statusText,
    ).toBe("rewind failed");
  });

  it("still says something honest when a refusal arrives with no sentence of its own", () => {
    expect(buildRewindSheetModel(state({ status: "conflict", message: null })).statusText).toBe(
      "The daemon refused the rewind.",
    );
  });

  it("names the target and the selected scope's real effect in the description", () => {
    const model = buildRewindSheetModel(state({ mode: "files" }));
    expect(model.description).toContain("make the tests pass");
    expect(model.description).toContain("Restores the workspace's files");
    expect(model.accessibilityLabel).toContain("make the tests pass");
  });

  it("marks exactly the selected scope, so a user can see what they are about to do", () => {
    const model = buildRewindSheetModel(state({ mode: "both" }));
    expect(model.scopes.filter((scope) => scope.selected).map((scope) => scope.mode)).toEqual([
      "both",
    ]);
    expect(model.scopes).toHaveLength(3);
  });

  it("labels the undone list as this app session's own record, and only when it has rows", () => {
    const empty = buildRewindSheetModel(state());
    expect(empty.undoneHeading).toBeNull();
    expect(empty.undoneRows).toEqual([]);

    const withRows = buildRewindSheetModel(
      state({
        undoneTurns: [
          { messageId: "m1", snippet: "make the tests pass", mode: "conversation" },
          { messageId: "m2", snippet: "add the sheet", mode: "files" },
        ],
      }),
    );
    expect(withRows.undoneHeading).toBe(REWIND_UNDONE_HEADING);
    expect(withRows.undoneRows.map((row) => row.modeLabel)).toEqual([
      "Conversation only",
      "Files only",
    ]);
    // The row hands the record back untouched, so the screen never
    // reconstructs a target from display text.
    expect(withRows.undoneRows[1]?.turn.messageId).toBe("m2");
    expect(withRows.undoneRows[0]?.accessibilityLabel).toContain("make the tests pass");
  });

  it("says Rewind instead of Rewinding once the request is away", () => {
    expect(buildRewindSheetModel(state({ status: "submitting" })).actions[0]?.label).not.toBe(
      REWIND_SUBMIT_LABEL,
    );
    expect(buildRewindSheetModel(state({ status: "submitting" })).actions[0]?.enabled).toBe(false);
  });

  it("carries the sheet's own open state through, so the model cannot claim an open sheet is closed", () => {
    expect(buildRewindSheetModel(state({ open: false })).open).toBe(false);
    expect(buildRewindSheetModel(state({ open: true })).open).toBe(true);
  });
});
