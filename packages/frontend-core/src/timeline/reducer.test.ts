/**
 * Fixture-driven tests for the timeline reducer's core invariants (T20A,
 * plan.md §7.4): epoch reset, epoch/seq dedupe, `replaceMessageId`
 * correction in place, tool updates attached to their call, and preserved
 * daemon timestamps.
 */
import { describe, expect, it } from "vitest";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";
import type { AgentTimelineItem, ToolCallTimelineItem } from "@picompanion/protocol/agent-types";
// Relative import, not the package export: packages/protocol/src/fixtures'
// JSON scenario data is not currently copied into packages/protocol/dist
// (see that directory's README "Loading fixtures" section), so consumers
// outside packages/protocol read the fixture loader from source. This
// mirrors the existing precedent in
// packages/server/src/server/agent/providers/pi/transcript-protection.test.ts.
import { loadDaemonWsFixture } from "../../../protocol/src/fixtures/index.js";
import { loadTimelineFixtureScenario } from "./fixtures/index.js";
import {
  agentStreamMessageFromFrame,
  fetchAgentTimelineResponseFromFrame,
  frameById,
} from "./fixtures/wire.js";
import { ingestAgentStreamMessage, ingestTimelineWindow } from "./reducer.js";
import { createEmptyTimelineState } from "./types.js";
import type { TimelineState } from "./types.js";

describe("timeline reducer: assistant-message-correction fixture", () => {
  const scenario = loadTimelineFixtureScenario("assistant-message-correction");

  it("ingests the initial streamed row with its daemon timestamp preserved", () => {
    const message = agentStreamMessageFromFrame(frameById(scenario.frames, "assistant-delta-1"));
    const state = ingestAgentStreamMessage(createEmptyTimelineState(), message);

    expect(state.epoch).toBe("epoch-t20a-0001");
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      id: "epoch-t20a-0001:10",
      timestamp: "2026-09-01T10:00:00.000Z",
      provider: "pi",
    });
    expect(state.rows[0]?.item).toEqual({
      type: "assistant_message",
      text: "Draft answer for /synthetic/workspace/demo-repo",
      messageId: "msg_t20a_0001",
    });
  });

  it("deduplicates an exact re-delivery of the same (epoch, seq) row", () => {
    const first = ingestAgentStreamMessage(
      createEmptyTimelineState(),
      agentStreamMessageFromFrame(frameById(scenario.frames, "assistant-delta-1")),
    );
    const resent = ingestAgentStreamMessage(
      first,
      agentStreamMessageFromFrame(frameById(scenario.frames, "assistant-delta-1-resend")),
    );

    expect(resent.rows).toHaveLength(1);
    expect(resent).toBe(first); // pure no-op: same reference, not just equal content
  });

  it("applies a replaceMessageId correction in place, never appending a duplicate row", () => {
    let state: TimelineState = createEmptyTimelineState();
    state = ingestAgentStreamMessage(
      state,
      agentStreamMessageFromFrame(frameById(scenario.frames, "assistant-delta-1")),
    );
    state = ingestAgentStreamMessage(
      state,
      agentStreamMessageFromFrame(frameById(scenario.frames, "assistant-delta-1-resend")),
    );
    state = ingestAgentStreamMessage(
      state,
      agentStreamMessageFromFrame(frameById(scenario.frames, "assistant-correction-1")),
    );

    // Still exactly one row: the correction replaced the streamed row rather
    // than appending a second one at seq 11.
    expect(state.rows).toHaveLength(1);
    const row = state.rows[0];
    expect(row?.id).toBe("epoch-t20a-0001:10"); // original position preserved
    expect(row?.timestamp).toBe("2026-09-01T10:00:05.000Z"); // correction's own timestamp
    expect(row?.item).toEqual({
      type: "assistant_message",
      text: "Final answer for /synthetic/workspace/demo-repo/README.md.",
      messageId: "msg_t20a_0002",
      replaceMessageId: "msg_t20a_0001",
      corrected: true,
    });
  });
});

describe("timeline reducer: tool-call-lifecycle fixture", () => {
  const scenario = loadTimelineFixtureScenario("tool-call-lifecycle");

  function ingestAll(frameIds: readonly string[]): TimelineState {
    let state: TimelineState = createEmptyTimelineState();
    for (const id of frameIds) {
      state = ingestAgentStreamMessage(
        state,
        agentStreamMessageFromFrame(frameById(scenario.frames, id)),
      );
    }
    return state;
  }

  it("keeps every update for one callId attached to a single row", () => {
    const state = ingestAll([
      "tool-call-a-start",
      "tool-call-b-start",
      "tool-call-a-update",
      "tool-call-a-end",
      "tool-call-b-end",
    ]);

    expect(state.rows).toHaveLength(2); // two calls, not five rows

    const callA = state.rows.find(
      (row) => row.item.type === "tool_call" && row.item.callId === "call_t20a_0001",
    );
    expect(callA?.id).toBe("epoch-t20a-0002:20"); // stayed at its first-seen position
    expect(callA?.seqEnd).toBe(23); // grew to cover the merged updates
    expect(callA?.timestamp).toBe("2026-09-01T11:00:03.000Z"); // latest merge's timestamp
    const callAItem = callA?.item as ToolCallTimelineItem;
    expect(callAItem.status).toBe("completed");
    expect(callAItem.detail).toEqual({
      type: "read",
      filePath: "/synthetic/workspace/demo-repo/README.md",
      content: "full synthetic content",
    });

    const callB = state.rows.find(
      (row) => row.item.type === "tool_call" && row.item.callId === "call_t20a_0002",
    );
    expect(callB?.id).toBe("epoch-t20a-0002:21");
    const callBItem = callB?.item as ToolCallTimelineItem;
    expect(callBItem.status).toBe("completed");
  });

  it("preserves row order across calls despite interleaved updates", () => {
    const state = ingestAll([
      "tool-call-a-start",
      "tool-call-b-start",
      "tool-call-a-update",
      "tool-call-a-end",
      "tool-call-b-end",
    ]);

    expect(state.rows.map((row) => (row.item as ToolCallTimelineItem).callId)).toEqual([
      "call_t20a_0001",
      "call_t20a_0002",
    ]);
  });

  it("deduplicates an exact re-delivery of a tool_call update", () => {
    const withoutResend = ingestAll([
      "tool-call-a-start",
      "tool-call-b-start",
      "tool-call-a-update",
      "tool-call-a-end",
      "tool-call-b-end",
    ]);
    const withResend = ingestAll([
      "tool-call-a-start",
      "tool-call-b-start",
      "tool-call-a-update",
      "tool-call-a-end",
      "tool-call-a-end-resend",
      "tool-call-b-end",
    ]);

    expect(withResend.rows).toHaveLength(2);
    expect(withResend).toEqual(withoutResend);
  });
});

