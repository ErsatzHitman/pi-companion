/**
 * Incremental transcript projection (T388, plan.md §7.4, §14.5).
 *
 * `buildTranscriptEntries` (T28A1) is a pure, whole-list projection: every
 * call re-derives *every* entry from every visible row. That is exactly the
 * property that makes it easy to test and reason about, and exactly the
 * property that makes it the wrong thing to call on every 60 ms streaming
 * flush: a single appended delta re-runs `buildTranscriptEntry` — including
 * `buildToolCallViewModel` for every tool call in the session — once per row
 * in the list, so a 1,000-row session pays 1,000 row derivations to render
 * one new token.
 *
 * `TranscriptEntryProjector` keeps the same output but bounds that work. It
 * memoizes one entry per **source row object**, so a row the reducer did not
 * touch (the reducer is copy-on-write: an untouched row keeps its exact
 * object identity across an ingest — see `./reducer.ts`'s `rows.slice()`
 * paths) reuses the entry object it produced last time instead of being
 * re-derived. The projector exposes how many rows it actually re-derived
 * (`stats.computedCount`), which is the observable its test bounds: a
 * streaming append into a 1,000-row session re-derives at most the appended
 * row (and any row the same ingest mutated), never the whole list.
 *
 * Two things correctly invalidate the whole memo, and both are tracked
 * explicitly rather than left implicit:
 *
 * - `state.stale` changed: every entry carries that flag in its base fields,
 *   so a stale-tail flip legitimately rewrites all of them.
 * - `options.cwd` changed: it is forwarded to `buildToolCallViewModel` for
 *   every tool-call entry, so a different cwd legitimately rewrites those.
 *
 * The output is byte-compatible with `buildTranscriptEntries` for the same
 * state, which is what lets a caller swap one for the other: the projector
 * adds no field, drops no row, and reorders nothing.
 *
 * Repository invariant: this module must never import React, React Native,
 * Expo, DOM types, or browser globals.
 */
import { buildTranscriptEntry } from "./transcript-view.js";
import type { TranscriptEntry, TranscriptViewOptions } from "./transcript-view.js";
import { getVisibleTimelineRows } from "./reducer.js";
import type { TimelineRow, TimelineState } from "./types.js";

/** Per-projection counters. `computedCount + reusedCount === totalCount`
 * always. `computedCount` is the bounded quantity: it is the number of rows
 * `buildTranscriptEntry` actually ran for on the most recent `project`. */
export interface TranscriptProjectionStats {
  /** Rows re-derived on the most recent `project` call. */
  readonly computedCount: number;
  /** Rows whose previous entry object was reused verbatim. */
  readonly reusedCount: number;
  /** Total visible rows projected. */
  readonly totalCount: number;
  /** `true` when the most recent `project` call had to drop the whole memo
   * because `stale` or `cwd` changed (so every row was recomputed). */
  readonly cacheWasReset: boolean;
}

const EMPTY_STATS: TranscriptProjectionStats = {
  computedCount: 0,
  reusedCount: 0,
  totalCount: 0,
  cacheWasReset: false,
};

export interface TranscriptEntryProjectorOptions extends TranscriptViewOptions {
  /** Called after every `project` with that projection's counters. The one
   * hook a caller (or a test) needs to observe the bound without reaching
   * into the projector's private state. */
  readonly onProject?: (stats: TranscriptProjectionStats) => void;
}

/**
 * Stateful, memoizing wrapper around `buildTranscriptEntry`. One instance
 * per session view (its cache is only meaningful for one continuously
 * growing timeline); call `reset` when the session changes.
 */
export class TranscriptEntryProjector {
  private readonly onProject: TranscriptEntryProjectorOptions["onProject"];
  /** The view options the current cache was built under. `cwd` is mutable
   * (a session's agent cwd can resolve or change after mount), which is the
   * one reason the cache context can change for a live instance. */
  private viewOptions: TranscriptViewOptions;
  /** Row object identity -> the entry derived from it. A `Map` rather than a
   * `WeakMap` because the projector also needs `clear()` semantics on a
   * stale/cwd reset, and because the entries are strongly referenced by the
   * caller anyway. */
  private cache = new Map<TimelineRow, TranscriptEntry>();
  /** The `stale`/`cwd` pair the current cache was built under. */
  private cacheContext: string | null = null;
  private stats: TranscriptProjectionStats = EMPTY_STATS;

  constructor(options: TranscriptEntryProjectorOptions = {}) {
    this.onProject = options.onProject;
    this.viewOptions = options.cwd !== undefined ? { cwd: options.cwd } : {};
  }

  /** Updates the working directory forwarded to `buildToolCallViewModel`.
   * A no-op when unchanged; otherwise drops the memo, since every tool-call
   * entry legitimately changes. */
  setCwd(cwd: string | undefined): void {
    if (cwd === this.viewOptions.cwd) {
      return;
    }
    this.viewOptions = cwd !== undefined ? { cwd } : {};
    this.reset();
  }

  /** The most recent projection's counters. */
  getStats(): TranscriptProjectionStats {
    return this.stats;
  }

  /** Drops the memo. The next `project` re-derives every row. */
  reset(): void {
    this.cache = new Map();
    this.cacheContext = null;
    this.stats = EMPTY_STATS;
  }

  /**
   * Projects `state` to entries exactly as `buildTranscriptEntries(state,
   * options)` would, reusing the previous entry object for every row the
   * reducer left untouched. Never mutates `state`, never mutates a
   * previously returned entry.
   */
  project(state: TimelineState): TranscriptEntry[] {
    const cwd = this.viewOptions.cwd ?? "";
    const context = `${state.stale ? "stale" : "fresh"}\u0000${cwd}`;
    const cacheWasReset = this.cacheContext !== context;
    if (cacheWasReset) {
      this.cache = new Map();
      this.cacheContext = context;
    }

    const rows = getVisibleTimelineRows(state);
    const entries: TranscriptEntry[] = new Array(rows.length);
    let computedCount = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] as TimelineRow;
      const cached = this.cache.get(row);
      if (cached !== undefined) {
        entries[index] = cached;
        continue;
      }
      const entry = buildTranscriptEntry(row, state.stale, this.viewOptions);
      this.cache.set(row, entry);
      entries[index] = entry;
      computedCount += 1;
    }

    this.stats = {
      computedCount,
      reusedCount: rows.length - computedCount,
      totalCount: rows.length,
      cacheWasReset,
    };
    this.onProject?.(this.stats);
    return entries;
  }
}
