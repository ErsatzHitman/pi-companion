/**
 * Transcript virtualization window (T33A6; plan.md §14.5 "transcript:
 * 10,000 timeline items without rendering more than a bounded window",
 * §9.2/§9.3 compact session layout).
 *
 * `transcript-message-batcher.ts` already hands a caller a full,
 * time-ordered `CoreMessageEntry[]`/`TranscriptEntry[]` on every applied
 * batch — batched to one apply per frame tick, but still the *whole*
 * session's rows every time (`SessionTranscript` in `app/h/[serverId]/
 * session/[agentId]/index.tsx` re-derives it fresh from
 * `batcher.getState()` on every subscription callback, and renders every
 * one of them into a plain `ScrollView`). This module sits on top of
 * that: it never talks to the batcher, the daemon, or `react-native` —
 * it is a pure reducer over whatever entry array a caller hands it,
 * bounding what should actually be rendered to a fixed-size window
 * regardless of how large that array grows, and tracking the
 * scroll-follow ("follow-tail") state a real chat transcript needs.
 *
 * Mirrors `apps/web/src/features/transcript/transcript.tsx`'s vocabulary
 * on purpose (`FOLLOW_TAIL_THRESHOLD_PX`/`isNearBottom`, "the reader is
 * near the bottom", "follows unconditionally the first time") rather than
 * inventing a second one — the two platforms solve the identical product
 * requirement with different mechanics (`@tanstack/react-virtual`'s DOM
 * measurement there, this hand-rolled reducer here, because Android has
 * no DOM and `@shopify/flash-list` is not installed — see this task's
 * report for the exact install command and why an injected-port model was
 * chosen instead of blocking on it).
 *
 * ## The two properties this task must prove
 *
 * **Bounded window.** `applyEntries` never returns more than
 * `config.maxWindowRows` entries, no matter how large the array passed in
 * is — a 10,000-row session and a 10-row session cost the same
 * `O(maxWindowRows)` slice, not `O(session)`. See
 * `transcript-window-model.test.ts`'s "bounded window" and "streaming
 * flood" suites for the asserted numbers.
 *
 * **Stated flood policy.** While following the tail, the window is
 * always exactly the newest `maxWindowRows` entries — older rows fall out
 * of the *render* window (never out of the caller's own data; nothing
 * here deletes anything upstream) the instant a newer one arrives, the
 * same "drop the oldest, never buffer without limit" shape
 * `../terminal/terminal-output-buffer.ts`'s hard cap uses for exactly the
 * same reason. While scrolled away from the tail, the window is pinned to
 * the reader's own anchor and does not grow no matter how many new rows
 * arrive — they are counted (`unreadCount`), not rendered, until the
 * reader asks to see them (`returnToTail`/reaching the bottom
 * themselves). Nothing is ever buffered without a bound in either state.
 *
 * ## Follow-tail state machine
 *
 * `followTail` starts `true` (a freshly opened session opens at its most
 * recent message, like any chat surface — mirrors web's
 * `hasAnchoredTailRef` unconditional first follow). It becomes `false`
 * the moment `onScroll` reports geometry that is not near the bottom
 * (`isNearBottom`, mirroring web's `FOLLOW_TAIL_THRESHOLD_PX`) — this
 * happens immediately, even mid-gesture, so a message arriving while the
 * reader is actively scrolling up can never re-pin them to the bottom out
 * from under their thumb. It becomes `true` again either explicitly
 * (`returnToTail`, e.g. a "Jump to latest" tap) or when `onScroll`
 * reports near-bottom geometry while `isScrolling` is `false` — resuming
 * follow is deliberately gated on the gesture having *settled*, not on
 * any single `onScroll` sample, so a mid-drag bounce near the bottom edge
 * cannot resume follow before the reader has actually let go.
 *
 * `shouldScrollToTail` on the returned snapshot is the one field a caller
 * needs to decide whether to imperatively scroll (`FlatList.scrollToEnd`)
 * this pass — `true` only when `followTail` is `true`, `isScrolling` is
 * `false`, and the tail entry actually changed (a new row, or a streaming
 * delta replacing the previous tail's object per plan.md §7.4's
 * delta-based-end-to-end contract — the same "new object per streamed
 * delta" assumption `message-row-model.ts`'s `areMessageRowPropsEqual`
 * doc comment relies on). This is the guard for the "message arriving
 * during a scroll gesture" interleaving: `followTail` can stay `true`
 * throughout a small in-place drag, but `shouldScrollToTail` stays
 * `false` for every `applyEntries` call made while `isScrolling` is
 * `true`, so nothing fights the reader's own gesture.
 *
 * ## Reachability for anything windowed out
 *
 * `hiddenOlderCount` names how many entries exist before the current
 * window (whether because the reader is following the tail and the
 * session has grown past `maxWindowRows`, or because they have scrolled
 * up and the window is anchored mid-session). `expandOlder` is the one
 * affordance that grows the window backward to reveal more of them — the
 * same control a sighted reader taps and a screen reader reaches through
 * (see `transcript-window.tsx`'s "Show N earlier" button), never a
 * sighted-only scroll gesture with no equivalent. `unreadCount` is the
 * matching affordance at the newest edge: entries appended while
 * `followTail` is `false`, reachable via the same `returnToTail` a
 * sighted reader's "N new messages" tap and a screen reader's identical
 * button both call.
 */

