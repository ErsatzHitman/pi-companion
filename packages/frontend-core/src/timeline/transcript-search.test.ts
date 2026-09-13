/**
 * Tests for the transcript search model (`./transcript-search.ts`):
 * plain-text find over transcript entries — query matching,
 * case-insensitive default, match positions, next/prev navigation with
 * wrap, and match counts. No regex, no filters, no persistence — there
 * is nothing else to test by design.
 */
import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "./transcript-view.js";

import {
  countTranscriptSearchMatchedEntries,
  extractTranscriptSearchableText,
  findTranscriptSearchMatches,
  formatTranscriptSearchCount,
  nextTranscriptSearchIndex,
  previousTranscriptSearchIndex,
} from "./transcript-search.js";

function row(overrides: Record<string, unknown> & { kind: string; id: string }): TranscriptEntry {
  return {
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    ...overrides,
  } as TranscriptEntry;
}

function message(id: string, text: string, seq = 1): TranscriptEntry {
  return row({ kind: "user-message", id, seqStart: seq, seqEnd: seq, text });
}

describe("extractTranscriptSearchableText", () => {
  it("reads the visible text of message, thinking, and error entries", () => {
    expect(extractTranscriptSearchableText(message("u1", "hello"))).toBe("hello");
    expect(
      extractTranscriptSearchableText(
        row({ kind: "assistant-message", id: "a1", text: "hi", corrected: false }),
      ),
    ).toBe("hi");
    expect(extractTranscriptSearchableText(row({ kind: "thinking", id: "t1", text: "hmm" }))).toBe(
      "hmm",
    );
    expect(
      extractTranscriptSearchableText(row({ kind: "error", id: "e1", message: "boom" })),
    ).toBe("boom");
  });

  it("joins todo item texts", () => {
    const text = extractTranscriptSearchableText(
      row({
        kind: "todo",
        id: "todo1",
        items: [
          { text: "write tests", completed: false },
          { text: "read plan", completed: true },
        ],
      }),
    );
    expect(text).toContain("write tests");
    expect(text).toContain("read plan");
  });

  it("reads a tool call's names and payload text", () => {
    const text = extractTranscriptSearchableText(
      row({
        kind: "tool-call",
        id: "tc1",
        tool: {
          family: "shell",
          callId: "call-1",
          toolName: "bash",
          status: "completed",
          displayName: "Bash",
          updateCount: 1,
          command: "grep needle haystack",
          output: "found the needle here",
        },
      }),
    );
    expect(text).toContain("grep needle haystack");
    expect(text).toContain("found the needle here");
    expect(text).toContain("Bash");
  });

  it("reads a compaction entry's summary and file lists", () => {
    const text = extractTranscriptSearchableText(
      row({
        kind: "compaction",
        id: "c1",
        status: "completed",
        trigger: "auto",
        summary: "discussed the needle migration",
        filesModified: ["needle.ts"],
      }),
    );
    expect(text).toContain("discussed the needle migration");
    expect(text).toContain("needle.ts");
  });

  it("contributes nothing for an extension-snapshot entry, so it never matches", () => {
    const text = extractTranscriptSearchableText(
      row({
        kind: "extension-snapshot",
        id: "s1",
        state: {
          agentId: "agent-1",
          revision: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          elements: [],
        },
      }),
    );
    expect(text).toBe("");
  });

  it("contributes only the raw type for an unknown entry, never its payload", () => {
    const text = extractTranscriptSearchableText(
      row({ kind: "unknown", id: "x1", rawType: "future_thing", raw: { secret: "needle" } }),
    );
    expect(text).toBe("future_thing");
    expect(text).not.toContain("needle");
  });
});

