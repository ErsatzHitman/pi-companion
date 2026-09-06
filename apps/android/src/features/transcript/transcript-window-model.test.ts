import { describe, expect, it } from "vitest";

import {
  createTranscriptWindow,
  isNearBottom,
  type TranscriptScrollMetrics,
  type TranscriptWindowEntry,
} from "./transcript-window-model";

interface FakeEntry extends TranscriptWindowEntry {
  readonly id: string;
  readonly seq: number;
}

function entry(seq: number): FakeEntry {
  return { id: `row-${seq}`, seq };
}

function entriesUpTo(count: number): FakeEntry[] {
  return Array.from({ length: count }, (_, i) => entry(i));
}

const NEAR_BOTTOM: TranscriptScrollMetrics = {
  contentOffsetY: 900,
  contentHeight: 1000,
  viewportHeight: 100,
};
const SCROLLED_UP: TranscriptScrollMetrics = {
  contentOffsetY: 0,
  contentHeight: 5000,
  viewportHeight: 100,
};

describe("isNearBottom", () => {
  it("is true within the threshold and false past it", () => {
    expect(
      isNearBottom({ contentOffsetY: 900, contentHeight: 1000, viewportHeight: 100 }, 96),
    ).toBe(true);
    expect(
      isNearBottom({ contentOffsetY: 800, contentHeight: 1000, viewportHeight: 100 }, 96),
    ).toBe(false);
  });
});

describe("bounded window: O(window), not O(session)", () => {
  it("never returns more than maxWindowRows regardless of session size", () => {
    const window = createTranscriptWindow<FakeEntry>({
      maxWindowRows: 50,
      followTailThresholdPx: 96,
    });
    for (const count of [1, 10, 49, 50, 51, 300, 5_000, 10_000]) {
      const snapshot = window.applyEntries(entriesUpTo(count));
      expect(snapshot.windowedEntries.length).toBeLessThanOrEqual(50);
    }
  });

  it("asserts the exact retained-row count and hidden-older count at 10,000 rows", () => {
    const window = createTranscriptWindow<FakeEntry>({
      maxWindowRows: 50,
      followTailThresholdPx: 96,
    });
    const snapshot = window.applyEntries(entriesUpTo(10_000));
    expect(snapshot.windowedEntries.length).toBe(50);
    expect(snapshot.hiddenOlderCount).toBe(10_000 - 50);
    // The window is the true tail, not an arbitrary 50 rows.
    expect(snapshot.windowedEntries[0]?.seq).toBe(9_950);
    expect(snapshot.windowedEntries[49]?.seq).toBe(9_999);
  });

  it("windowing preserves entry object identity (never mutates or clones what it renders)", () => {
    const window = createTranscriptWindow<FakeEntry>({
      maxWindowRows: 10,
      followTailThresholdPx: 96,
    });
    const all = entriesUpTo(20);
    const snapshot = window.applyEntries(all);
    expect(snapshot.windowedEntries[0]).toBe(all[10]);
    expect(snapshot.windowedEntries[9]).toBe(all[19]);
  });

  it("per-append cost does not scale with session length (perf smoke check)", () => {
    // Not a hard real-time guarantee (CI timing varies) -- a generous
    // multiplier just to catch an accidental O(session) regression (e.g.
    // re-scanning or re-copying the whole entries array per call).
    const window = createTranscriptWindow<FakeEntry>({
      maxWindowRows: 50,
      followTailThresholdPx: 96,
    });
    const early = entriesUpTo(50);
    const startEarly = performance.now();
    for (let i = 0; i < 500; i += 1) {
      window.applyEntries(early);
    }
    const earlyMs = performance.now() - startEarly;

    const huge = entriesUpTo(100_000);
    const startHuge = performance.now();
    for (let i = 0; i < 500; i += 1) {
      window.applyEntries(huge);
    }
    const hugeMs = performance.now() - startHuge;

    expect(hugeMs).toBeLessThan(Math.max(50, earlyMs * 15));
  });
});

describe("streaming flood: bounded even when rows arrive faster than consumed", () => {
  it("stays at maxWindowRows through a tight flood of appends while following the tail", () => {
    const window = createTranscriptWindow<FakeEntry>({
      maxWindowRows: 25,
      followTailThresholdPx: 96,
    });
    let all: FakeEntry[] = [];
    for (let i = 0; i < 5_000; i += 1) {
      all = [...all, entry(i)];
      const snapshot = window.applyEntries(all);
      expect(snapshot.windowedEntries.length).toBeLessThanOrEqual(25);
    }
    const final = window.getSnapshot();
    expect(final.windowedEntries.length).toBe(25);
    expect(final.windowedEntries[24]?.seq).toBe(4_999);
  });

  it("scrolled-up flood: window stays pinned (bounded, unchanged) and unreadCount accumulates exactly", () => {
    const window = createTranscriptWindow<FakeEntry>({
      maxWindowRows: 25,
      followTailThresholdPx: 96,
    });
    window.applyEntries(entriesUpTo(100));
    window.onScroll(SCROLLED_UP); // leaves the tail
    const pinned = window.getSnapshot();
    expect(pinned.followTail).toBe(false);

    let all = entriesUpTo(100);
    for (let i = 100; i < 5_100; i += 1) {
      all = [...all, entry(i)];
      const snapshot = window.applyEntries(all);
      expect(snapshot.windowedEntries.length).toBeLessThanOrEqual(25);
      // Stated policy: while scrolled away, the window never grows and
      // stays anchored to the same rows -- flood entries are counted
      // (unreadCount), never buffered into the render window.
      expect(snapshot.windowedEntries.map((e) => e.id)).toEqual(
        pinned.windowedEntries.map((e) => e.id),
      );
    }
    const final = window.getSnapshot();
    expect(final.unreadCount).toBe(5_000);
  });
});

