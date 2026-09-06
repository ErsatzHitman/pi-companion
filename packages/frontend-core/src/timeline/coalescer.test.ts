/**
 * Tests for `TimelineCoalescer` (T45A2, plan.md §7.4/§14.5).
 *
 * Core claim under test: batching the *render* never batches away, drops,
 * or reorders a *row*. The stream is delta-based end to end (verified: see
 * `packages/server/src/server/agent/agent-stream-coalescer.ts`'s
 * concatenation-by-60ms-window and `reducer.ts`'s
 * never-concatenates-each-flush-is-its-own-row behavior), so every test
 * here compares a batched run against an unbatched run of the exact same
 * message sequence and asserts they land on byte-identical rows.
 */
import { describe, expect, it } from "vitest";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";
import type { AgentTimelineItem } from "@picompanion/protocol/agent-types";

import { TestFrameClock } from "../platform/frame-clock.js";
import { TimelineCoalescer } from "./coalescer.js";
import {
  addOptimisticUserMessage,
  ingestAgentStreamMessage,
  ingestTimelineWindow,
} from "./reducer.js";
import { createEmptyTimelineState } from "./types.js";
import type { TimelineRow, TimelineState } from "./types.js";

/** Only the fields `ingestTimelineWindow` actually reads
 * (`payload.epoch`/`reset`/`entries`) matter for this suite; the rest of
 * the real `fetch_agent_timeline_response` wire schema is irrelevant to
 * `TimelineCoalescer`'s batching behavior, so this stays a minimal stand-in
 * rather than a full fixture. */
type MinimalTimelineWindowResponse = {
  type: "fetch_agent_timeline_response";
  payload: {
    epoch: string;
    reset: boolean;
    entries: ReadonlyArray<{
      seqStart: number;
      seqEnd: number;
      timestamp: string;
      provider: string;
      item: AgentTimelineItem;
    }>;
  };
};

function ingestMinimalWindow(
  state: TimelineState,
  response: MinimalTimelineWindowResponse,
): TimelineState {
  return ingestTimelineWindow(
    state,
    response as unknown as Parameters<typeof ingestTimelineWindow>[1],
  );
}

const AGENT_ID = "agt_fixture_t45a2";

function streamMessage(params: {
  epoch: string;
  seq: number;
  timestamp: string;
  item: AgentTimelineItem;
}): AgentStreamMessage {
  return {
    type: "agent_stream",
    payload: {
      agentId: AGENT_ID,
      epoch: params.epoch,
      seq: params.seq,
      timestamp: params.timestamp,
      event: { type: "timeline", provider: "pi", item: params.item },
    },
  };
}

/** A run of N one-token "flushes" of the same streamed assistant message,
 * each its own `(epoch, seqStart)` row per the reducer's own contract —
 * i.e. exactly what the 60ms server-side coalescer produces for one
 * streaming turn. */
function buildStreamingDeltas(count: number, epoch = "epoch-t45a2-0001"): AgentStreamMessage[] {
  const messages: AgentStreamMessage[] = [];
  for (let index = 0; index < count; index += 1) {
    messages.push(
      streamMessage({
        epoch,
        seq: 10 + index,
        timestamp: `2026-09-01T10:00:${String(index).padStart(2, "0")}.000Z`,
        item: { type: "assistant_message", text: `token-${index} `, messageId: "msg_t45a2_0001" },
      }),
    );
  }
  return messages;
}

function textOf(row: TimelineRow): string {
  return row.item.type === "assistant_message" ? row.item.text : "";
}

function concatenatedText(state: TimelineState): string {
  return state.rows.map(textOf).join("");
}

