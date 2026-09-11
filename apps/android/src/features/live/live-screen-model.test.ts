import { describe, expect, it } from "vitest";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import {
  buildLiveScreenViewModel,
  formatLiveElapsed,
  resolveWorkflowFraction,
} from "./live-screen-model";

/**
 * Behavioural tests for the Live screen's selection and formatting.
 * The module is RN-free by construction (see its doc comment), so this
 * runs the real functions rather than matching their source text.
 */
function rosterElement(
  id: string,
  rows: readonly Record<string, unknown>[],
  placement: PiUiElement["placement"] = "pinned",
): PiUiElement {
  return {
    id,
    ns: "subagents",
    kind: "roster",
    placement,
    payload: { kind: "roster", rows },
  } as unknown as PiUiElement;
}

function progressElement(id: string, payload: Record<string, unknown>): PiUiElement {
  return {
    id,
    ns: "workflows",
    kind: "progress",
    placement: "inline",
    payload: { kind: "progress", ...payload },
  } as unknown as PiUiElement;
}

describe("formatLiveElapsed", () => {
  it("reads seconds, then minutes and seconds, then hours and minutes", () => {
    expect(formatLiveElapsed(0)).toBe("0s");
    expect(formatLiveElapsed(59)).toBe("59s");
    expect(formatLiveElapsed(137)).toBe("2m 17s");
    expect(formatLiveElapsed(3725)).toBe("1h 02m");
  });

  it("floors a fractional reading and never renders a negative one", () => {
    expect(formatLiveElapsed(12.9)).toBe("12s");
    expect(formatLiveElapsed(-5)).toBe("0s");
  });
});

describe("resolveWorkflowFraction", () => {
  it("divides value by max and clamps to 0..1", () => {
    expect(resolveWorkflowFraction(2, 4, undefined)).toBe(0.5);
    expect(resolveWorkflowFraction(9, 4, undefined)).toBe(1);
    expect(resolveWorkflowFraction(-1, 4, undefined)).toBe(0);
  });

  it("treats a value with no max as already a fraction", () => {
    expect(resolveWorkflowFraction(0.25, undefined, undefined)).toBe(0.25);
  });

  it("returns null for an indeterminate step or one with no value at all", () => {
    expect(resolveWorkflowFraction(2, 4, true)).toBeNull();
    expect(resolveWorkflowFraction(undefined, 4, undefined)).toBeNull();
  });

  it("returns 0 rather than dividing by a non-positive max", () => {
    expect(resolveWorkflowFraction(2, 0, undefined)).toBe(0);
  });
});

describe("buildLiveScreenViewModel — subagents", () => {
  it("counts only running rows in the summary, and every row in the total", () => {
    const model = buildLiveScreenViewModel([
      rosterElement("fleet", [
        { id: "a", label: "reviewer", state: "running" },
        { id: "b", label: "indexer", state: "running" },
        { id: "c", label: "packager", state: "idle" },
        { id: "d", label: "linter", state: "done" },
        { id: "e", label: "fuzzer", state: "error" },
      ]),
    ]);
    expect(model.subagents.summary).toBe("2 running · 5 total");
    expect(model.subagents.emptyText).toBeUndefined();
  });

  it("maps each row state onto the glyph and the word the artifact gives it", () => {
    const model = buildLiveScreenViewModel([
      rosterElement("fleet", [
        { id: "a", label: "reviewer", state: "running" },
        { id: "b", label: "packager", state: "idle" },
        { id: "c", label: "waiter", state: "blocked" },
        { id: "d", label: "linter", state: "done" },
        { id: "e", label: "fuzzer", state: "error" },
      ]),
    ]);
    expect(model.subagents.rows.map((row) => [row.glyph, row.stateWord])).toEqual([
      ["working", undefined],
      ["waiting", "Queued"],
      ["waiting", "Blocked"],
      ["done", undefined],
      ["failed", "Failed"],
    ]);
  });

  it("falls back to the waiting glyph for a row that reports no state at all", () => {
    const model = buildLiveScreenViewModel([rosterElement("fleet", [{ id: "a", label: "x" }])]);
    expect(model.subagents.rows[0]?.glyph).toBe("waiting");
    expect(model.subagents.rows[0]?.stateWord).toBeUndefined();
  });

  it("reads the subagents extension's own elapsedSec passthrough extra", () => {
    const model = buildLiveScreenViewModel([
      rosterElement("fleet", [{ id: "a", label: "reviewer", state: "running", elapsedSec: 252 }]),
    ]);
    expect(model.subagents.rows[0]?.elapsedText).toBe("4m 12s");
  });

  it("ignores an elapsedSec that is not a finite number, rather than rendering NaN", () => {
    const model = buildLiveScreenViewModel([
      rosterElement("fleet", [
        { id: "a", label: "reviewer", elapsedSec: "252" },
        { id: "b", label: "indexer", elapsedSec: Number.NaN },
      ]),
    ]);
    expect(model.subagents.rows.map((row) => row.elapsedText)).toEqual([undefined, undefined]);
  });

  it("composes each row key with its element's id, so two rosters with the same row ids cannot collide", () => {
    const model = buildLiveScreenViewModel([
      rosterElement("fleet-a", [{ id: "a", label: "one" }]),
      rosterElement("fleet-b", [{ id: "a", label: "two" }]),
    ]);
    expect(model.subagents.rows.map((row) => row.key)).toEqual(["fleet-a#a", "fleet-b#a"]);
  });

  it("takes a roster at any placement, not only the pinned one", () => {
    const model = buildLiveScreenViewModel([
      rosterElement("fleet", [{ id: "a", label: "reviewer", state: "running" }], "inline"),
    ]);
    expect(model.subagents.rows).toHaveLength(1);
    expect(model.subagents.summary).toBe("1 running · 1 total");
  });

  it("speaks the row's name, state word, elapsed reading and detail as one utterance", () => {
    const model = buildLiveScreenViewModel([
      rosterElement("fleet", [
        { id: "a", label: "packager", state: "idle", elapsedSec: 65, detail: "waiting on review" },
      ]),
    ]);
    expect(model.subagents.rows[0]?.accessibilityLabel).toBe(
      "packager, Queued, 1m 05s, waiting on review",
    );
  });

  it("still renders the card when nothing has reported, with a sentence saying so", () => {
    const model = buildLiveScreenViewModel([]);
    expect(model.subagents.title).toBe("Subagents");
    expect(model.subagents.rows).toEqual([]);
    expect(model.subagents.summary).toBe("0 running · 0 total");
    expect(model.subagents.emptyText).toBe("No subagents have reported yet.");
  });
});

