/**
 * Tests for `transcript-search-model.ts` — the Android transcript find
 * state. Pure-model proof only (no `react-native` render, per this
 * feature's scope): query/cursor transitions, snapshot derivation over
 * core entries, and the shared count label. Scrolling and highlight land
 * in `transcript-window.tsx`, which owns the `FlatList` ref and is
 * covered by its own source-wiring tests.
 */
import { describe, expect, it } from "vitest";
import { timeline } from "@picompanion/frontend-core";

import {
  activeTranscriptSearchEntryId,
  createTranscriptSearchState,
  nextTranscriptSearchMatch,
  previousTranscriptSearchMatch,
  setTranscriptSearchQuery,
  transcriptSearchSnapshot,
} from "./transcript-search-model";

function message(id: string, text: string, seq = 1): timeline.TranscriptEntry {
  return {
    id,
    epoch: "epoch-1",
    seqStart: seq,
    seqEnd: seq,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    kind: "user-message",
    text,
  };
}

const ENTRIES: readonly timeline.TranscriptEntry[] = [
  message("u1", "Hello Pi", 1),
  message("a1", "Hi there, needle here", 2),
  message("t1", "a second needle", 3),
];

describe("transcript search state", () => {
  it("starts with no query and no cursor", () => {
    expect(createTranscriptSearchState()).toEqual({ query: "", currentIndex: 0 });
  });

  it("entering a query restarts the cursor at the first match", () => {
    const moved = nextTranscriptSearchMatch(
      setTranscriptSearchQuery(createTranscriptSearchState(), "needle"),
      2,
    );
    expect(moved.currentIndex).toBe(1);
    const restarted = setTranscriptSearchQuery(moved, "hello");
    expect(restarted).toEqual({ query: "hello", currentIndex: 0 });
  });

  it("steps forward and backward with wrap", () => {
    const state = setTranscriptSearchQuery(createTranscriptSearchState(), "needle");
    expect(nextTranscriptSearchMatch(state, 2).currentIndex).toBe(1);
    expect(nextTranscriptSearchMatch({ ...state, currentIndex: 1 }, 2).currentIndex).toBe(0);
    expect(previousTranscriptSearchMatch(state, 2).currentIndex).toBe(1);
  });

  it("a stale cursor clamps before stepping, never out of range", () => {
    const stale = { query: "needle", currentIndex: 99 };
    expect(nextTranscriptSearchMatch(stale, 2).currentIndex).toBe(0);
    expect(previousTranscriptSearchMatch(stale, 2).currentIndex).toBe(0);
  });
});

describe("transcriptSearchSnapshot", () => {
  it("is empty with no query", () => {
    const snapshot = transcriptSearchSnapshot(createTranscriptSearchState(), ENTRIES);
    expect(snapshot.matches).toEqual([]);
    expect(snapshot.currentIndex).toBe(-1);
    expect(snapshot.current).toBeNull();
    expect(snapshot.totalCount).toBe(0);
    expect(snapshot.matchedEntryCount).toBe(0);
    expect(snapshot.statusText).toBe("");
    expect(snapshot.hasMatches).toBe(false);
    expect(snapshot.activeKey).toBeNull();
  });

  it("derives matches, the active match, and the shared count label", () => {
    const snapshot = transcriptSearchSnapshot(
      setTranscriptSearchQuery(createTranscriptSearchState(), "needle"),
      ENTRIES,
    );
    expect(snapshot.totalCount).toBe(2);
    expect(snapshot.matchedEntryCount).toBe(2);
    expect(snapshot.currentIndex).toBe(0);
    expect(snapshot.current?.entryId).toBe("a1");
    expect(snapshot.statusText).toBe("1 of 2");
    expect(snapshot.hasMatches).toBe(true);
    expect(snapshot.activeKey).toBe("a1\n10");
  });

  it("follows the cursor through the match list", () => {
    const queried = setTranscriptSearchQuery(createTranscriptSearchState(), "needle");
    const snapshot = transcriptSearchSnapshot(
      nextTranscriptSearchMatch(queried, 2),
      ENTRIES,
    );
    expect(snapshot.currentIndex).toBe(1);
    expect(snapshot.current?.entryId).toBe("t1");
    expect(snapshot.statusText).toBe("2 of 2");
  });

  it("names no matches for a query with no hits", () => {
    const snapshot = transcriptSearchSnapshot(
      setTranscriptSearchQuery(createTranscriptSearchState(), "xyzzy"),
      ENTRIES,
    );
    expect(snapshot.totalCount).toBe(0);
    expect(snapshot.currentIndex).toBe(-1);
    expect(snapshot.statusText).toBe("No matches");
    expect(snapshot.hasMatches).toBe(false);
  });

  it("keeps the active key stable for the same match across re-derivation", () => {
    const state = setTranscriptSearchQuery(createTranscriptSearchState(), "needle");
    const first = transcriptSearchSnapshot(state, ENTRIES);
    const second = transcriptSearchSnapshot(state, ENTRIES);
    expect(second.activeKey).toBe(first.activeKey);
  });
});

describe("activeTranscriptSearchEntryId", () => {
  it("is the active match's entry id, or null with no match", () => {
    const live = transcriptSearchSnapshot(
      setTranscriptSearchQuery(createTranscriptSearchState(), "needle"),
      ENTRIES,
    );
    expect(activeTranscriptSearchEntryId(live)).toBe("a1");
    const empty = transcriptSearchSnapshot(createTranscriptSearchState(), ENTRIES);
    expect(activeTranscriptSearchEntryId(empty)).toBeNull();
  });
});
