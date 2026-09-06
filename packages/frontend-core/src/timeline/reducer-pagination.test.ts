/**
 * Fixture-driven tests for T20B's timeline reducer extensions (plan.md
 * §7.4): gap detection/backfill paging to completion, optimistic-row
 * reconciliation, stale-cache restoration, and restart recovery during an
 * active turn.
 */
import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "@picompanion/protocol/agent-types";
import { loadTimelineFixtureScenario } from "./fixtures/index.js";
import {
  agentStreamMessageFromFrame,
  fetchAgentTimelineResponseFromFrame,
  frameById,
} from "./fixtures/wire.js";
import {
  addOptimisticUserMessage,
  getVisibleTimelineRows,
  ingestAgentStreamMessage,
  ingestTimelineWindow,
  planGapBackfillRequest,
  restoreCachedTimeline,
} from "./reducer.js";
import { createEmptyTimelineState } from "./types.js";
import type { TimelineState } from "./types.js";

describe("timeline reducer: gap-backfill fixture (pages until complete)", () => {
  const scenario = loadTimelineFixtureScenario("gap-backfill");

  function seedGap(): TimelineState {
    let state = createEmptyTimelineState();
    state = ingestAgentStreamMessage(
      state,
      agentStreamMessageFromFrame(frameById(scenario.frames, "live-seq-10")),
    );
    state = ingestAgentStreamMessage(
      state,
      agentStreamMessageFromFrame(frameById(scenario.frames, "live-seq-20")),
    );
    return state;
  }

  it("detects a gap when a live push jumps past missing sequence numbers", () => {
    const state = seedGap();

    expect(state.rows.map((row) => [row.seqStart, row.seqEnd])).toEqual([
      [10, 10],
      [20, 20],
    ]);
    expect(state.gap).toEqual({ epoch: "epoch-t20b-0001", fromSeq: 11, toSeq: 19 });
  });

  it("plans a backfill request targeting the gap, or null once there is nothing to fill", () => {
    const state = seedGap();

    const request = planGapBackfillRequest(state, {
      agentId: "agt_fixture_t20b_0001",
      requestId: "req_t20b_gap_0001",
    });
    expect(request).toEqual({
      type: "fetch_agent_timeline_request",
      agentId: "agt_fixture_t20b_0001",
      requestId: "req_t20b_gap_0001",
      direction: "before",
      cursor: { epoch: "epoch-t20b-0001", seq: 20 },
      limit: 200,
      projection: "projected",
      mergeWindow: true,
    });

    expect(
      planGapBackfillRequest(createEmptyTimelineState(), { agentId: "a", requestId: "r" }),
    ).toBeNull();
  });

  it("narrows the gap after a partial backfill page, then closes it after the next page", () => {
    let state = seedGap();

    const page1 = fetchAgentTimelineResponseFromFrame(
      frameById(scenario.frames, "gap-backfill-page-1"),
    );
    state = ingestTimelineWindow(state, page1);

    expect(state.rows.map((row) => [row.seqStart, row.seqEnd])).toEqual([
      [10, 10],
      [15, 19],
      [20, 20],
    ]);
    expect(state.gap).toEqual({ epoch: "epoch-t20b-0001", fromSeq: 11, toSeq: 14 });

    const nextRequest = planGapBackfillRequest(state, {
      agentId: "agt_fixture_t20b_0001",
      requestId: "req_t20b_gap_0002",
    });
    expect(nextRequest?.cursor).toEqual({ epoch: "epoch-t20b-0001", seq: 15 });

    const page2 = fetchAgentTimelineResponseFromFrame(
      frameById(scenario.frames, "gap-backfill-page-2"),
    );
    state = ingestTimelineWindow(state, page2);

    expect(state.rows.map((row) => [row.seqStart, row.seqEnd])).toEqual([
      [10, 10],
      [11, 14],
      [15, 19],
      [20, 20],
    ]);
    expect(state.gap).toBeNull();
    expect(planGapBackfillRequest(state, { agentId: "a", requestId: "r" })).toBeNull();
  });

  it("never duplicates rows across the two backfill pages", () => {
    let state = seedGap();
    state = ingestTimelineWindow(
      state,
      fetchAgentTimelineResponseFromFrame(frameById(scenario.frames, "gap-backfill-page-1")),
    );
    state = ingestTimelineWindow(
      state,
      fetchAgentTimelineResponseFromFrame(frameById(scenario.frames, "gap-backfill-page-2")),
    );

    const ids = state.rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("timeline reducer: optimistic-user-message fixture (reconciliation)", () => {
  const scenario = loadTimelineFixtureScenario("optimistic-user-message");

  it("adds a local optimistic row before daemon acknowledgment", () => {
    const state = addOptimisticUserMessage(createEmptyTimelineState(), {
      clientMessageId: "cmid_t20b_0001",
      text: "Summarize the open pull requests.",
      timestamp: "2026-09-01T15:00:00.000Z",
    });

    expect(state.pendingRows).toHaveLength(1);
    expect(state.pendingRows[0]).toMatchObject({
      id: "optimistic:cmid_t20b_0001",
      pending: true,
      item: {
        type: "user_message",
        text: "Summarize the open pull requests.",
        clientMessageId: "cmid_t20b_0001",
      },
    });
    expect(state.rows).toHaveLength(0); // never appears in the confirmed replica
  });

  it("is idempotent for the same clientMessageId", () => {
    const once = addOptimisticUserMessage(createEmptyTimelineState(), {
      clientMessageId: "cmid_t20b_0001",
      text: "Summarize the open pull requests.",
      timestamp: "2026-09-01T15:00:00.000Z",
    });
    const twice = addOptimisticUserMessage(once, {
      clientMessageId: "cmid_t20b_0001",
      text: "Summarize the open pull requests.",
      timestamp: "2026-09-01T15:00:00.000Z",
    });

    expect(twice).toBe(once);
    expect(twice.pendingRows).toHaveLength(1);
  });

  it("reconciles the optimistic row away, without duplication, once the daemon confirms it", () => {
    let state = addOptimisticUserMessage(createEmptyTimelineState(), {
      clientMessageId: "cmid_t20b_0001",
      text: "Summarize the open pull requests.",
      timestamp: "2026-09-01T15:00:00.000Z",
    });
    // A second, unrelated submission that the daemon never acknowledges in
    // this fixture: it must stay pending throughout.
    state = addOptimisticUserMessage(state, {
      clientMessageId: "cmid_t20b_still_pending",
      text: "Also check the CI status.",
      timestamp: "2026-09-01T15:00:00.100Z",
    });

    state = ingestAgentStreamMessage(
      state,
      agentStreamMessageFromFrame(frameById(scenario.frames, "confirmed-user-message")),
    );

    expect(state.pendingRows.map((row) => row.id)).toEqual(["optimistic:cmid_t20b_still_pending"]);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      id: "epoch-t20b-0002:30",
      item: { type: "user_message", clientMessageId: "cmid_t20b_0001" },
    });

    const visible = getVisibleTimelineRows(state);
    expect(visible).toHaveLength(2); // confirmed row + still-pending row, never the reconciled duplicate
    expect(visible.map((row) => row.id)).toEqual([
      "epoch-t20b-0002:30",
      "optimistic:cmid_t20b_still_pending",
    ]);
  });

  it("keeps a full turn (optimistic reconciliation plus assistant reply) duplication-free", () => {
    let state = addOptimisticUserMessage(createEmptyTimelineState(), {
      clientMessageId: "cmid_t20b_0001",
      text: "Summarize the open pull requests.",
      timestamp: "2026-09-01T15:00:00.000Z",
    });
    for (const frameId of ["confirmed-user-message", "assistant-reply"]) {
      state = ingestAgentStreamMessage(
        state,
        agentStreamMessageFromFrame(frameById(scenario.frames, frameId)),
      );
    }

    expect(state.pendingRows).toHaveLength(0);
    expect(getVisibleTimelineRows(state).map((row) => row.item.type)).toEqual([
      "user_message",
      "assistant_message",
    ]);
  });

  it("never resurrects an already-reconciled clientMessageId as pending again", () => {
    let state = addOptimisticUserMessage(createEmptyTimelineState(), {
      clientMessageId: "cmid_t20b_0001",
      text: "Summarize the open pull requests.",
      timestamp: "2026-09-01T15:00:00.000Z",
    });
    state = ingestAgentStreamMessage(
      state,
      agentStreamMessageFromFrame(frameById(scenario.frames, "confirmed-user-message")),
    );

    const afterLateOptimisticAdd = addOptimisticUserMessage(state, {
      clientMessageId: "cmid_t20b_0001",
      text: "Summarize the open pull requests.",
      timestamp: "2026-09-01T15:05:00.000Z",
    });

    expect(afterLateOptimisticAdd).toBe(state);
    expect(afterLateOptimisticAdd.pendingRows).toHaveLength(0);
  });
});

describe("timeline reducer: stale cached-tail restoration", () => {
  it("marks a restored cache stale without treating it as authoritative", () => {
    const cachedRow = {
      id: "epoch-cache-0001:1",
      epoch: "epoch-cache-0001",
      seqStart: 1,
      seqEnd: 1,
      timestamp: "2026-08-30T09:00:00.000Z",
      provider: "pi",
      item: { type: "user_message", text: "cached before app restart" } satisfies AgentTimelineItem,
    };

    const state = restoreCachedTimeline({ epoch: "epoch-cache-0001", rows: [cachedRow] });

    expect(state.stale).toBe(true);
    expect(state.epoch).toBe("epoch-cache-0001");
    expect(state.rows).toEqual([cachedRow]);
    expect(state.pendingRows).toEqual([]);
  });

  it("detects a gap already present within the restored cache", () => {
    const rowAt1 = {
      id: "epoch-cache-0002:1",
      epoch: "epoch-cache-0002",
      seqStart: 1,
      seqEnd: 1,
      timestamp: "2026-08-30T09:00:00.000Z",
      provider: "pi",
      item: { type: "user_message", text: "first" } satisfies AgentTimelineItem,
    };
    const rowAt5 = {
      id: "epoch-cache-0002:5",
      epoch: "epoch-cache-0002",
      seqStart: 5,
      seqEnd: 5,
      timestamp: "2026-08-30T09:00:05.000Z",
      provider: "pi",
      item: { type: "assistant_message", text: "later" } satisfies AgentTimelineItem,
    };

    const state = restoreCachedTimeline({
      epoch: "epoch-cache-0002",
      rows: [rowAt1, rowAt5],
    });

    expect(state.gap).toEqual({ epoch: "epoch-cache-0002", fromSeq: 2, toSeq: 4 });
  });

  it("stays stale through a live push, and only clears once an authoritative window arrives", () => {
    const cachedRow = {
      id: "epoch-t20b-0004:1",
      epoch: "epoch-t20b-0004",
      seqStart: 1,
      seqEnd: 1,
      timestamp: "2026-09-01T17:00:00.000Z",
      provider: "pi",
      item: { type: "user_message", text: "cached tail" } satisfies AgentTimelineItem,
    };
    let state = restoreCachedTimeline({ epoch: "epoch-t20b-0004", rows: [cachedRow] });
    expect(state.stale).toBe(true);

    state = ingestAgentStreamMessage(state, {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t20b_0004",
        epoch: "epoch-t20b-0004",
        seq: 2,
        timestamp: "2026-09-01T17:00:01.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: { type: "assistant_message", text: "live push while still stale" },
        },
      },
    });
    expect(state.stale).toBe(true); // a live push alone never proves catch-up

    state = ingestTimelineWindow(state, {
      type: "fetch_agent_timeline_response",
      payload: {
        requestId: "req_t20b_catchup_0001",
        agentId: "agt_fixture_t20b_0004",
        agent: null,
        direction: "tail",
        projection: "projected",
        epoch: "epoch-t20b-0004",
        reset: false,
        staleCursor: false,
        gap: false,
        window: { minSeq: 2, maxSeq: 2, nextSeq: 3 },
        startCursor: { epoch: "epoch-t20b-0004", seq: 2 },
        endCursor: { epoch: "epoch-t20b-0004", seq: 2 },
        hasOlder: false,
        hasNewer: false,
        entries: [],
        error: null,
      },
    });
    expect(state.stale).toBe(false); // authoritative catch-up clears it, even with an empty window
  });
});

