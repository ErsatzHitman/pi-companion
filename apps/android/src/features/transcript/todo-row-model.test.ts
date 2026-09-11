import { describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import {
  RING_CIRCUMFERENCE,
  RING_RADIUS,
  RING_STROKE,
  buildTodoRows,
  isTodoEntry,
  ringDashOffset,
  ringInk,
  todoAccessibilityLabel,
  todoGlyph,
  todoGlyphInk,
  todoHeadGlyph,
  todoHeadInk,
  todoHeadline,
  todoItemStates,
  todoProgress,
  todoSubjectInk,
  type TodoItemLike,
} from "./todo-row-model";

function items(...pairs: readonly (readonly [string, boolean])[]): TodoItemLike[] {
  return pairs.map(([text, completed]) => ({ text, completed }));
}

describe("isTodoEntry (T360)", () => {
  it("accepts a todo entry and nothing else", () => {
    const todo = { kind: "todo", id: "t1", items: [] } as unknown as timeline.TranscriptEntry;
    const message = { kind: "assistant-message", id: "m1" } as unknown as timeline.TranscriptEntry;
    expect(isTodoEntry(todo)).toBe(true);
    expect(isTodoEntry(message)).toBe(false);
  });
});

describe("todoItemStates: three visible states from one wire boolean (T360)", () => {
  it("marks the first incomplete item current and the rest waiting", () => {
    expect(todoItemStates(items(["a", true], ["b", false], ["c", false]))).toEqual([
      "done",
      "current",
      "waiting",
    ]);
  });

  it("takes the current item from position, not from order of completion", () => {
    // A list worked out of order: the earliest OPEN item is the one
    // shown as current, even though a later one is already done.
    expect(todoItemStates(items(["a", false], ["b", true], ["c", false]))).toEqual([
      "current",
      "done",
      "waiting",
    ]);
  });

  it("has no current item once everything is done", () => {
    expect(todoItemStates(items(["a", true], ["b", true]))).toEqual(["done", "done"]);
  });

  it("returns nothing for an empty list", () => {
    expect(todoItemStates([])).toEqual([]);
  });
});

describe("the per-state glyph and tints name roles, never colours (T360)", () => {
  it("gives every state its own text glyph", () => {
    expect(todoGlyph("done")).toBe("✓");
    expect(todoGlyph("current")).toBe("◐");
    expect(todoGlyph("waiting")).toBe("○");
    // Three distinct marks: the tint is never the only difference.
    expect(new Set(["done", "current", "waiting"].map((s) => todoGlyph(s as never))).size).toBe(3);
  });

  it("tints the glyph and the subject from token keys", () => {
    // The artifact: the done glyph is `ok-t` green, the current one
    // `var(--accent)`, a waiting one `dim`; the subject is `dim` and
    // struck for done, `ink`/500 for current, `ink-2` otherwise.
    expect(todoGlyphInk("done")).toBe("green");
    expect(todoGlyphInk("current")).toBe("accent");
    expect(todoGlyphInk("waiting")).toBe("ink-3");
    expect(todoSubjectInk("done")).toBe("ink-3");
    expect(todoSubjectInk("current")).toBe("ink");
    expect(todoSubjectInk("waiting")).toBe("ink-2");
    for (const state of ["done", "current", "waiting"] as const) {
      expect(todoGlyphInk(state)).not.toMatch(/^#|^rgb/);
      expect(todoSubjectInk(state)).not.toMatch(/^#|^rgb/);
    }
  });
});

describe("buildTodoRows: the artifact's flat rows (T360)", () => {
  it("draws no tree connector and no `#n` — the artifact's `.ov-row` is a glyph and a subject", () => {
    const rows = buildTodoRows(items(["a", true], ["b", false], ["c", false]));
    expect(rows).toEqual([
      { state: "done", subject: "a", struck: true },
      { state: "current", subject: "b", struck: false },
      { state: "waiting", subject: "c", struck: false },
    ]);
  });

  it("strikes through exactly the done rows", () => {
    const rows = buildTodoRows(items(["a", true], ["b", false]));
    expect(rows.map((row) => row.struck)).toEqual([true, false]);
  });

  it("carries the item's own text through untouched", () => {
    expect(buildTodoRows(items(["  spaced  ", false]))[0]?.subject).toBe("  spaced  ");
  });

  it("returns nothing for an empty list", () => {
    expect(buildTodoRows([])).toEqual([]);
  });
});

describe("todoProgress and the ring (T360)", () => {
  it("counts done against total", () => {
    expect(todoProgress(items(["a", true], ["b", false], ["c", true]))).toEqual({
      done: 2,
      total: 3,
      fraction: 2 / 3,
      complete: false,
      active: true,
    });
  });

  it("is complete only when there is something to complete", () => {
    expect(todoProgress(items(["a", true])).complete).toBe(true);
    // An empty list is 0/0. Calling that complete would paint a full
    // green ring for a list with nothing in it.
    expect(todoProgress([])).toEqual({
      done: 0,
      total: 0,
      fraction: 0,
      complete: false,
      active: false,
    });
  });

  it("derives the circumference rather than pinning the artifact's rounded literal", () => {
    expect(RING_RADIUS).toBe(8);
    expect(RING_STROKE).toBe(2);
    expect(RING_CIRCUMFERENCE).toBeCloseTo(50.27, 2);
    expect(RING_CIRCUMFERENCE).toBe(2 * Math.PI * RING_RADIUS);
  });

  it("leaves the unfinished fraction of the ring unpainted", () => {
    expect(ringDashOffset(0)).toBeCloseTo(RING_CIRCUMFERENCE, 6);
    expect(ringDashOffset(1)).toBeCloseTo(0, 6);
    expect(ringDashOffset(0.5)).toBeCloseTo(RING_CIRCUMFERENCE / 2, 6);
  });

  it("clamps a fraction outside 0..1 rather than drawing a negative arc", () => {
    expect(ringDashOffset(-1)).toBeCloseTo(RING_CIRCUMFERENCE, 6);
    expect(ringDashOffset(2)).toBeCloseTo(0, 6);
  });

  it("turns the ring green only when the list is finished", () => {
    expect(ringInk(todoProgress(items(["a", false])))).toBe("orange");
    expect(ringInk(todoProgress(items(["a", true])))).toBe("green");
    expect(ringInk(todoProgress([]))).toBe("orange");
  });
});

describe("the head says the count in words (T360)", () => {
  it("prints n/m, so the ring is decoration over a real readout", () => {
    expect(todoHeadline(todoProgress(items(["a", true], ["b", false])))).toBe("Todos (1/2)");
    expect(todoHeadline(todoProgress([]))).toBe("Todos (0/0)");
  });

  it("prints the artifact's own head mark: ✓ done, ◐ active, ○ empty", () => {
    expect(todoHeadGlyph(todoProgress(items(["a", false])))).toBe("◐");
    expect(todoHeadGlyph(todoProgress(items(["a", true])))).toBe("✓");
    expect(todoHeadGlyph(todoProgress([]))).toBe("○");
  });

  it("colours the head green when finished and quiet while open", () => {
    expect(todoHeadInk(todoProgress(items(["a", false])))).toBe("ink-2");
    expect(todoHeadInk(todoProgress(items(["a", true])))).toBe("green");
    expect(todoHeadInk(todoProgress([]))).toBe("ink-3");
  });
});

describe("todoAccessibilityLabel: what a screen reader gets (T360)", () => {
  it("names the counts and the current item's own words", () => {
    expect(todoAccessibilityLabel(items(["write tests", true], ["read plan", false]))).toBe(
      "Todos, 1 of 2 done. Current: read plan",
    );
  });

  it("drops the current clause when there is nothing in progress", () => {
    expect(todoAccessibilityLabel(items(["done", true]))).toBe("Todos, 1 of 1 done");
    expect(todoAccessibilityLabel([])).toBe("Todos, 0 of 0 done");
  });
});