/** The one shape this module requires of an entry — deliberately generic
 * rather than importing `CoreMessageEntry`/`SessionTranscriptEntry`: this
 * window has no opinion on *which* `TranscriptEntry` kinds a caller
 * renders, only on how many of them it keeps mounted. */
export interface TranscriptWindowEntry {
  readonly id: string;
}

export interface TranscriptWindowConfig {
  /** Hard cap on rows the window ever returns for render — the O(window)
   * bound this task proves, independent of total session size. */
  readonly maxWindowRows: number;
  /** How close to the bottom (px) counts as "at the tail" — same
   * semantics and default magnitude as web's `FOLLOW_TAIL_THRESHOLD_PX`. */
  readonly followTailThresholdPx: number;
}

/** 200 mirrors this app's own `INITIAL_TIMELINE_OPTIONS` `limit: 200`
 * page size (cited in web's `transcript.tsx` doc comment as the unit the
 * daemon already pages a long session in on the wire) — a window this
 * size covers a full resumed page without ever approaching the §14.5
 * 10,000-item budget this exists to hold to. */
export const DEFAULT_TRANSCRIPT_WINDOW_CONFIG: TranscriptWindowConfig = {
  maxWindowRows: 200,
  followTailThresholdPx: 96,
};

/** Framework-neutral scroll geometry — the fields `FlatList`'s `onScroll`
 * event carries (`contentOffset.y`, `contentSize.height`,
 * `layoutMeasurement.height`), renamed so this module never imports
 * `react-native`'s event types. */
export interface TranscriptScrollMetrics {
  readonly contentOffsetY: number;
  readonly contentHeight: number;
  readonly viewportHeight: number;
}

/** Same formula as web's `isNearBottom` (DOM `scrollHeight - scrollTop -
 * clientHeight`), restated over the RN-shaped fields above. */
export function isNearBottom(metrics: TranscriptScrollMetrics, thresholdPx: number): boolean {
  return metrics.contentHeight - metrics.contentOffsetY - metrics.viewportHeight <= thresholdPx;
}

export interface TranscriptWindowSnapshot<T extends TranscriptWindowEntry> {
  /** Bounded rows to render — `length` never exceeds
   * `config.maxWindowRows`, regardless of how many entries were applied. */
  readonly windowedEntries: readonly T[];
  /** Whether the window is currently pinned to the newest entry. */
  readonly followTail: boolean;
  /** Entries appended to the full stream since the reader last left the
   * tail. Always `0` while `followTail` is `true`. */
  readonly unreadCount: number;
  /** `true` exactly when this pass should perform a fresh scroll-to-tail
   * — see this module's doc comment's "Follow-tail state machine". */
  readonly shouldScrollToTail: boolean;
  /** Entries that exist upstream before the current window — the count
   * `expandOlder`'s affordance should announce. */
  readonly hiddenOlderCount: number;
}

const EMPTY_SNAPSHOT: TranscriptWindowSnapshot<never> = {
  windowedEntries: [],
  followTail: true,
  unreadCount: 0,
  shouldScrollToTail: false,
  hiddenOlderCount: 0,
};

export interface TranscriptWindow<T extends TranscriptWindowEntry> {
  /**
   * Applies the latest full, authoritative entries list (as a caller
   * would read fresh off `batcher.getState()` on every applied batch) and
   * returns the next bounded snapshot. Does `O(config.maxWindowRows)`
   * work building the returned window (a single bounded `Array.prototype
   * .slice`), never `O(entries.length)` — see this module's doc comment
   * and `transcript-window-model.test.ts`'s bound suites for the proof.
   */
  applyEntries(entries: readonly T[]): TranscriptWindowSnapshot<T>;
  /** Reports fresh scroll geometry (`FlatList`'s `onScroll`). Updates
   * `followTail`/`unreadCount` from geometry alone; does not itself
   * change which entries are windowed beyond re-deriving the current
   * snapshot from the entries already applied. */
  onScroll(metrics: TranscriptScrollMetrics): TranscriptWindowSnapshot<T>;
  /** Marks whether an active drag/momentum gesture is in progress. See
   * "Follow-tail state machine" above for exactly what this gates. */
  setScrolling(isScrolling: boolean): TranscriptWindowSnapshot<T>;
  /** Explicit "return to tail" (a "Jump to latest" tap, or any other
   * caller-driven reason to resume following) — always requests a fresh
   * scroll-to-tail regardless of `isScrolling`, since this call is itself
   * the reader's request to jump. */
  returnToTail(): TranscriptWindowSnapshot<T>;
  /** Grows the window backward by `count` rows (default one full window),
   * revealing more of `hiddenOlderCount`'s entries — the reachability
   * affordance for anything windowed out at the old edge. Leaves the tail
   * (`followTail` becomes `false`) if it was `true`, since expanding
   * backward from the tail necessarily stops pinning to it. */
  expandOlder(count?: number): TranscriptWindowSnapshot<T>;
  /** The most recently computed snapshot, without recomputation. */
  getSnapshot(): TranscriptWindowSnapshot<T>;
}

