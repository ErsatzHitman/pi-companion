/**
 * T37B's two provable acceptance criteria:
 *
 * 1. "Cached data is visibly marked stale until catch-up, asserted by
 *    unit tests against the shared `frontend-core` fixtures" — proven
 *    below by restoring a cached tail and checking both staleness
 *    dimensions (`./timeline-cache.ts`'s doc comment) read `stale:
 *    true` before any catch-up, and `false` only after
 *    `confirmTimelineCatchUp`.
 * 2. "Catch-up reconciles without duplicates" — proven by replaying an
 *    overlapping window (the exact same backfill page redelivered) and
 *    a gapped window (two disjoint backfill pages, applied and then
 *    replayed out of order) through the REAL, imported
 *    `timeline.ingestTimelineWindow` — this file reimplements no
 *    dedupe or gap logic of its own.
 *
 * Uses `testing.loadRecordedSessionChapter("gapRecovery")` — the shared
 * `frontend-core` fixture that reuses `timeline/fixtures/scenarios/
 * gap-backfill.ts` (T20B) — for every row and window in this file, so
 * nothing here is a fabricated ad hoc scenario.
 */
import { testing as coreTesting, timeline as coreTimeline } from "@picompanion/frontend-core";
import { WSOutboundMessageSchema } from "@picompanion/protocol/messages";
import type {
  AgentStreamMessage,
  FetchAgentTimelineResponseMessage,
} from "@picompanion/protocol/messages";
import { describe, expect, it } from "vitest";

import { describeTimelineStaleness } from "./stale-announcement.js";
import { InMemorySqliteDriver } from "./in-memory-sqlite-driver.js";
import { SqliteStructuredStorage } from "./sqlite-structured-storage.js";
import {
  cacheTimelineTail,
  confirmTimelineCatchUp,
  createTimelineCache,
  loadTimelineCacheEnvelope,
  restoreTimelineTail,
} from "./timeline-cache.js";

class ManualClock {
  constructor(private currentMs: number) {}
  now(): number {
    return this.currentMs;
  }
  setTimeout(): never {
    throw new Error("ManualClock.setTimeout is not implemented; this test double is now-only.");
  }
  clearTimeout(): never {
    throw new Error("ManualClock.clearTimeout is not implemented; this test double is now-only.");
  }
  setInterval(): never {
    throw new Error("ManualClock.setInterval is not implemented; this test double is now-only.");
  }
  clearInterval(): never {
    throw new Error("ManualClock.clearInterval is not implemented; this test double is now-only.");
  }
  advance(deltaMs: number): void {
    this.currentMs += deltaMs;
  }
}

/** Validates a fixture frame through the real wire schema and extracts its `agent_stream` message. */
function agentStreamFrame(frame: { message: unknown }): AgentStreamMessage {
  const parsed = WSOutboundMessageSchema.parse(frame.message);
  if (parsed.type !== "session" || parsed.message.type !== "agent_stream") {
    throw new Error(`expected an agent_stream frame, got ${parsed.type}`);
  }
  return parsed.message;
}

/** Validates a fixture frame through the real wire schema and extracts its `fetch_agent_timeline_response` message. */
function catchUpWindowFrame(frame: { message: unknown }): FetchAgentTimelineResponseMessage {
  const parsed = WSOutboundMessageSchema.parse(frame.message);
  if (parsed.type !== "session" || parsed.message.type !== "fetch_agent_timeline_response") {
    throw new Error(`expected a fetch_agent_timeline_response frame, got ${parsed.type}`);
  }
  return parsed.message;
}

function frame(frames: readonly coreTesting.FixtureFrame[], id: string): coreTesting.FixtureFrame {
  const found = frames.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`fixture regression: no frame "${id}" in the gapRecovery chapter`);
  }
  return found;
}

function noDuplicateIds(rows: readonly coreTimeline.TimelineRow[]): void {
  const ids = rows.map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);
}