describe("timeline reducer: restart-recovery fixture (active-turn resilience)", () => {
  const scenario = loadTimelineFixtureScenario("restart-recovery");

  function seedActiveTurnBeforeRestart(): TimelineState {
    let state: TimelineState = {
      epoch: "epoch-t20b-0003-before-restart",
      rows: [
        {
          id: "epoch-t20b-0003-before-restart:0",
          epoch: "epoch-t20b-0003-before-restart",
          seqStart: 0,
          seqEnd: 0,
          timestamp: "2026-09-01T15:55:00.000Z",
          provider: "pi",
          item: { type: "user_message", text: "start the refactor" },
        },
      ],
      pendingRows: [],
      gap: null,
      stale: false,
    };
    // The client's own submission, still in flight when the daemon restarts.
    state = addOptimisticUserMessage(state, {
      clientMessageId: "cmid_t20b_0002",
      text: "Continue the refactor and run the tests.",
      timestamp: "2026-09-01T16:00:00.000Z",
    });
    // An unrelated submission the daemon will never acknowledge in this
    // fixture — it must still be sitting there, pending, after recovery.
    state = addOptimisticUserMessage(state, {
      clientMessageId: "cmid_t20b_never_acked",
      text: "Also open a draft PR.",
      timestamp: "2026-09-01T16:00:00.500Z",
    });
    return state;
  }

  it("resets the stale pre-restart epoch's rows on the reset replay", () => {
    const before = seedActiveTurnBeforeRestart();
    const response = fetchAgentTimelineResponseFromFrame(
      frameById(scenario.frames, "fetch-timeline-response-restart"),
    );

    const after = ingestTimelineWindow(before, response);

    expect(after.epoch).toBe("epoch-t20b-0003-after-restart");
    expect(after.rows.some((row) => row.epoch === "epoch-t20b-0003-before-restart")).toBe(false);
  });

  it("reconciles the in-flight optimistic submission against its post-restart replay", () => {
    const before = seedActiveTurnBeforeRestart();
    const response = fetchAgentTimelineResponseFromFrame(
      frameById(scenario.frames, "fetch-timeline-response-restart"),
    );

    const after = ingestTimelineWindow(before, response);

    expect(after.pendingRows.some((row) => row.id === "optimistic:cmid_t20b_0002")).toBe(false);
    expect(after.rows).toHaveLength(2);
    expect(after.rows[0]).toMatchObject({
      item: { type: "user_message", clientMessageId: "cmid_t20b_0002" },
    });
    expect(after.rows[1]).toMatchObject({
      item: { type: "tool_call", callId: "call_t20b_0002", status: "running" },
    });
  });

  it("leaves an unrelated, still-unconfirmed submission pending after recovery", () => {
    const before = seedActiveTurnBeforeRestart();
    const response = fetchAgentTimelineResponseFromFrame(
      frameById(scenario.frames, "fetch-timeline-response-restart"),
    );

    const after = ingestTimelineWindow(before, response);

    expect(after.pendingRows.map((row) => row.id)).toEqual(["optimistic:cmid_t20b_never_acked"]);
  });

  it("produces a fully duplication-free recovered view", () => {
    const before = seedActiveTurnBeforeRestart();
    const response = fetchAgentTimelineResponseFromFrame(
      frameById(scenario.frames, "fetch-timeline-response-restart"),
    );

    const after = ingestTimelineWindow(before, response);
    const visibleIds = getVisibleTimelineRows(after).map((row) => row.id);

    expect(new Set(visibleIds).size).toBe(visibleIds.length);
    expect(visibleIds).toEqual([
      "epoch-t20b-0003-after-restart:0",
      "epoch-t20b-0003-after-restart:1",
      "optimistic:cmid_t20b_never_acked",
    ]);
  });
});
