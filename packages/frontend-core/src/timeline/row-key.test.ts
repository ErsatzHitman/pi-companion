/**
 * Tests for `./row-key.ts` (T388).
 *
 * The claim under test is *stability*: one logical row keeps one key across
 * every state transition a timeline can go through, and two different rows
 * never collide. Every case below drives the real reducer (never a hand-built
 * row list) so the keys are proved stable through the exact transitions the
 * brief names — append, prepend a page, a coalesced stream update, a
 * reconnect/gap-recovery replay, and a full re-derivation.
 */
import { describe, expect, it } from "vitest";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";
import type { AgentTimelineItem } from "@picompanion/protocol/agent-types";

import { TestFrameClock } from "../platform/frame-clock.js";
import { TimelineCoalescer } from "./coalescer.js";
import { buildTranscriptEntries, transcriptEntryListKey } from "./transcript-view.js";
import { ingestAgentStreamMessage, ingestTimelineWindow } from "./reducer.js";
import { deriveTimelineRowKey, stableRowKey } from "./row-key.js";
import type { TimelineRow, TimelineState } from "./types.js";
import { createEmptyTimelineState } from "./types.js";

const EPOCH = "epoch-t388-0001";

function streamMessage(seq: number, item: AgentTimelineItem): AgentStreamMessage {
  return {
    type: "agent_stream",
    payload: {
      agentId: "agt_t388",
      epoch: EPOCH,
      seq,
      timestamp: `2026-09-12T10:00:${String(seq % 60).padStart(2, "0")}.000Z`,
      event: { type: "timeline", provider: "pi", item },
    },
  };
}

type WindowEntry = {
  seqStart: number;
  seqEnd: number;
  timestamp: string;
  provider: string;
  item: AgentTimelineItem;
};

function windowEntry(seqStart: number, item: AgentTimelineItem, seqEnd = seqStart): WindowEntry {
  return {
    seqStart,
    seqEnd,
    timestamp: `2026-09-12T10:00:${String(seqStart % 60).padStart(2, "0")}.000Z`,
    provider: "pi",
    item,
  };
}

function ingestWindow(
  state: TimelineState,
  entries: readonly WindowEntry[],
  options: { epoch?: string; reset?: boolean } = {},
): TimelineState {
  return ingestTimelineWindow(state, {
    type: "fetch_agent_timeline_response",
    payload: {
      epoch: options.epoch ?? EPOCH,
      reset: options.reset ?? false,
      entries: entries as never,
    },
  } as never);
}

function ingest(state: TimelineState, seq: number, item: AgentTimelineItem): TimelineState {
  return ingestAgentStreamMessage(state, streamMessage(seq, item));
}

/** A mix that exercises every rung of the ladder, built entirely through the
 * reducer's own ingestion paths. */
function buildMixedState(): TimelineState {
  let state = createEmptyTimelineState();
  state = ingest(state, 1, { type: "user_message", text: "hello", clientMessageId: "cm_1" });
  state = ingest(state, 2, { type: "reasoning", text: "thinking about it" });
  state = ingest(state, 3, {
    type: "tool_call",
    callId: "call_1",
    name: "read",
    detail: { type: "read", filePath: "/tmp/a.ts" },
    status: "running",
    error: null,
  });
  state = ingest(state, 4, {
    type: "assistant_message",
    text: "token ",
    messageId: "msg_1",
  });
  state = ingest(state, 5, { type: "todo", items: [{ text: "do it", completed: false }] });
  return state;
}

function keysOf(state: TimelineState): string[] {
  return state.rows.map((row) => stableRowKey(row));
}

function keyOfSeq(state: TimelineState, seq: number): string {
  const row = state.rows.find((candidate) => candidate.seqStart === seq);
  if (!row) {
    throw new Error(`no row at seq ${seq}`);
  }
  return stableRowKey(row);
}

