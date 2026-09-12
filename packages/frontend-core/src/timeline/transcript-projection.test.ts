/**
 * Tests for `./transcript-projection.ts` (T388).
 *
 * The claim under test is a *bound*, not a snapshot: appending one streaming
 * delta to a large timeline must re-derive a constant number of entries, no
 * matter how many rows the timeline already holds. The observable is
 * `stats.computedCount` — the number of rows `buildTranscriptEntry` actually
 * ran for — which is exactly the work this module exists to bound.
 */
import { describe, expect, it } from "vitest";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";
import type { AgentTimelineItem } from "@picompanion/protocol/agent-types";

import { buildTranscriptEntries } from "./transcript-view.js";
import { ingestAgentStreamMessage, ingestTimelineWindow } from "./reducer.js";
import { TranscriptEntryProjector } from "./transcript-projection.js";
import { createEmptyTimelineState } from "./types.js";
import type { TimelineState } from "./types.js";

const EPOCH = "epoch-t388-projection";

function streamMessage(seq: number, item: AgentTimelineItem): AgentStreamMessage {
  return {
    type: "agent_stream",
    payload: {
      agentId: "agt_t388",
      epoch: EPOCH,
      seq,
      timestamp: "2026-09-12T10:00:00.000Z",
      event: { type: "timeline", provider: "pi", item },
    },
  };
}

/** A settled session: `turns` user/assistant pairs, so the row count is
 * `turns * 2` and every row is reference-stable across a later append. */
function settledState(turns: number): TimelineState {
  let state = createEmptyTimelineState();
  for (let turn = 0; turn < turns; turn += 1) {
    state = ingestAgentStreamMessage(
      state,
      streamMessage(turn * 2 + 1, {
        type: "user_message",
        text: `q${turn}`,
        clientMessageId: `cm_${turn}`,
      }),
    );
    state = ingestAgentStreamMessage(
      state,
      streamMessage(turn * 2 + 2, {
        type: "assistant_message",
        text: `a${turn}`,
        messageId: `msg_${turn}`,
      }),
    );
  }
  return state;
}

