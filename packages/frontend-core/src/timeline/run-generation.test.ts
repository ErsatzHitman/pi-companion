/**
 * Tests for the run-generation fence (T46A1, plan.md §7.4).
 */
import { describe, expect, it } from "vitest";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";

import { ingestAgentStreamMessage } from "./reducer.js";
import { createEmptyTimelineState } from "./types.js";
import type { TimelineState } from "./types.js";
import { RunGenerationTracker, fenceAsyncResponse } from "./run-generation.js";

function assistantDelta(params: {
  seq: number;
  text: string;
  messageId: string;
  replaceMessageId?: string;
  timestamp?: string;
}): AgentStreamMessage {
  return {
    type: "agent_stream",
    payload: {
      agentId: "agent-1",
      epoch: "epoch-1",
      seq: params.seq,
      timestamp: params.timestamp ?? "2026-09-01T10:00:00.000Z",
      event: {
        type: "timeline",
        provider: "pi",
        item: {
          type: "assistant_message",
          text: params.text,
          messageId: params.messageId,
          ...(params.replaceMessageId ? { replaceMessageId: params.replaceMessageId } : {}),
        },
      },
    },
  };
}

describe("RunGenerationTracker: counter behaviour", () => {
  it("starts at 0 and increments monotonically on each beginRun()", () => {
    const tracker = new RunGenerationTracker();
    expect(tracker.getCurrent()).toBe(0);

    const first = tracker.beginRun();
    const second = tracker.beginRun();
    const third = tracker.beginRun();

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(third).toBe(3);
    expect(tracker.getCurrent()).toBe(3);
  });

  it("reports isCurrent/isStale relative to the latest beginRun()", () => {
    const tracker = new RunGenerationTracker();
    const runA = tracker.beginRun();
    expect(tracker.isCurrent(runA)).toBe(true);
    expect(tracker.isStale(runA)).toBe(false);

    const runB = tracker.beginRun();
    expect(tracker.isCurrent(runA)).toBe(false);
    expect(tracker.isStale(runA)).toBe(true);
    expect(tracker.isCurrent(runB)).toBe(true);
    expect(tracker.isStale(runB)).toBe(false);
  });

  it("snapshot() reflects the current generation without mutating it", () => {
    const tracker = new RunGenerationTracker();
    tracker.beginRun();
    tracker.beginRun();
    expect(tracker.snapshot()).toEqual({ current: 2 });
    expect(tracker.snapshot()).toEqual({ current: 2 });
  });
});

describe("RunGenerationTracker.admit: discarding a stale response", () => {
  it("applies a current-generation response", () => {
    const tracker = new RunGenerationTracker();
    const run = tracker.beginRun();

    const result = tracker.admit(run, 1, (n) => n + 1);

    expect(result).toBe(2);
  });

  it("discards an older-generation response and returns state unchanged (same reference)", () => {
    const tracker = new RunGenerationTracker();
    const staleRun = tracker.beginRun();
    tracker.beginRun(); // a newer run supersedes staleRun

    const state = { count: 0 };
    const result = tracker.admit(staleRun, state, (s) => ({ count: s.count + 1 }));

    expect(result).toBe(state); // exact reference: apply() was never called
    expect(result.count).toBe(0);
  });
});

describe("fenceAsyncResponse", () => {
  it("resolves to the value when the run is still current", async () => {
    const tracker = new RunGenerationTracker();
    const run = tracker.beginRun();

    const result = await fenceAsyncResponse(tracker, run, () => Promise.resolve("ok"));

    expect(result).toBe("ok");
  });

  it("resolves to undefined when a newer run has begun before the response settles", async () => {
    const tracker = new RunGenerationTracker();
    const staleRun = tracker.beginRun();

    const pending = fenceAsyncResponse(tracker, staleRun, () => Promise.resolve("late"));
    tracker.beginRun(); // supersede staleRun while `pending` is still in flight

    await expect(pending).resolves.toBeUndefined();
  });

  it("still rejects if the wrapped operation itself rejects, fencing does not swallow errors", async () => {
    const tracker = new RunGenerationTracker();
    const run = tracker.beginRun();

    await expect(
      fenceAsyncResponse(tracker, run, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });
});

describe("fixture: a late response from an aborted run cannot restore a finished streaming row", () => {
  it("finishes run 1's streamed message, then discards a late run-1 delta once run 2 has begun", () => {
    const tracker = new RunGenerationTracker();

    // Run 1: user's first prompt starts a streaming assistant reply.
    const run1 = tracker.beginRun();
    let state: TimelineState = createEmptyTimelineState();
    state = tracker.admit(run1, state, (s) =>
      ingestAgentStreamMessage(
        s,
        assistantDelta({ seq: 1, text: "Thinking...", messageId: "msg-1" }),
      ),
    );

    // The daemon finalizes the message in place via replaceMessageId — this
    // is what "a finished streaming row" means for an assistant message
    // (plan.md §7.4 "apply replaceMessageId corrections in place").
    state = tracker.admit(run1, state, (s) =>
      ingestAgentStreamMessage(
        s,
        assistantDelta({
          seq: 2,
          text: "Answer: 42",
          messageId: "msg-1",
          replaceMessageId: "msg-1",
        }),
      ),
    );

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.item).toMatchObject({ type: "assistant_message", text: "Answer: 42" });
    const finishedState = state;

    // The user aborts run 1 and immediately submits a new prompt: run 2
    // begins, superseding run 1's generation.
    tracker.beginRun();

    // First, prove this fixture is not vacuous: applying the same late
    // run-1 delta *without* the generation fence really would resurrect
    // stale content into the transcript (a stray extra row appended after
    // the already-finished answer).
    const unguardedResult = ingestAgentStreamMessage(
      finishedState,
      assistantDelta({ seq: 3, text: "...actually, wait", messageId: "msg-1" }),
    );
    expect(unguardedResult.rows).toHaveLength(2);

    // Now apply the exact same late run-1 response through the fence. It
    // must be discarded outright: no mutation, no new row, no reopening of
    // the finished message.
    const guardedResult = tracker.admit(run1, finishedState, (s) =>
      ingestAgentStreamMessage(
        s,
        assistantDelta({ seq: 3, text: "...actually, wait", messageId: "msg-1" }),
      ),
    );

    expect(guardedResult).toBe(finishedState); // discarded: exact same reference back
    expect(guardedResult.rows).toHaveLength(1);
    expect(guardedResult.rows[0]?.item).toMatchObject({
      type: "assistant_message",
      text: "Answer: 42",
    });
  });
});