describe("deriveTimelineRowKey: the identity ladder", () => {
  it("prefers the item's own durable identity over the row's sequence", () => {
    const epoch = EPOCH;
    expect(
      deriveTimelineRowKey({
        epoch,
        seqStart: 3,
        item: {
          type: "tool_call",
          callId: "call_42",
          name: "read",
          detail: { type: "unknown", input: null, output: null },
          status: "running",
          error: null,
        },
      }),
    ).toEqual({ key: "tool:call_42", source: "tool-call" });

    expect(
      deriveTimelineRowKey({
        epoch,
        seqStart: 4,
        item: { type: "user_message", text: "hi", clientMessageId: "cm_9" },
      }),
    ).toEqual({ key: "client:cm_9", source: "user-message" });

    expect(
      deriveTimelineRowKey({
        epoch,
        seqStart: 5,
        item: { type: "user_message", text: "hi", messageId: "msg_9" },
      }),
    ).toEqual({ key: "message:msg_9", source: "user-message" });

    expect(
      deriveTimelineRowKey({
        epoch,
        seqStart: 6,
        item: { type: "assistant_message", text: "a", messageId: "msg_a" },
      }),
    ).toEqual({ key: "assistant:msg_a:6", source: "assistant-message" });
  });

  it("labels a still-pending user message 'optimistic' but keys it the same as its confirmed row", () => {
    const pending = deriveTimelineRowKey({
      epoch: "",
      seqStart: Number.POSITIVE_INFINITY,
      pending: true,
      item: { type: "user_message", text: "hi", clientMessageId: "cm_7" },
    });
    const confirmed = deriveTimelineRowKey({
      epoch: EPOCH,
      seqStart: 12,
      item: { type: "user_message", text: "hi", clientMessageId: "cm_7" },
    });

    expect(pending.source).toBe("optimistic");
    expect(confirmed.source).toBe("user-message");
    // The whole point: reconciliation is invisible to a list key.
    expect(pending.key).toBe(confirmed.key);
  });

  it("falls back to the sequence identity only when the item carries no durable id", () => {
    expect(
      deriveTimelineRowKey({
        epoch: EPOCH,
        seqStart: 11,
        item: { type: "reasoning", text: "hmm" },
      }),
    ).toEqual({ key: `seq:${EPOCH}:11`, source: "sequence" });

    expect(
      deriveTimelineRowKey({
        epoch: EPOCH,
        seqStart: 12,
        item: { type: "assistant_message", text: "no id here" },
      }),
    ).toEqual({ key: `seq:${EPOCH}:12`, source: "sequence" });
  });

  it("keeps distinct rows distinct: every assistant delta of one message gets its own key", () => {
    const keys = [10, 11, 12].map((seqStart) =>
      stableRowKey({
        epoch: EPOCH,
        seqStart,
        item: { type: "assistant_message", text: "t", messageId: "msg_x" },
      }),
    );
    expect(new Set(keys).size).toBe(3);
  });
});

