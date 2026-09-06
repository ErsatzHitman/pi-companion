import { describe, expect, it } from "vitest";

import {
  DIFF_CONTEXT_LINES,
  MAX_DIFF_INPUT_LINES,
  MAX_DIFF_OUTPUT_LINES,
  computeFileDiff,
  type FileDiffLine,
} from "./file-diff.js";

/** Flattens every chunk's lines back into one array, in order, for assertions that don't care about chunk boundaries. */
function allLines(result: ReturnType<typeof computeFileDiff>): FileDiffLine[] {
  return result.chunks.flatMap((chunk) => chunk.lines);
}

describe("computeFileDiff (T30B6)", () => {
  it("reports identical text with no chunks and no algorithm work", () => {
    const result = computeFileDiff("a\nb\nc", "a\nb\nc");
    expect(result).toEqual({
      chunks: [],
      additions: 0,
      deletions: 0,
      identical: true,
      truncated: false,
    });
  });

  it("reports two empty strings as identical", () => {
    const result = computeFileDiff("", "");
    expect(result.identical).toBe(true);
    expect(result.chunks).toEqual([]);
  });

  it("diffs a pure addition", () => {
    const result = computeFileDiff("a\nb", "a\nb\nc");
    expect(result.identical).toBe(false);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(0);
    const lines = allLines(result);
    expect(lines).toEqual([
      { type: "context", text: "a", oldLineNumber: 1, newLineNumber: 1 },
      { type: "context", text: "b", oldLineNumber: 2, newLineNumber: 2 },
      { type: "add", text: "c", newLineNumber: 3 },
    ]);
  });

  it("diffs a pure removal", () => {
    const result = computeFileDiff("a\nb\nc", "a\nb");
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(1);
    const lines = allLines(result);
    expect(lines).toEqual([
      { type: "context", text: "a", oldLineNumber: 1, newLineNumber: 1 },
      { type: "context", text: "b", oldLineNumber: 2, newLineNumber: 2 },
      { type: "remove", text: "c", oldLineNumber: 3 },
    ]);
  });

  it("diffs a single-line replacement as a remove followed by an add", () => {
    const result = computeFileDiff("one\ntwo\nthree", "one\nTWO\nthree");
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    const lines = allLines(result);
    expect(lines).toEqual([
      { type: "context", text: "one", oldLineNumber: 1, newLineNumber: 1 },
      { type: "remove", text: "two", oldLineNumber: 2 },
      { type: "add", text: "TWO", newLineNumber: 2 },
      { type: "context", text: "three", oldLineNumber: 3, newLineNumber: 3 },
    ]);
  });

  it("diffs completely disjoint content as an all-remove, all-add pair", () => {
    const result = computeFileDiff("a\nb", "x\ny\nz");
    expect(result.deletions).toBe(2);
    expect(result.additions).toBe(3);
    const lines = allLines(result);
    expect(lines.filter((l) => l.type === "remove").map((l) => l.text)).toEqual(["a", "b"]);
    expect(lines.filter((l) => l.type === "add").map((l) => l.text)).toEqual(["x", "y", "z"]);
  });

  it("finds the minimal edit script (an insertion in the middle of a longer run)", () => {
    const result = computeFileDiff("1\n2\n3\n4\n5", "1\n2\nX\n3\n4\n5");
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(0);
    const lines = allLines(result);
    expect(lines.find((l) => l.type === "add")?.text).toBe("X");
  });

  it("groups a change into a chunk bounded by DIFF_CONTEXT_LINES of surrounding context", () => {
    // 20 unchanged lines, one changed line in the middle, 20 more unchanged lines.
    const before = Array.from({ length: 20 }, (_, i) => `u${i}`);
    const after = [...before];
    const oldText = [...before, "middle", ...before].join("\n");
    const newText = [...before, "MIDDLE", ...before].join("\n");
    void after;

    const result = computeFileDiff(oldText, newText);
    expect(result.chunks).toHaveLength(1);
    const chunk = result.chunks[0]!;
    // remove + add + 2 * DIFF_CONTEXT_LINES of context.
    expect(chunk.lines).toHaveLength(2 + 2 * DIFF_CONTEXT_LINES);
    // 20 leading unchanged lines minus the context kept immediately before the change.
    expect(chunk.skippedBefore).toBe(20 - DIFF_CONTEXT_LINES);
  });

  it("splits two far-apart changes into two chunks with a skipped-context count", () => {
    const gap = Array.from({ length: 50 }, (_, i) => `u${i}`);
    const oldText = ["A", ...gap, "B"].join("\n");
    const newText = ["A2", ...gap, "B2"].join("\n");

    const result = computeFileDiff(oldText, newText);
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]!.skippedBefore).toBe(0);
    expect(result.chunks[1]!.skippedBefore).toBeGreaterThan(0);
    expect(result.chunks[1]!.skippedBefore).toBe(50 - 2 * DIFF_CONTEXT_LINES);
  });

  it("merges two changes whose context windows overlap into a single chunk", () => {
    // Two changed lines 2 lines apart — well within DIFF_CONTEXT_LINES (3) of each other's window.
    const oldText = "a\nb\nc\nd\ne\nf\ng";
    const newText = "a\nB\nc\nd\nE\nf\ng";

    const result = computeFileDiff(oldText, newText);
    expect(result.chunks).toHaveLength(1);
  });

  it("bounds the diff input for a file over MAX_DIFF_INPUT_LINES total lines and marks it truncated", () => {
    const bigOld = Array.from({ length: 3000 }, (_, i) => `line${i}`).join("\n");
    const bigNew = Array.from({ length: 3000 }, (_, i) =>
      i === 100 ? "CHANGED" : `line${i}`,
    ).join("\n");
    expect(bigOld.split("\n").length + bigNew.split("\n").length).toBeGreaterThan(
      MAX_DIFF_INPUT_LINES,
    );

    const result = computeFileDiff(bigOld, bigNew);
    expect(result.truncated).toBe(true);
    // Still produced *something* rather than dropping the diff entirely.
    expect(result.chunks.length).toBeGreaterThan(0);
  }, 20_000);

  it("bounds the diff output for a wholly-rewritten file even when the input bound isn't hit", () => {
    // Every line differs (disjoint content on both sides, no common
    // subsequence at all), so the whole diff is one remove-everything,
    // add-everything chunk with no context lines — output line count
    // equals old+new line count exactly, and it comfortably clears
    // MAX_DIFF_OUTPUT_LINES while old+new stays at or under half of
    // MAX_DIFF_INPUT_LINES, isolating this from the input bound.
    const count = 1050;
    const oldText = Array.from({ length: count }, (_, i) => `old-line-${i}`).join("\n");
    const newText = Array.from({ length: count }, (_, i) => `new-line-${i}`).join("\n");
    expect(oldText.split("\n").length + newText.split("\n").length).toBeLessThanOrEqual(
      MAX_DIFF_INPUT_LINES,
    );

    const result = computeFileDiff(oldText, newText);
    expect(result.truncated).toBe(true);
    expect(result.additions).toBeGreaterThan(0);
    expect(result.deletions).toBeGreaterThan(0);
    const totalRendered = allLines(result).length;
    expect(totalRendered).toBe(MAX_DIFF_OUTPUT_LINES);
  }, 20_000);

  it("never reports truncated for a small, ordinary diff", () => {
    const result = computeFileDiff("a\nb\nc", "a\nB\nc");
    expect(result.truncated).toBe(false);
  });
});