describe("buildLiveScreenViewModel — workflow", () => {
  it("renders one row per progress element, with its step reading and bar fraction", () => {
    const model = buildLiveScreenViewModel([
      progressElement("s1", { label: "design", value: 2, max: 4 }),
      progressElement("s2", { label: "build", value: 4, max: 4 }),
    ]);
    expect(model.workflow.rows).toEqual([
      {
        key: "s1",
        label: "design",
        stepText: "2/4",
        fraction: 0.5,
        accessibilityLabel: "design, 2/4",
      },
      {
        key: "s2",
        label: "build",
        stepText: "4/4",
        fraction: 1,
        accessibilityLabel: "build, 4/4",
      },
    ]);
    expect(model.workflow.summary).toBe("1 of 2 complete");
  });

  it("T385: the summary stays the completion count, because only a PHASE label is on the wire", () => {
    // A2's Workflow summary reads `<instance name> · round · elapsed ·
    // tokens`; a `progress` element carries the phase's own label
    // (`"workflow · implement"`), never the instance's name, and no
    // round/elapsed/token field exists. Promoting a phase label into
    // the summary would print a name the workflow does not have.
    const model = buildLiveScreenViewModel([
      progressElement("s1", { label: "workflow · implement", value: 2, max: 4 }),
      progressElement("s2", { label: "workflow · verify", value: 0, max: 1 }),
    ]);
    expect(model.workflow.summary).toBe("0 of 2 complete");
  });

  it("names a step by its element title, then its namespace, when the payload carries no label", () => {
    const titled = {
      id: "s1",
      ns: "workflows",
      kind: "progress",
      placement: "inline",
      title: "Round 1",
      payload: { kind: "progress", value: 1, max: 2 },
    } as unknown as PiUiElement;
    const model = buildLiveScreenViewModel([titled, progressElement("s2", { value: 1, max: 2 })]);
    expect(model.workflow.rows.map((row) => row.label)).toEqual(["Round 1", "workflows"]);
  });

  it("carries an indeterminate step as a null fraction and no step reading", () => {
    const model = buildLiveScreenViewModel([
      progressElement("s1", { label: "sync", indeterminate: true, value: 1, max: 2 }),
    ]);
    expect(model.workflow.rows[0]?.fraction).toBeNull();
  });

  it("still renders the card when nothing has reported, with a sentence saying so", () => {
    const model = buildLiveScreenViewModel([]);
    expect(model.workflow.title).toBe("Workflow");
    expect(model.workflow.emptyText).toBe("No workflow steps have reported yet.");
    expect(model.workflow.summary).toBe("0 of 0 complete");
  });

  it("ignores every other element kind, so a log or a form never becomes a workflow step", () => {
    const log = {
      id: "l1",
      ns: "pi",
      kind: "log",
      placement: "inline",
      payload: { kind: "log", lines: ["x"] },
    } as unknown as PiUiElement;
    const model = buildLiveScreenViewModel([log]);
    expect(model.workflow.rows).toEqual([]);
    expect(model.subagents.rows).toEqual([]);
  });
});
