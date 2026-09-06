import { describe, expect, it } from "vitest";

import type { timeline } from "@picompanion/frontend-core";

import {
  buildSessionTranscriptEntries,
  isSessionTranscriptEntry,
} from "./session-transcript-model";

function base(id: string, overrides: Partial<timeline.TranscriptEntryBase> = {}) {
  return {
    id,
    epoch: "epoch-1",
    seqStart: 0,
    seqEnd: 0,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    ...overrides,
  };
}

function userMessage(id: string, text: string): timeline.TranscriptEntry {
  return { ...base(id), kind: "user-message", text };
}

function assistantMessage(id: string, text: string): timeline.TranscriptEntry {
  return { ...base(id), kind: "assistant-message", text, corrected: false };
}

function thinking(id: string, text: string): timeline.TranscriptEntry {
  return { ...base(id), kind: "thinking", text };
}

function toolCall(id: string): timeline.TranscriptEntry {
  return {
    ...base(id),
    kind: "tool-call",
    tool: { id, name: "read_file", status: "completed" },
  } as unknown as timeline.TranscriptEntry;
}

function compaction(id: string): timeline.TranscriptEntry {
  return { ...base(id), kind: "compaction", status: "completed" };
}

describe("isSessionTranscriptEntry", () => {
  it("is true for user-message, assistant-message, thinking, and tool-call entries", () => {
    expect(isSessionTranscriptEntry(userMessage("1", "hi"))).toBe(true);
    expect(isSessionTranscriptEntry(assistantMessage("2", "hi"))).toBe(true);
    expect(isSessionTranscriptEntry(thinking("3", "hmm"))).toBe(true);
    expect(isSessionTranscriptEntry(toolCall("4"))).toBe(true);
  });

  it("is false for entry kinds this route has no row for", () => {
    expect(isSessionTranscriptEntry(compaction("5"))).toBe(false);
  });
});

describe("buildSessionTranscriptEntries", () => {
  it("interleaves message and thinking entries in the input's own order", () => {
    const entries: timeline.TranscriptEntry[] = [
      userMessage("1", "question"),
      thinking("2", "reasoning about it"),
      assistantMessage("3", "answer"),
    ];

    const result = buildSessionTranscriptEntries(entries);

    expect(result.map((entry) => entry.id)).toEqual(["1", "2", "3"]);
    expect(result.map((entry) => entry.kind)).toEqual([
      "user-message",
      "thinking",
      "assistant-message",
    ]);
  });

  it("keeps tool-call entries too, dropping only kinds it does not render, without disturbing the order of the kinds it keeps", () => {
    const entries: timeline.TranscriptEntry[] = [
      userMessage("1", "question"),
      toolCall("x1"),
      thinking("2", "reasoning"),
      compaction("x2"),
      assistantMessage("3", "answer"),
      thinking("4", "more reasoning"),
    ];

    const result = buildSessionTranscriptEntries(entries);

    expect(result.map((entry) => entry.id)).toEqual(["1", "x1", "2", "3", "4"]);
    expect(result.map((entry) => entry.kind)).toEqual([
      "user-message",
      "tool-call",
      "thinking",
      "assistant-message",
      "thinking",
    ]);
  });

  it("returns an empty list for an empty input", () => {
    expect(buildSessionTranscriptEntries([])).toEqual([]);
  });

  it("returns an empty list when every entry is a kind with no Android row", () => {
    const entries: timeline.TranscriptEntry[] = [compaction("x1"), compaction("x2")];
    expect(buildSessionTranscriptEntries(entries)).toEqual([]);
  });
});