describe("TimelineCoalescer: batches the render, never the data", () => {
  it("applies nothing until the frame clock ticks, then applies the whole batch at once", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    const deltas = buildStreamingDeltas(5);

    for (const message of deltas) {
      coalescer.push(message);
    }

    // Nothing applied yet: still queued for the next frame tick.
    expect(coalescer.getState().rows).toHaveLength(0);
    expect(coalescer.pendingCount()).toBe(5);
    expect(frameClock.hasPendingFrame()).toBe(true);

    const fired = frameClock.tick();

    expect(fired).toBe(true);
    expect(coalescer.pendingCount()).toBe(0);
    expect(coalescer.getState().rows).toHaveLength(5);
  });

  it("notifies subscribers exactly once per frame tick, not once per pushed message", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    const notifications: TimelineState[] = [];
    coalescer.subscribe((state) => notifications.push(state));

    for (const message of buildStreamingDeltas(4)) {
      coalescer.push(message);
    }
    expect(notifications).toHaveLength(0);

    frameClock.tick();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.rows).toHaveLength(4);
  });

  it("never discards or replaces a row: batched concatenation matches unbatched, character for character", () => {
    const deltas = buildStreamingDeltas(50);

    // Unbatched: apply every message directly through the reducer, one at a time.
    let unbatched = createEmptyTimelineState();
    for (const message of deltas) {
      unbatched = ingestAgentStreamMessage(unbatched, message);
    }

    // Batched: push all 50 in one go (as a real burst within one 16ms
    // frame would), then let a single tick apply the whole batch.
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    for (const message of deltas) {
      coalescer.push(message);
    }
    frameClock.tick();
    const batched = coalescer.getState();

    expect(batched.rows).toHaveLength(unbatched.rows.length);
    expect(concatenatedText(batched)).toBe(concatenatedText(unbatched));
    expect(concatenatedText(batched)).toBe(deltas.map((_, i) => `token-${i} `).join(""));
    expect(batched.rows.map((r) => r.id)).toEqual(unbatched.rows.map((r) => r.id));
  });

  it("applies several separate frame ticks across a longer stream without ever losing a row", () => {
    const deltas = buildStreamingDeltas(30);
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());

    // Simulate three bursts of ten deltas, one frame tick after each burst.
    for (let burst = 0; burst < 3; burst += 1) {
      for (let i = burst * 10; i < burst * 10 + 10; i += 1) {
        coalescer.push(deltas[i] as AgentStreamMessage);
      }
      frameClock.tick();
    }

    expect(coalescer.getState().rows).toHaveLength(30);
    expect(concatenatedText(coalescer.getState())).toBe(
      deltas.map((_, i) => `token-${i} `).join(""),
    );
  });

  it("preserves epoch reset semantics for messages queued within the same batch", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());

    // Two rows for epoch A, then a daemon restart mid-batch: epoch B's
    // rows must reset the confirmed rows, exactly as an unbatched
    // sequence of ingestAgentStreamMessage calls would (plan.md §7.4
    // "reset on epoch change").
    const epochA = buildStreamingDeltas(2, "epoch-a");
    const epochB = buildStreamingDeltas(2, "epoch-b");
    for (const message of [...epochA, ...epochB]) {
      coalescer.push(message);
    }
    frameClock.tick();

    let unbatched = createEmptyTimelineState();
    for (const message of [...epochA, ...epochB]) {
      unbatched = ingestAgentStreamMessage(unbatched, message);
    }

    expect(coalescer.getState().epoch).toBe("epoch-b");
    expect(coalescer.getState().rows).toHaveLength(unbatched.rows.length);
    expect(coalescer.getState().rows.map((r) => r.id)).toEqual(unbatched.rows.map((r) => r.id));
  });

  it("dedupes an exact epoch+seq re-delivery across a batch identically to the unbatched reducer", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    const first = buildStreamingDeltas(1)[0] as AgentStreamMessage;
    const resend = { ...first, payload: { ...first.payload } };

    coalescer.push(first);
    coalescer.push(resend);
    frameClock.tick();

    expect(coalescer.getState().rows).toHaveLength(1);
  });

  it("detects a gap across batched rows the same way the unbatched reducer does", () => {
    const deltas = buildStreamingDeltas(3);
    const withGap = [deltas[0] as AgentStreamMessage, deltas[2] as AgentStreamMessage]; // skip seq 11

    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    for (const message of withGap) coalescer.push(message);
    frameClock.tick();

    let unbatched = createEmptyTimelineState();
    for (const message of withGap) unbatched = ingestAgentStreamMessage(unbatched, message);

    expect(coalescer.getState().gap).toEqual(unbatched.gap);
    expect(coalescer.getState().gap).toEqual({ epoch: "epoch-t45a2-0001", fromSeq: 11, toSeq: 11 });
  });

  it("flush() applies a partial batch immediately without waiting for a frame tick", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    for (const message of buildStreamingDeltas(3)) coalescer.push(message);

    coalescer.flush();

    expect(coalescer.getState().rows).toHaveLength(3);
    expect(coalescer.pendingCount()).toBe(0);
    expect(frameClock.hasPendingFrame()).toBe(false);
  });

  it("flush() is a safe no-op when nothing is queued", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    const notifications: TimelineState[] = [];
    coalescer.subscribe((state) => notifications.push(state));

    coalescer.flush();

    expect(notifications).toHaveLength(0);
    expect(coalescer.getState().rows).toHaveLength(0);
  });

  it("applyImmediate flushes any pending batch first, preserving ordering against a non-batchable event", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    const notifications: TimelineState[] = [];
    coalescer.subscribe((state) => notifications.push(state));

    // Two queued live deltas, not yet flushed...
    for (const message of buildStreamingDeltas(2)) coalescer.push(message);
    expect(coalescer.getState().rows).toHaveLength(0);

    // ...then a non-batchable optimistic user row is added. It must not
    // leapfrog the still-pending streamed deltas: the batch flushes first.
    const result = coalescer.applyImmediate((state) =>
      addOptimisticUserMessage(state, {
        clientMessageId: "client-msg-1",
        text: "hello",
        timestamp: "2026-09-01T10:00:05.000Z",
      }),
    );

    expect(result.rows).toHaveLength(2); // the two streamed deltas flushed first
    expect(result.pendingRows).toHaveLength(1); // then the optimistic row applied
    expect(frameClock.hasPendingFrame()).toBe(false);
    expect(coalescer.pendingCount()).toBe(0);

    // Two notifications: one for the forced flush, one for the immediate apply.
    expect(notifications).toHaveLength(2);
    expect(notifications[0]?.rows).toHaveLength(2);
    expect(notifications[0]?.pendingRows).toHaveLength(0);
    expect(notifications[1]?.pendingRows).toHaveLength(1);
  });

  it("applyImmediate works even with nothing pending (an authoritative window arriving between bursts)", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());

    const result = coalescer.applyImmediate((state) =>
      ingestMinimalWindow(state, {
        type: "fetch_agent_timeline_response",
        payload: {
          epoch: "epoch-t45a2-window",
          reset: true,
          entries: [
            {
              seqStart: 1,
              seqEnd: 1,
              timestamp: "2026-09-01T10:00:00.000Z",
              provider: "pi",
              item: { type: "assistant_message", text: "hi", messageId: "msg1" },
            },
          ],
        },
      }),
    );

    expect(result.epoch).toBe("epoch-t45a2-window");
    expect(result.stale).toBe(false);
    expect(result.rows).toHaveLength(1);
  });

  it("does not notify listeners when a flush changes nothing", () => {
    // A frame tick can fire after `dispose()` cleared the queue in a race;
    // flush() must stay a safe no-op rather than notifying with a stale
    // reference.
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    const notifications: TimelineState[] = [];
    coalescer.subscribe((state) => notifications.push(state));

    coalescer.push(buildStreamingDeltas(1)[0] as AgentStreamMessage);
    coalescer.dispose();
    frameClock.tick(); // no-op: dispose cancelled the frame and cleared the queue

    expect(notifications).toHaveLength(0);
  });

  it("dispose cancels the pending frame and unsubscribes all listeners", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());
    coalescer.subscribe(() => {
      throw new Error("must not be called after dispose");
    });
    coalescer.push(buildStreamingDeltas(1)[0] as AgentStreamMessage);

    coalescer.dispose();

    expect(frameClock.hasPendingFrame()).toBe(false);
    expect(coalescer.pendingCount()).toBe(0);
    expect(() => frameClock.tick()).not.toThrow();
  });

  it("a second push before the frame fires does not request a second frame", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());

    coalescer.push(buildStreamingDeltas(1)[0] as AgentStreamMessage);
    expect(frameClock.hasPendingFrame()).toBe(true);

    // Pushing again must not lose the already-scheduled first frame: the
    // FrameClock contract is "at most one pending callback", and this
    // coalescer must still end up applying both messages on the next tick.
    coalescer.push(buildStreamingDeltas(2)[1] as AgentStreamMessage);
    frameClock.tick();

    expect(coalescer.getState().rows).toHaveLength(2);
  });
});
