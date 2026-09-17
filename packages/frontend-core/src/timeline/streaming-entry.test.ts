/**
 * Tests for `streamingTranscriptEntryId` (plan.md §11.1's `StreamText`
 * cross-row invariant): `turnActive: false` always settles the transcript,
 * only the LAST entry is ever eligible, and only the two kinds `StreamText`
 * actually renders (`"assistant-message"`, `"thinking"`) ever come back.
 *
 * Entries are built as plain literals satisfying `TranscriptEntry`,
 * following the same hand-built-fixture idiom `./transcript-view.test.ts`
 * uses for its own `TimelineRow` literals.
 */
import { describe, expect, it } from "vitest";

import { streamingTranscriptEntryId } from "./streaming-entry.js";
import { buildTranscriptEntry } from "./transcript-view.js";
import type { TranscriptEntry } from "./transcript-view.js";
import type { TimelineRow } from "./types.js";

let nextSeq = 1;

function baseFields() {
  const seq = nextSeq++;
  return {
    epoch: "epoch-fixture",
    seqStart: seq,
    seqEnd: seq,
    timestamp: "2026-09-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
  };
}

function assistantMessage(id: string): TranscriptEntry {
  return { ...baseFields(), id, kind: "assistant-message", text: "hi", corrected: false };
}

function thinking(id: string): TranscriptEntry {
  return { ...baseFields(), id, kind: "thinking", text: "reasoning..." };
}

function userMessage(id: string): TranscriptEntry {
  return { ...baseFields(), id, kind: "user-message", text: "hello" };
}

function toolCall(id: string): TranscriptEntry {
  const { epoch, seqStart, seqEnd, timestamp, provider } = baseFields();
  const row: TimelineRow = {
    id,
    epoch,
    seqStart,
    seqEnd,
    timestamp,
    provider,
    item: {
      type: "tool_call",
      callId: id,
      name: "bash",
      status: "running",
      error: null,
      detail: { type: "shell", command: "echo hi" },
    },
  };
  return buildTranscriptEntry(row);
}

function todo(id: string): TranscriptEntry {
  return { ...baseFields(), id, kind: "todo", items: [] };
}

function errorEntry(id: string): TranscriptEntry {
  return { ...baseFields(), id, kind: "error", message: "boom" };
}

describe("streamingTranscriptEntryId", () => {
  it("returns null when turnActive is false, even with a trailing assistant-message", () => {
    const entries = [assistantMessage("a1")];
    expect(streamingTranscriptEntryId(entries, false)).toBeNull();
  });

  it("returns the trailing assistant-message's id when turnActive is true", () => {
    const entries = [userMessage("u1"), assistantMessage("a1")];
    expect(streamingTranscriptEntryId(entries, true)).toBe("a1");
  });

  it("returns the trailing thinking entry's id when turnActive is true", () => {
    const entries = [userMessage("u1"), thinking("t1")];
    expect(streamingTranscriptEntryId(entries, true)).toBe("t1");
  });

  it("retires the previous caret: a tool-call after an assistant-message returns null, never the earlier assistant id", () => {
    const entries = [userMessage("u1"), assistantMessage("a1"), toolCall("call1")];
    const result = streamingTranscriptEntryId(entries, true);
    expect(result).toBeNull();
    expect(result).not.toBe("a1");
  });

  it("returns null for a trailing user-message", () => {
    const entries = [assistantMessage("a1"), userMessage("u2")];
    expect(streamingTranscriptEntryId(entries, true)).toBeNull();
  });

  it("returns null for a trailing todo entry", () => {
    const entries = [assistantMessage("a1"), todo("todo1")];
    expect(streamingTranscriptEntryId(entries, true)).toBeNull();
  });

  it("returns null for a trailing error entry", () => {
    const entries = [assistantMessage("a1"), errorEntry("err1")];
    expect(streamingTranscriptEntryId(entries, true)).toBeNull();
  });

  it("returns null for an empty list, regardless of turnActive", () => {
    expect(streamingTranscriptEntryId([], true)).toBeNull();
    expect(streamingTranscriptEntryId([], false)).toBeNull();
  });

  it("with two assistant-messages, only the last one's id is ever returned (at most one live line)", () => {
    const entries = [assistantMessage("a1"), userMessage("u1"), assistantMessage("a2")];
    const result = streamingTranscriptEntryId(entries, true);
    expect(result).toBe("a2");
    expect(result).not.toBe("a1");
  });
});