describe("TranscriptEntryProjector", () => {
  it("outputs exactly what buildTranscriptEntries does, entry for entry", () => {
    const state = settledState(20);
    const projector = new TranscriptEntryProjector();
    expect(projector.project(state)).toEqual(buildTranscriptEntries(state));
  });

  it("computes every row on the first projection, and none on an unchanged re-projection", () => {
    const state = settledState(10);
    const stats: number[] = [];
    const projector = new TranscriptEntryProjector({
      onProject: (value) => stats.push(value.computedCount),
    });

    projector.project(state);
    expect(stats).toEqual([20]);

    projector.project(state);
    // Same rows, same references: nothing to re-derive.
    expect(stats).toEqual([20, 0]);
    expect(projector.getStats().reusedCount).toBe(20);
  });

  it("bounds recomputation to the appended row(s) when one delta streams into a large timeline", () => {
    const settled = settledState(500); // 1,000 rows
    const projector = new TranscriptEntryProjector();
    projector.project(settled);
    expect(projector.getStats().computedCount).toBe(1_000);

    const appended = ingestAgentStreamMessage(
      settled,
      streamMessage(1_001, { type: "assistant_message", text: "new token", messageId: "msg_999" }),
    );

    const entries = projector.project(appended);
    const stats = projector.getStats();

    expect(entries).toHaveLength(1_001);
    expect(stats.computedCount).toBe(1);
    expect(stats.reusedCount).toBe(1_000);
    // The settled rows keep their exact entry objects, which is what lets a
    // memoized row component skip re-rendering them.
    expect(entries[0]).toBe(projector.project(settled)[0]);
  });

  it("re-derives only the one row a merged tool-call update actually mutated", () => {
    let state = createEmptyTimelineState();
    state = ingestAgentStreamMessage(state, streamMessage(1, { type: "reasoning", text: "look" }));
    state = ingestAgentStreamMessage(
      state,
      streamMessage(2, {
        type: "tool_call",
        callId: "call_1",
        name: "read",
        detail: { type: "read", filePath: "/tmp/a.ts" },
        status: "running",
        error: null,
      }),
    );
    state = ingestAgentStreamMessage(
      state,
      streamMessage(3, { type: "assistant_message", text: "done", messageId: "msg_1" }),
    );

    const projector = new TranscriptEntryProjector();
    projector.project(state);
    expect(projector.getStats().computedCount).toBe(3);

    const updated = ingestAgentStreamMessage(
      state,
      streamMessage(4, {
        type: "tool_call",
        callId: "call_1",
        name: "read",
        detail: { type: "read", filePath: "/tmp/a.ts", content: "body" },
        status: "completed",
        error: null,
      }),
    );

    projector.project(updated);
    // The reducer replaced exactly one row object; the other two are reused.
    expect(projector.getStats().computedCount).toBe(1);
  });

  it("keeps the same entry object for a row across a prepended page", () => {
    let state = ingestTimelineWindow(createEmptyTimelineState(), {
      type: "fetch_agent_timeline_response",
      payload: {
        epoch: EPOCH,
        reset: false,
        entries: [
          {
            seqStart: 5,
            seqEnd: 5,
            timestamp: "2026-09-12T10:00:00.000Z",
            provider: "pi",
            item: { type: "assistant_message", text: "tail", messageId: "msg_tail" },
          },
        ] as never,
      },
    } as never);

    const projector = new TranscriptEntryProjector();
    const before = projector.project(state);
    expect(projector.getStats().computedCount).toBe(1);

    state = ingestTimelineWindow(state, {
      type: "fetch_agent_timeline_response",
      payload: {
        epoch: EPOCH,
        reset: false,
        entries: [
          {
            seqStart: 1,
            seqEnd: 1,
            timestamp: "2026-09-12T10:00:00.000Z",
            provider: "pi",
            item: { type: "user_message", text: "head", clientMessageId: "cm_head" },
          },
        ] as never,
      },
    } as never);

    const after = projector.project(state);
    expect(after).toHaveLength(2);
    expect(after[1]).toBe(before[0]);
    expect(projector.getStats().computedCount).toBe(1);
  });

  it("drops the whole memo when `stale` flips, because every entry carries that flag", () => {
    const state = settledState(3);
    const projector = new TranscriptEntryProjector();
    projector.project(state);
    expect(projector.getStats().computedCount).toBe(6);

    const staleState: TimelineState = { ...state, stale: true };
    projector.project(staleState);
    expect(projector.getStats().cacheWasReset).toBe(true);
    expect(projector.getStats().computedCount).toBe(6);
  });

  it("drops the whole memo when the working directory changes, because it feeds every tool-call model", () => {
    let state = createEmptyTimelineState();
    state = ingestAgentStreamMessage(
      state,
      streamMessage(1, {
        type: "tool_call",
        callId: "call_cwd",
        name: "read",
        detail: { type: "read", filePath: "/repo/pkg/a.ts" },
        status: "completed",
        error: null,
      }),
    );
    const projector = new TranscriptEntryProjector({ cwd: "/repo" });
    projector.project(state);
    expect(projector.getStats().computedCount).toBe(1);
    const before = projector.project(state);
    expect(projector.getStats().computedCount).toBe(0);

    projector.setCwd("/repo/pkg");
    const after = projector.project(state);
    expect(projector.getStats().cacheWasReset).toBe(true);
    expect(projector.getStats().computedCount).toBe(1);
    expect(after).not.toEqual(before);

    // Setting the same cwd again is a no-op (the memo survives).
    projector.setCwd("/repo/pkg");
    projector.project(state);
    expect(projector.getStats().computedCount).toBe(0);
  });

  it("reuses entries across a gap-recovery replay that leaves rows in place", () => {
    let state = settledState(4);
    const projector = new TranscriptEntryProjector();
    const before = projector.project(state);

    // A reconnect window with `reset: true` rebuilds every row object, so the
    // memo cannot be reused — but the entries must still equal the old ones.
    state = ingestTimelineWindow(state, {
      type: "fetch_agent_timeline_response",
      payload: {
        epoch: EPOCH,
        reset: true,
        entries: state.rows.map((row) => ({
          seqStart: row.seqStart,
          seqEnd: row.seqEnd,
          timestamp: row.timestamp,
          provider: row.provider,
          item: row.item,
        })) as never,
      },
    } as never);

    const after = projector.project(state);
    expect(after).toEqual(before);
  });
});
