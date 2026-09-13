/**
 * Transcript search state (plain-text find over the transcript) — view
 * model.
 *
 * The matching math itself lives in `@picompanion/frontend-core`'s
 * `timeline` domain (`findTranscriptSearchMatches`,
 * `next/previousTranscriptSearchIndex`,
 * `formatTranscriptSearchCount`); this module is only the reader's own
 * query/cursor state on top of it, kept free of any React Native import
 * (the same "all logic in a `-model.ts`" architecture
 * `transcript-window.tsx`'s own doc comment describes) so it is directly
 * unit-testable under this workspace's plain `vitest` setup.
 * `transcript-search-bar.tsx` is the thin native view over the snapshot
 * this module derives, and `transcript-window.tsx` owns scrolling to the
 * active match (it holds the `FlatList` ref) and highlighting its row.
 *
 * Plain-text search only, mirroring the core model exactly: no regex, no
 * filters, no persistence. Anything beyond that is a later task.
 */
import { timeline } from "@picompanion/frontend-core";

/** The reader's find state: what was typed, and which match is active. */
export interface TranscriptSearchState {
  readonly query: string;
  /** Cursor into the current match list. Clamped on read, never stored clamped. */
  readonly currentIndex: number;
}

export function createTranscriptSearchState(): TranscriptSearchState {
  return { query: "", currentIndex: 0 };
}

/**
 * Enters a new query. Restarts the cursor at the first match rather than
 * keeping a cursor into the previous result list.
 */
export function setTranscriptSearchQuery(
  state: TranscriptSearchState,
  query: string,
): TranscriptSearchState {
  return { ...state, query, currentIndex: 0 };
}

/** Steps the cursor to the next match, wrapping past the last one. */
export function nextTranscriptSearchMatch(
  state: TranscriptSearchState,
  totalCount: number,
): TranscriptSearchState {
  return {
    ...state,
    currentIndex: timeline.nextTranscriptSearchIndex(clampCursor(state, totalCount), totalCount),
  };
}

/** Steps the cursor to the previous match, wrapping past the first one. */
export function previousTranscriptSearchMatch(
  state: TranscriptSearchState,
  totalCount: number,
): TranscriptSearchState {
  return {
    ...state,
    currentIndex: timeline.previousTranscriptSearchIndex(
      clampCursor(state, totalCount),
      totalCount,
    ),
  };
}

function clampCursor(state: TranscriptSearchState, totalCount: number): number {
  if (totalCount <= 0) {
    return -1;
  }
  return Math.min(Math.max(0, state.currentIndex), totalCount - 1);
}

/** Everything `transcript-search-bar.tsx` renders, derived in one pass. */
export interface TranscriptSearchSnapshot {
  readonly query: string;
  readonly matches: readonly timeline.TranscriptSearchMatch[];
  /** `-1` when there is no current match (no query, or no hits). */
  readonly currentIndex: number;
  readonly current: timeline.TranscriptSearchMatch | null;
  readonly totalCount: number;
  readonly matchedEntryCount: number;
  /**
   * The one shared count label (`timeline.formatTranscriptSearchCount`):
   * `""` with no query, `"No matches"` with no hits, `"N of M"`
   * otherwise. The bar renders it as its live-region status text.
   */
  readonly statusText: string;
  readonly hasMatches: boolean;
  /** Stable across re-derivations that leave the match untouched — what
   * `transcript-window.tsx`'s scroll effect keys on, so a new row
   * elsewhere never re-scrolls to the same match. */
  readonly activeKey: string | null;
}

/**
 * Derives the snapshot for `state` over `entries`. Pure: the same state
 * and entries always produce the same snapshot.
 */
export function transcriptSearchSnapshot(
  state: TranscriptSearchState,
  entries: readonly timeline.TranscriptEntry[],
): TranscriptSearchSnapshot {
  const matches = timeline.findTranscriptSearchMatches(entries, state.query);
  const totalCount = matches.length;
  const currentIndex = totalCount === 0 ? -1 : clampCursor(state, totalCount);
  const current = currentIndex >= 0 ? (matches[currentIndex] ?? null) : null;
  return {
    query: state.query,
    matches,
    currentIndex,
    current,
    totalCount,
    matchedEntryCount: timeline.countTranscriptSearchMatchedEntries(matches),
    statusText: timeline.formatTranscriptSearchCount(currentIndex, totalCount, state.query),
    hasMatches: totalCount > 0,
    activeKey: current === null ? null : `${current.entryKey}\n${current.start}`,
  };
}

/**
 * The entry id of the active match, or `null` — what
 * `transcript-window.tsx` compares each rendered row against to decide
 * which row draws the highlight. A separate selector (rather than
 * reading `snapshot.current` inline) so the call site states the mapping
 * once, in words, instead of repeating `?.entryId ?? null` wherever a
 * highlight decision is needed.
 */
export function activeTranscriptSearchEntryId(snapshot: TranscriptSearchSnapshot): string | null {
  return snapshot.current?.entryId ?? null;
}