describe("stable row keys across every transition", () => {
  it("appending a row leaves every earlier row's key unchanged", () => {
    const before = buildMixedState();
    const keysBefore = keysOf(before);

    const after = ingest(before, 6, { type: "reasoning", text: "more" });

    expect(keysOf(after).slice(0, keysBefore.length)).toEqual(keysBefore);
  });

  it("prepending an earlier page leaves every existing row's key unchanged", () => {
    // Load the tail first, then a page of earlier rows — the order a real
    // session resume + "load earlier" produces.
    let state = ingestWindow(createEmptyTimelineState(), [
      windowEntry(3, { type: "reasoning", text: "third" }),
      windowEntry(4, { type: "assistant_message", text: "answer", messageId: "msg_1" }),
    ]);
    const keysBefore = keysOf(state);

    state = ingestWindow(state, [
      windowEntry(1, { type: "user_message", text: "q", clientMessageId: "cm_1" }),
      windowEntry(2, { type: "reasoning", text: "second" }),
    ]);

    expect(keysOf(state).slice(2)).toEqual(keysBefore);
    expect(state.rows.map((row) => row.seqStart)).toEqual([1, 2, 3, 4]);
  });

  it("a coalesced stream update to one row leaves that row's key unchanged", () => {
    const frameClock = new TestFrameClock();
    const coalescer = new TimelineCoalescer(frameClock, createEmptyTimelineState());

    coalescer.push(
      streamMessage(1, {
        type: "tool_call",
        callId: "call_stream",
        name: "read",
        detail: { type: "read", filePath: "/tmp/a.ts" },
        status: "running",
        error: null,
      }),
    );
    frameClock.tick();
    const before = keyOfSeq(coalescer.getState(), 1);

    // The terminal update arrives as a later push in the next frame; the
    // reducer merges it into the same row.
    coalescer.push(
      streamMessage(2, {
        type: "tool_call",
        callId: "call_stream",
        name: "read",
        detail: { type: "read", filePath: "/tmp/a.ts", content: "file body" },
        status: "completed",
        error: null,
      }),
    );
    frameClock.tick();

    const state = coalescer.getState();
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.item.type === "tool_call" && state.rows[0].item.status).toBe("completed");
    expect(keyOfSeq(state, 1)).toBe(before);
  });

  it("a reconnect replay ('reset: true' window) reproduces every key", () => {
    const live = buildMixedState();
    const keysBefore = keysOf(live);

    const replayed = ingestWindow(
      live,
      live.rows.map((row) => windowEntry(row.seqStart, row.item, row.seqEnd)),
      { reset: true },
    );

    expect(keysOf(replayed)).toEqual(keysBefore);
  });

  it("a gap-recovery backfill page leaves the rows that revealed the gap on their keys", () => {
    // seq 1 then seq 5: a hole over [2, 4].
    let state = ingestWindow(createEmptyTimelineState(), [
      windowEntry(1, { type: "user_message", text: "q", clientMessageId: "cm_1" }),
      windowEntry(5, { type: "assistant_message", text: "a", messageId: "msg_5" }),
    ]);
    expect(state.gap).toEqual({ epoch: EPOCH, fromSeq: 2, toSeq: 4 });
    const keyAt1 = keyOfSeq(state, 1);
    const keyAt5 = keyOfSeq(state, 5);

    state = ingestWindow(state, [
      windowEntry(2, { type: "reasoning", text: "r2" }),
      windowEntry(3, {
        type: "tool_call",
        callId: "call_3",
        name: "grep",
        detail: { type: "unknown", input: null, output: null },
        status: "completed",
        error: null,
      }),
      windowEntry(4, { type: "reasoning", text: "r4" }),
    ]);

    expect(state.gap).toBeNull();
    expect(keyOfSeq(state, 1)).toBe(keyAt1);
    expect(keyOfSeq(state, 5)).toBe(keyAt5);
    expect(state.rows).toHaveLength(5);
  });

  it("re-deriving from the same input twice produces identical keys", () => {
    const first = buildMixedState();
    const second = buildMixedState();
    expect(keysOf(second)).toEqual(keysOf(first));
  });

  it("keys are unique within one state (no two rows share a list key)", () => {
    const state = buildMixedState();
    const keys = keysOf(state);
    expect(new Set(keys).size).toBe(state.rows.length);
  });
});

describe("TranscriptEntry.key", () => {
  it("carries the derived stable key, and `transcriptEntryListKey` reads it", () => {
    const state = buildMixedState();
    const entries = buildTranscriptEntries(state);
    expect(entries.map((entry) => entry.key)).toEqual(
      entries.map((_, index) => stableRowKey(state.rows[index] as TimelineRow)),
    );
    for (const entry of entries) {
      expect(transcriptEntryListKey(entry)).toBe(entry.key);
    }
  });

  it("is unchanged when the same entries are re-derived after a reconnect replay", () => {
    const live = buildMixedState();
    const replayed = ingestWindow(
      live,
      live.rows.map((row) => windowEntry(row.seqStart, row.item, row.seqEnd)),
      { reset: true },
    );
    expect(buildTranscriptEntries(replayed).map((entry) => entry.key)).toEqual(
      buildTranscriptEntries(live).map((entry) => entry.key),
    );
  });

  it("falls back to `id` for a hand-built entry that predates the field", () => {
    expect(transcriptEntryListKey({ id: "epoch-1:1" })).toBe("epoch-1:1");
  });
});