describe("timeline reducer: reconnect-with-gap fixture (epoch reset)", () => {
  const fixture = loadDaemonWsFixture("reconnect-with-gap");
  const responseFrame = fixture.frames.find((frame) =>
    frame.wireType.includes("fetch_agent_timeline_response"),
  );
  if (!responseFrame) {
    throw new Error(
      "reconnect-with-gap fixture is missing its fetch_agent_timeline_response frame",
    );
  }
  const response = fetchAgentTimelineResponseFromFrame(responseFrame);

  function seedStaleState(): TimelineState {
    // Simulate the client's pre-disconnect timeline: a row loaded under the
    // epoch the daemon no longer has after restart.
    return {
      epoch: "epoch-before-restart-0001",
      rows: [
        {
          id: "epoch-before-restart-0001:41",
          epoch: "epoch-before-restart-0001",
          seqStart: 41,
          seqEnd: 41,
          timestamp: "2026-08-31T12:00:00.000Z",
          provider: "pi",
          item: { type: "user_message", text: "stale question" } satisfies AgentTimelineItem,
        },
      ],
    };
  }

  it("resets on epoch change instead of merging across epochs", () => {
    const next = ingestTimelineWindow(seedStaleState(), response);

    expect(response.payload.reset).toBe(true);
    expect(response.payload.epoch).toBe("epoch-after-restart-0002");
    expect(next.epoch).toBe("epoch-after-restart-0002");
    expect(next.rows.some((row) => row.epoch === "epoch-before-restart-0001")).toBe(false);
  });

  it("ingests the reset window's entries with their daemon timestamps preserved", () => {
    const next = ingestTimelineWindow(seedStaleState(), response);

    expect(next.rows).toHaveLength(2);
    expect(next.rows[0]).toMatchObject({
      id: "epoch-after-restart-0002:5",
      timestamp: "2026-08-31T13:00:00.000Z",
      provider: "pi",
    });
    expect(next.rows[1]).toMatchObject({
      id: "epoch-after-restart-0002:6",
      timestamp: "2026-08-31T13:00:01.000Z",
      provider: "pi",
    });
  });

  it("deduplicates re-ingesting the same window", () => {
    const once = ingestTimelineWindow(seedStaleState(), response);
    const twice = ingestTimelineWindow(once, response);

    expect(twice.rows).toHaveLength(2);
    expect(twice).toEqual(once);
  });
});

describe("timeline reducer: scope boundaries and edge cases", () => {
  it("ignores non-timeline agent_stream events (owned by other frontend-core domains)", () => {
    const message: AgentStreamMessage = {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t20a_0003",
        timestamp: "2026-09-01T12:00:00.000Z",
        event: { type: "turn_started", provider: "pi" },
      },
    };

    const state = ingestAgentStreamMessage(createEmptyTimelineState(), message);
    expect(state).toEqual(createEmptyTimelineState());
  });

  it("ignores a timeline event missing epoch/seq rather than guessing an identity", () => {
    const message: AgentStreamMessage = {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t20a_0003",
        timestamp: "2026-09-01T12:00:00.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: { type: "user_message", text: "no epoch/seq on this one" },
        },
      },
    };

    const state = ingestAgentStreamMessage(createEmptyTimelineState(), message);
    expect(state.rows).toHaveLength(0);
  });

  it("inserts a replaceMessageId correction as its own row when the target isn't loaded", () => {
    // T20B (pagination/reconciliation) owns backfilling across page
    // boundaries; until then the correction must never be silently dropped.
    const message: AgentStreamMessage = {
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t20a_0003",
        epoch: "epoch-t20a-0003",
        seq: 1,
        timestamp: "2026-09-01T12:00:00.000Z",
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "assistant_message",
            text: "correction with no loaded target",
            messageId: "msg_t20a_0099",
            replaceMessageId: "msg_never_loaded",
            corrected: true,
          },
        },
      },
    };

    const state = ingestAgentStreamMessage(createEmptyTimelineState(), message);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.item).toMatchObject({ messageId: "msg_t20a_0099" });
  });

  it("keeps ingestion pure: the input state is never mutated", () => {
    const scenario = loadTimelineFixtureScenario("assistant-message-correction");
    const before = createEmptyTimelineState();
    const beforeSnapshot = structuredClone(before);
    ingestAgentStreamMessage(
      before,
      agentStreamMessageFromFrame(frameById(scenario.frames, "assistant-delta-1")),
    );
    expect(before).toEqual(beforeSnapshot);
  });
});