describe("findTranscriptSearchMatches", () => {
  it("returns no matches for an empty query", () => {
    const entries = [message("u1", "hello")];
    expect(findTranscriptSearchMatches(entries, "")).toEqual([]);
  });

  it("matches case-insensitively by default", () => {
    const entries = [message("u1", "Hello Pi")];
    const matches = findTranscriptSearchMatches(entries, "hello");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ entryId: "u1", entryIndex: 0, start: 0, length: 5 });
  });

  it("matches case-sensitively when asked", () => {
    const entries = [message("u1", "Hello hello")];
    expect(findTranscriptSearchMatches(entries, "Hello", { caseSensitive: true })).toHaveLength(1);
    const matches = findTranscriptSearchMatches(entries, "hello", { caseSensitive: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ start: 6 });
  });

  it("reports every non-overlapping occurrence in entry and text order", () => {
    const entries = [message("u1", "aa aa", 1), message("u2", "Aa", 2)];
    const matches = findTranscriptSearchMatches(entries, "aa");
    expect(matches.map((match) => [match.entryIndex, match.start])).toEqual([
      [0, 0],
      [0, 3],
      [1, 0],
    ]);
    for (const match of matches) {
      expect(match.length).toBe(2);
    }
  });

  it("treats the query as plain text, never a pattern", () => {
    const entries = [message("u1", "a.c axc")];
    expect(findTranscriptSearchMatches(entries, "a.c")).toHaveLength(1);
  });

  it("carries the entry's stable list key for renderer scroll mapping", () => {
    const entries = [message("u1", "needle here")];
    const matches = findTranscriptSearchMatches(entries, "needle");
    expect(matches[0]?.entryKey).toBe("u1");
  });

  it("skips entries with no searchable text without failing", () => {
    const entries: TranscriptEntry[] = [
      row({
        kind: "extension-snapshot",
        id: "s1",
        state: {
          agentId: "agent-1",
          revision: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          elements: [],
        },
      }),
      message("u1", "needle", 2),
    ];
    const matches = findTranscriptSearchMatches(entries, "needle");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ entryId: "u1", entryIndex: 1 });
  });
});

describe("countTranscriptSearchMatchedEntries", () => {
  it("counts distinct entries, not occurrences", () => {
    const entries = [message("u1", "aa aa", 1), message("u2", "aa", 2)];
    const matches = findTranscriptSearchMatches(entries, "aa");
    expect(matches).toHaveLength(3);
    expect(countTranscriptSearchMatchedEntries(matches)).toBe(2);
  });

  it("is zero for no matches", () => {
    expect(countTranscriptSearchMatchedEntries([])).toBe(0);
  });
});

describe("next/previousTranscriptSearchIndex", () => {
  it("returns -1 when there is nothing to navigate to", () => {
    expect(nextTranscriptSearchIndex(0, 0)).toBe(-1);
    expect(previousTranscriptSearchIndex(0, 0)).toBe(-1);
  });

  it("starts at the first match from no current match", () => {
    expect(nextTranscriptSearchIndex(-1, 3)).toBe(0);
    expect(previousTranscriptSearchIndex(-1, 3)).toBe(0);
  });

  it("steps and wraps in both directions", () => {
    expect(nextTranscriptSearchIndex(0, 3)).toBe(1);
    expect(nextTranscriptSearchIndex(2, 3)).toBe(0);
    expect(previousTranscriptSearchIndex(0, 3)).toBe(2);
    expect(previousTranscriptSearchIndex(1, 3)).toBe(0);
  });
});

describe("formatTranscriptSearchCount", () => {
  it("is empty with no query, so the bar shows its placeholder instead", () => {
    expect(formatTranscriptSearchCount(-1, 0, "")).toBe("");
  });

  it("names no matches for a query with no hits", () => {
    expect(formatTranscriptSearchCount(-1, 0, "needle")).toBe("No matches");
  });

  it("reads 'N of M' one-based for a live match", () => {
    expect(formatTranscriptSearchCount(0, 3, "needle")).toBe("1 of 3");
    expect(formatTranscriptSearchCount(2, 3, "needle")).toBe("3 of 3");
  });
});