describe("timeline cache: stale until catch-up, reconciled without duplicates (gapRecovery fixture)", () => {
  const chapter = coreTesting.loadRecordedSessionChapter("gapRecovery");

  const liveSeq10 = agentStreamFrame(frame(chapter.frames, "live-seq-10"));
  const liveSeq20 = agentStreamFrame(frame(chapter.frames, "live-seq-20"));
  const page1 = catchUpWindowFrame(frame(chapter.frames, "gap-backfill-page-1"));
  const page2 = catchUpWindowFrame(frame(chapter.frames, "gap-backfill-page-2"));

  function buildCache() {
    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(10_000);
    return { driver, clock };
  }

  it("restoring a cached tail is stale (reducer level) with the gap it left off with, before any catch-up", async () => {
    // Sanity: this really is the shared gap-backfill fixture, not a fabricated one.
    expect(chapter.frames.map((f) => f.id)).toEqual([
      "live-seq-10",
      "live-seq-20",
      "gap-backfill-page-1",
      "gap-backfill-page-2",
    ]);

    const { driver, clock } = buildCache();
    const storage = new SqliteStructuredStorage({ driver });
    const cache = createTimelineCache(storage, clock);

    // Live streaming opened a gap (seq 10 then a jump to seq 20); cache the
    // tail as it stood right then, as a cold-start/reconnect snapshot would.
    let live = coreTimeline.ingestAgentStreamMessage(
      coreTimeline.createEmptyTimelineState(),
      liveSeq10,
    );
    live = coreTimeline.ingestAgentStreamMessage(live, liveSeq20);
    expect(live.gap).toEqual({ epoch: "epoch-t20b-0001", fromSeq: 11, toSeq: 19 });
    await cacheTimelineTail(cache, "agt_fixture_t20b_0001", live);

    // Simulate app restart: a fresh cache instance over the same driver.
    const restoreStorage = new SqliteStructuredStorage({ driver });
    const restoreCache = createTimelineCache(restoreStorage, clock);
    const restored = await restoreTimelineTail(restoreCache, "agt_fixture_t20b_0001");

    expect(restored).not.toBeNull();
    expect(restored?.stale).toBe(true);
    expect(restored?.rows).toHaveLength(2);
    noDuplicateIds(restored!.rows);
    // The gap is recomputed from the restored rows, not itself cached —
    // and still open, since nothing authoritative has been folded in yet.
    expect(restored?.gap).toEqual({ epoch: "epoch-t20b-0001", fromSeq: 11, toSeq: 19 });

    const envelope = await loadTimelineCacheEnvelope(restoreCache, "agt_fixture_t20b_0001");
    expect(envelope?.stale).toBe(true); // cache-level staleness agrees

    const announcement = describeTimelineStaleness({
      stale: restored!.stale,
      gap: restored!.gap,
      cachedAt: envelope?.cachedAt,
    });
    expect(announcement).toEqual({
      reason: "gap-backfill",
      since: envelope?.cachedAt,
      text: "Catching up on missing messages before this view is up to date.",
    });
  });

  it("replaying the exact same (fully overlapping) catch-up window twice does not duplicate rows", async () => {
    const { driver, clock } = buildCache();
    const storage = new SqliteStructuredStorage({ driver });
    const cache = createTimelineCache(storage, clock);

    let live = coreTimeline.ingestAgentStreamMessage(
      coreTimeline.createEmptyTimelineState(),
      liveSeq10,
    );
    live = coreTimeline.ingestAgentStreamMessage(live, liveSeq20);
    await cacheTimelineTail(cache, "agt_fixture_t20b_0001", live);
    const restored = (await restoreTimelineTail(cache, "agt_fixture_t20b_0001"))!;

    const afterFirstApply = coreTimeline.ingestTimelineWindow(restored, page1);
    expect(afterFirstApply.stale).toBe(false); // any authoritative window clears reducer-level stale
    expect(afterFirstApply.rows).toHaveLength(3); // seq 10, 15-19 (collapsed), 20
    noDuplicateIds(afterFirstApply.rows);
    expect(afterFirstApply.gap).toEqual({ epoch: "epoch-t20b-0001", fromSeq: 11, toSeq: 14 });

    // Overlapping redelivery: the daemon resends the identical page (e.g.
    // after a reconnect racing the first response). Idempotence direction 1.
    const afterReplay = coreTimeline.ingestTimelineWindow(afterFirstApply, page1);
    expect(afterReplay.rows).toHaveLength(3);
    noDuplicateIds(afterReplay.rows);
    expect(afterReplay.rows).toEqual(afterFirstApply.rows);
    expect(afterReplay.gap).toEqual({ epoch: "epoch-t20b-0001", fromSeq: 11, toSeq: 14 });

    await confirmTimelineCatchUp(cache, "agt_fixture_t20b_0001", afterReplay);
    const envelope = await loadTimelineCacheEnvelope(cache, "agt_fixture_t20b_0001");
    expect(envelope?.stale).toBe(false);
    expect(envelope?.data.rows).toHaveLength(3);
  });

  it("a gapped window (two disjoint backfill pages), replayed out of order, reconciles without duplicates in both directions", async () => {
    const { driver, clock } = buildCache();
    const storage = new SqliteStructuredStorage({ driver });
    const cache = createTimelineCache(storage, clock);

    let live = coreTimeline.ingestAgentStreamMessage(
      coreTimeline.createEmptyTimelineState(),
      liveSeq10,
    );
    live = coreTimeline.ingestAgentStreamMessage(live, liveSeq20);
    await cacheTimelineTail(cache, "agt_fixture_t20b_0001", live);
    const restored = (await restoreTimelineTail(cache, "agt_fixture_t20b_0001"))!;

    // Page 1 first (covers 15-19, still leaves 11-14 open).
    const afterPage1 = coreTimeline.ingestTimelineWindow(restored, page1);
    expect(afterPage1.gap).toEqual({ epoch: "epoch-t20b-0001", fromSeq: 11, toSeq: 14 });
    expect(afterPage1.rows).toHaveLength(3);

    // Page 2 closes the gap (covers 11-14).
    const afterPage2 = coreTimeline.ingestTimelineWindow(afterPage1, page2);
    expect(afterPage2.gap).toBeNull();
    expect(afterPage2.rows).toHaveLength(4);
    noDuplicateIds(afterPage2.rows);
    expect(afterPage2.stale).toBe(false);

    // Idempotence direction 2: replay page 1 again, now AFTER the gap it
    // used to leave open has already been closed by page 2. Must not
    // duplicate rows or reopen the gap.
    const afterReplayingPage1Again = coreTimeline.ingestTimelineWindow(afterPage2, page1);
    expect(afterReplayingPage1Again.rows).toHaveLength(4);
    noDuplicateIds(afterReplayingPage1Again.rows);
    expect(afterReplayingPage1Again.gap).toBeNull();
    expect(afterReplayingPage1Again.rows).toEqual(afterPage2.rows);

    // And replaying page 2 again on top of that is equally idempotent.
    const afterReplayingPage2Again = coreTimeline.ingestTimelineWindow(
      afterReplayingPage1Again,
      page2,
    );
    expect(afterReplayingPage2Again.rows).toHaveLength(4);
    noDuplicateIds(afterReplayingPage2Again.rows);
    expect(afterReplayingPage2Again.gap).toBeNull();

    await confirmTimelineCatchUp(cache, "agt_fixture_t20b_0001", afterReplayingPage2Again);
    const announcement = describeTimelineStaleness({
      stale: false,
      gap: null,
    });
    expect(announcement).toBeNull(); // nothing to announce once caught up
  });

  it("cacheTimelineTail excludes pendingRows (T37B gap, closed by T37C): a non-empty pendingRows state is not persisted into the cached snapshot", async () => {
    const { driver, clock } = buildCache();
    const storage = new SqliteStructuredStorage({ driver });
    const cache = createTimelineCache(storage, clock);

    let live = coreTimeline.ingestAgentStreamMessage(
      coreTimeline.createEmptyTimelineState(),
      liveSeq10,
    );
    live = coreTimeline.addOptimisticUserMessage(live, {
      clientMessageId: "cmid-t37c-pending-gap",
      text: "not yet acknowledged by the daemon",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
    expect(live.pendingRows).toHaveLength(1); // sanity: this state really does carry an optimistic row

    await cacheTimelineTail(cache, "agt_fixture_t37c_pending", live);
    const envelope = await loadTimelineCacheEnvelope(cache, "agt_fixture_t37c_pending");

    // Only the confirmed server replica is cached — the optimistic row,
    // and its text, must never reach the persisted snapshot.
    expect(envelope?.data.rows).toEqual(live.rows);
    expect(envelope?.data.rows).toHaveLength(1);
    expect(envelope?.data.rows.some((row) => row.pending)).toBe(false);
    expect(JSON.stringify(envelope?.data)).not.toContain("not yet acknowledged by the daemon");
    expect(JSON.stringify(envelope?.data)).not.toContain("cmid-t37c-pending-gap");
  });

  it("confirmTimelineCatchUp refuses a still-stale state, so cache-level and reducer-level staleness can never desync", async () => {
    const { driver, clock } = buildCache();
    const storage = new SqliteStructuredStorage({ driver });
    const cache = createTimelineCache(storage, clock);
    const stillStale = coreTimeline.restoreCachedTimeline({
      epoch: "epoch-t20b-0001",
      rows: [],
    });
    await expect(
      confirmTimelineCatchUp(cache, "agt_fixture_t20b_0001", stillStale),
    ).rejects.toThrow(/state\.stale is still true/);
  });
});
