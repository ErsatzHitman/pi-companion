import { describe, expect, it } from "vitest";
import type { timeline } from "@picompanion/frontend-core";

import { buildEditFromHereTargets, canEditFromHere } from "./edit-from-here-target.js";

function row(
  overrides: Record<string, unknown> & { kind: string; id: string },
): timeline.TranscriptEntry {
  return {
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    ...overrides,
  } as timeline.TranscriptEntry;
}

describe("buildEditFromHereTargets", () => {
  it("derives no predecessor for the first user message in a session", () => {
    const entries = [row({ kind: "user-message", id: "u1", text: "hello" })];
    const targets = buildEditFromHereTargets(entries);
    expect(targets.get("u1")).toEqual({
      role: "user",
      id: "u1",
      index: 0,
      text: "hello",
      previous: null,
    });
    expect(canEditFromHere(targets, "u1")).toBe(false);
  });

  it("derives the immediately preceding message as previous, skipping non-message rows in between", () => {
    const entries = [
      row({ kind: "user-message", id: "u1", text: "please add a test" }),
      row({ kind: "thinking", id: "t1", text: "considering…" }),
      row({
        kind: "tool-call",
        id: "tc1",
        tool: {
          family: "plain_text",
          callId: "call-1",
          toolName: "note",
          status: "completed",
          displayName: "Note",
          updateCount: 1,
          text: "note",
        },
      }),
      row({ kind: "assistant-message", id: "a1", text: "sure, here's a test", corrected: false }),
      row({ kind: "user-message", id: "u2", text: "actually use vitest" }),
    ];

    const targets = buildEditFromHereTargets(entries);

    // u1 is the first message: no predecessor.
    expect(targets.get("u1")?.previous).toBeNull();

    // u2's immediately preceding MESSAGE is a1 (the thinking/tool-call
    // rows in between are never candidates), at message-order index 1.
    expect(targets.get("u2")).toEqual({
      role: "user",
      id: "u2",
      index: 2,
      text: "actually use vitest",
      previous: { id: "a1", index: 1 },
    });
    expect(canEditFromHere(targets, "u2")).toBe(true);

    // Assistant messages never appear as their own target — this
    // shortcut only ever edits a USER message (T38A1b's `role: "user"`
    // invariant).
    expect(targets.has("a1")).toBe(false);
  });

  it("omits an id entirely when it names something other than a user message", () => {
    const entries = [
      row({ kind: "assistant-message", id: "a1", text: "hi", corrected: false }),
      row({ kind: "thinking", id: "t1", text: "…" }),
    ];
    const targets = buildEditFromHereTargets(entries);
    expect(canEditFromHere(targets, "a1")).toBe(false);
    expect(canEditFromHere(targets, "t1")).toBe(false);
    expect(canEditFromHere(targets, "does-not-exist")).toBe(false);
  });
});