describe("follow-tail interleavings", () => {
  it("at-tail + new message: follows (shouldScrollToTail true, unreadCount 0)", () => {
    const window = createTranscriptWindow<FakeEntry>();
    window.applyEntries(entriesUpTo(5));
    const snapshot = window.applyEntries(entriesUpTo(6));
    expect(snapshot.followTail).toBe(true);
    expect(snapshot.shouldScrollToTail).toBe(true);
    expect(snapshot.unreadCount).toBe(0);
  });

  it("first mount forces a scroll-to-tail even though the tail entry did not 'change'", () => {
    const window = createTranscriptWindow<FakeEntry>();
    const snapshot = window.applyEntries(entriesUpTo(3));
    expect(snapshot.shouldScrollToTail).toBe(true);
  });

  it("scrolled-up + new message: does NOT jump, and unreadCount (the affordance) appears", () => {
    const window = createTranscriptWindow<FakeEntry>();
    window.applyEntries(entriesUpTo(5));
    window.onScroll(SCROLLED_UP);
    const snapshot = window.applyEntries(entriesUpTo(7));
    expect(snapshot.followTail).toBe(false);
    expect(snapshot.shouldScrollToTail).toBe(false);
    expect(snapshot.unreadCount).toBe(2);
  });

  it("scrolled-up -> user scrolls back to the tail themselves: follow resumes and the affordance clears", () => {
    const window = createTranscriptWindow<FakeEntry>();
    window.applyEntries(entriesUpTo(5));
    window.onScroll(SCROLLED_UP);
    window.applyEntries(entriesUpTo(8));
    expect(window.getSnapshot().unreadCount).toBe(3);

    const resumed = window.onScroll(NEAR_BOTTOM);
    expect(resumed.followTail).toBe(true);
    expect(resumed.unreadCount).toBe(0);
  });

  it("scrolled-up -> explicit returnToTail(): follow resumes, unread clears, and a scroll is requested", () => {
    const window = createTranscriptWindow<FakeEntry>();
    window.applyEntries(entriesUpTo(5));
    window.onScroll(SCROLLED_UP);
    window.applyEntries(entriesUpTo(9));

    const snapshot = window.returnToTail();
    expect(snapshot.followTail).toBe(true);
    expect(snapshot.unreadCount).toBe(0);
    expect(snapshot.shouldScrollToTail).toBe(true);
    expect(snapshot.windowedEntries[snapshot.windowedEntries.length - 1]?.seq).toBe(8);
  });

  it("a message arriving DURING a scroll gesture: followTail may stay true, but shouldScrollToTail stays false", () => {
    const window = createTranscriptWindow<FakeEntry>();
    window.applyEntries(entriesUpTo(5));
    window.onScroll(NEAR_BOTTOM); // still at the tail
    window.setScrolling(true); // the reader's finger is down, mid-gesture

    const duringGesture = window.applyEntries(entriesUpTo(6));
    expect(duringGesture.followTail).toBe(true);
    expect(duringGesture.shouldScrollToTail).toBe(false); // must not fight the gesture

    window.setScrolling(false); // gesture settles, still at the bottom per the last known metrics
    const afterGesture = window.applyEntries(entriesUpTo(7));
    expect(afterGesture.followTail).toBe(true);
    expect(afterGesture.shouldScrollToTail).toBe(true); // now safe to scroll
  });

  it("a scroll gesture that moves the reader away from the tail leaves follow immediately, even mid-drag", () => {
    const window = createTranscriptWindow<FakeEntry>();
    window.applyEntries(entriesUpTo(5));
    window.setScrolling(true);
    const duringDrag = window.onScroll(SCROLLED_UP);
    expect(duringDrag.followTail).toBe(false); // does not wait for the gesture to end
  });

  it("a settle-at-bottom with isScrolling already false (no further onScroll sample) still resumes follow via setScrolling(false)", () => {
    const window = createTranscriptWindow<FakeEntry>();
    window.applyEntries(entriesUpTo(5));
    window.onScroll(SCROLLED_UP);
    window.setScrolling(true);
    window.onScroll(NEAR_BOTTOM); // near bottom, but still mid-gesture -- must not resume yet
    expect(window.getSnapshot().followTail).toBe(false);

    const settled = window.setScrolling(false); // gesture ends exactly at rest; no further onScroll fires
    expect(settled.followTail).toBe(true);
  });
});

describe("expandOlder: the reachability affordance for anything windowed out", () => {
  it("grows the window backward and shrinks hiddenOlderCount by the same amount", () => {
    const window = createTranscriptWindow<FakeEntry>({
      maxWindowRows: 20,
      followTailThresholdPx: 96,
    });
    window.applyEntries(entriesUpTo(200));
    const before = window.getSnapshot();
    expect(before.hiddenOlderCount).toBe(180);

    const after = window.expandOlder(20);
    expect(after.hiddenOlderCount).toBe(160);
    expect(after.windowedEntries.length).toBeLessThanOrEqual(20);
    expect(after.followTail).toBe(false);
  });

  it("clamps at the start of the stream rather than going negative", () => {
    const window = createTranscriptWindow<FakeEntry>({
      maxWindowRows: 20,
      followTailThresholdPx: 96,
    });
    window.applyEntries(entriesUpTo(30));
    window.expandOlder(1_000);
    const snapshot = window.getSnapshot();
    expect(snapshot.hiddenOlderCount).toBe(0);
    expect(snapshot.windowedEntries[0]?.seq).toBe(0);
  });
});
