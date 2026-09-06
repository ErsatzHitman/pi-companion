/**
 * End-to-end proof for T45A3's two behavioural acceptance criteria
 * (plan.md §14.5): this app's real `requestAnimationFrame`-backed
 * `FrameClock` (`./frame-clock.ts`), driving the real `TimelineCoalescer`
 * (T45A2, `@picompanion/frontend-core`), driving the real `Transcript`
 * feature component (T28A2, `../features/transcript/transcript.tsx`) —
 * no fakes standing in for any of those three layers.
 *
 * 1. "A test drives 100 updates per second and asserts live-event-to-paint
 *    p95 under 100 ms": each pushed `agent_stream` message's arrival time
 *    is compared against the timestamp the coalescer's subscriber (the
 *    point at which React would next commit a paint) observes for the
 *    frame flush that applied it.
 * 2. "Committed transcript items do not re-render while only the
 *    streaming item is updating": a first, already-flushed message's row
 *    keeps a stable `data-render-count` while a second message's stream
 *    of deltas keeps arriving and flushing.
 *
 * Uses fake timers so `requestAnimationFrame` (and `Date.now`) advance
 * deterministically — see this file's sibling `frame-clock.test.ts` doc
 * comments for why that makes `vi.advanceTimersByTime` here exact rather
 * than a source of flake.
 */
import { useEffect, useState } from "react";
import { cleanup, render } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";
import { timeline } from "@picompanion/frontend-core";

import { Transcript } from "../features/transcript/transcript.js";
import { createBrowserFrameClock } from "./frame-clock.js";

afterEach(cleanup);

const AGENT_ID = "agt_t45a3_paint_budget";
const EPOCH = "epoch-t45a3-0001";

function streamMessage(params: {
  seq: number;
  messageId: string;
  text: string;
  timestampMs: number;
}): AgentStreamMessage {
  return {
    type: "agent_stream",
    payload: {
      agentId: AGENT_ID,
      epoch: EPOCH,
      seq: params.seq,
      timestamp: new Date(params.timestampMs).toISOString(),
      event: {
        type: "timeline",
        provider: "pi",
        item: { type: "assistant_message", text: params.text, messageId: params.messageId },
      },
    },
  };
}

/** Minimal React harness: subscribes to a `TimelineCoalescer` and renders
 * the real `Transcript` feature component from its live state — exactly
 * the shape a session view (owned by a different task) would wire it in
 * as. Nothing here is a stand-in for `Transcript`'s own rendering or
 * memoization; both are the real, already-shipped T28A2 component. */
function Harness({ coalescer }: { coalescer: timeline.TimelineCoalescer }) {
  const [state, setState] = useState(coalescer.getState());
  useEffect(() => coalescer.subscribe(setState), [coalescer]);
  const view = timeline.buildTranscriptView(state);
  return <Transcript entries={view.entries} testId="harness-transcript" />;
}

describe("web FrameClock + TimelineCoalescer + Transcript: paint budget and no stale re-render", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps live-event-to-paint p95 under 100ms while driven at 100 updates/sec, and never re-renders a committed row", () => {
    const frameClock = createBrowserFrameClock();
    const coalescer = new timeline.TimelineCoalescer(
      frameClock,
      timeline.createEmptyTimelineState(),
    );

    // A first message, already fully flushed before the high-rate stream
    // starts — this is the "committed" row whose render count must never
    // move again once the second message starts streaming.
    coalescer.push(
      streamMessage({ seq: 1, messageId: "msg-committed", text: "Earlier reply.", timestampMs: 0 }),
    );
    coalescer.flush();

    const { getByTestId, unmount } = render(<Harness coalescer={coalescer} />);
    const committedRowTestId = `transcript-row-${EPOCH}:1`;
    const committedRenderCountBefore =
      getByTestId(committedRowTestId).parentElement?.getAttribute("data-render-count");
    expect(committedRenderCountBefore).toBe("1");

    // Drive a second message at 100 updates/sec (one push every 10ms) for
    // one second — 100 pushed deltas, each its own row per plan.md §7.4's
    // delta-based-end-to-end contract (verified: see
    // `packages/frontend-core/src/timeline/coalescer.ts`'s module doc
    // comment). Every notification from the coalescer marks every row
    // pushed-but-not-yet-flushed up through its current row count as
    // flushed *now* — that is the live-event-to-paint boundary this test
    // measures against each push's own recorded arrival time.
    const UPDATE_COUNT = 100;
    const UPDATE_INTERVAL_MS = 10;
    const pushedAtBySeq = new Map<number, number>();
    const flushedAtBySeq = new Map<number, number>();
    let lastFlushedSeq = 1;

    const unsubscribe = coalescer.subscribe(() => {
      const notifiedAt = Date.now();
      const flushedThroughSeq = 1 + coalescer.getState().rows.length - 1;
      for (let seq = lastFlushedSeq + 1; seq <= flushedThroughSeq; seq += 1) {
        flushedAtBySeq.set(seq, notifiedAt);
      }
      lastFlushedSeq = flushedThroughSeq;
    });

    for (let i = 0; i < UPDATE_COUNT; i += 1) {
      const seq = 2 + i;
      pushedAtBySeq.set(seq, Date.now());
      coalescer.push(
        streamMessage({
          seq,
          messageId: "msg-streaming",
          text: `chunk-${i} `,
          timestampMs: Date.now(),
        }),
      );
      vi.advanceTimersByTime(UPDATE_INTERVAL_MS);
    }
    // Let any still-pending final batch flush (one more rAF tick).
    vi.advanceTimersByTime(32);
    unsubscribe();

    expect(coalescer.getState().rows).toHaveLength(1 + UPDATE_COUNT);
    expect(flushedAtBySeq.size).toBe(UPDATE_COUNT);

    const latencies = [...pushedAtBySeq.entries()]
      .map(([seq, pushedAt]) => {
        const flushedAt = flushedAtBySeq.get(seq);
        expect(flushedAt).toBeDefined();
        return (flushedAt as number) - pushedAt;
      })
      .sort((a, b) => a - b);
    const p95Index = Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1);
    const p95Latency = latencies[p95Index] as number;

    expect(p95Latency).toBeLessThan(100);

    // Confirm the first message's row was never re-rendered by the flood
    // of unrelated new rows appended after it.
    const committedRenderCountAfter =
      getByTestId(committedRowTestId).parentElement?.getAttribute("data-render-count");
    expect(committedRenderCountAfter).toBe("1");

    unmount();
    coalescer.dispose();
  });

  it("renders the coalescer-driven transcript with no axe violations", async () => {
    // `axe-core`'s own async internals rely on real timers/microtasks;
    // this test needs no rAF stepping (the single row below is applied
    // synchronously by `flush()`), so real timers are safe here.
    vi.useRealTimers();
    const frameClock = createBrowserFrameClock();
    const coalescer = new timeline.TimelineCoalescer(
      frameClock,
      timeline.createEmptyTimelineState(),
    );
    coalescer.push(
      streamMessage({ seq: 1, messageId: "msg-a11y", text: "Hello there.", timestampMs: 0 }),
    );
    coalescer.flush();

    const { container, unmount } = render(<Harness coalescer={coalescer} />);

    expect(await axe(container)).toHaveNoViolations();

    unmount();
    coalescer.dispose();
  }, 15_000);
});