export function createTranscriptWindow<T extends TranscriptWindowEntry>(
  config: TranscriptWindowConfig = DEFAULT_TRANSCRIPT_WINDOW_CONFIG,
): TranscriptWindow<T> {
  const maxWindowRows = Math.max(1, config.maxWindowRows);

  let entries: readonly T[] = [];
  let followTail = true;
  let isScrolling = false;
  /** `entries.length` as of the last moment `followTail` was `true` —
   * the baseline `unreadCount` is measured from. */
  let tailLengthAtLastFollow = 0;
  /** Window start index while `!followTail`. `null` exactly when
   * `followTail` is `true` (the window is always tail-anchored then, so
   * no fixed start is tracked). */
  let anchorStart: number | null = null;
  let lastMetrics: TranscriptScrollMetrics | null = null;
  let lastSnapshot: TranscriptWindowSnapshot<T> = EMPTY_SNAPSHOT as TranscriptWindowSnapshot<T>;

  function recompute(forceScroll: boolean): TranscriptWindowSnapshot<T> {
    const len = entries.length;
    let windowedEntries: readonly T[];
    let hiddenOlderCount: number;

    if (followTail) {
      const start = Math.max(0, len - maxWindowRows);
      windowedEntries = entries.slice(start, len);
      hiddenOlderCount = start;
    } else {
      const start = Math.min(anchorStart ?? Math.max(0, len - maxWindowRows), Math.max(0, len - 1));
      const end = Math.min(len, start + maxWindowRows);
      windowedEntries = entries.slice(start, end);
      hiddenOlderCount = start;
    }

    const unreadCount = followTail ? 0 : Math.max(0, len - tailLengthAtLastFollow);
    const shouldScrollToTail = followTail && !isScrolling && forceScroll && len > 0;

    lastSnapshot = {
      windowedEntries,
      followTail,
      unreadCount,
      shouldScrollToTail,
      hiddenOlderCount,
    };
    return lastSnapshot;
  }

  function leaveTailIfScrolledAway(): void {
    if (followTail) {
      followTail = false;
      anchorStart = Math.max(0, entries.length - maxWindowRows);
      tailLengthAtLastFollow = entries.length;
    }
  }

  function resumeTail(): void {
    followTail = true;
    anchorStart = null;
    tailLengthAtLastFollow = entries.length;
  }

  return {
    applyEntries(next) {
      const previous = entries;
      const tailChanged =
        next.length > 0 &&
        (next.length !== previous.length ||
          next[next.length - 1] !== previous[previous.length - 1]);
      entries = next;
      if (followTail) {
        // Keep the baseline in lockstep so leaving the tail later starts
        // `unreadCount` from zero, not from whatever it was pre-mount.
        tailLengthAtLastFollow = next.length;
      }
      return recompute(tailChanged);
    },

    onScroll(metrics) {
      lastMetrics = metrics;
      const nearBottom = isNearBottom(metrics, config.followTailThresholdPx);
      if (followTail && !nearBottom) {
        leaveTailIfScrolledAway();
      } else if (!followTail && nearBottom && !isScrolling) {
        resumeTail();
      }
      return recompute(false);
    },

    setScrolling(nextIsScrolling) {
      isScrolling = nextIsScrolling;
      if (
        !isScrolling &&
        !followTail &&
        lastMetrics &&
        isNearBottom(lastMetrics, config.followTailThresholdPx)
      ) {
        // The gesture just settled with the reader at the bottom edge —
        // resume follow now rather than waiting for another onScroll
        // sample that may never come (a drag that ends exactly at rest
        // fires no further scroll event in a real ScrollView).
        resumeTail();
      }
      return recompute(false);
    },

    returnToTail() {
      resumeTail();
      return recompute(true);
    },

    expandOlder(count = maxWindowRows) {
      if (followTail) {
        leaveTailIfScrolledAway();
      }
      anchorStart = Math.max(0, (anchorStart ?? 0) - Math.max(0, count));
      return recompute(false);
    },

    getSnapshot() {
      return lastSnapshot;
    },
  };
}
