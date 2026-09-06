import { describe, expect, it, vi } from "vitest";
import type { AppLifecycle, AppLifecycleState } from "@picompanion/frontend-core";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";

import { createTranscriptMessageBatcher } from "./transcript-message-batcher";

/**
 * `FakeLifecycle`/`createFakeSchedulers()` are the same deterministic
 * fakes `../../platform/frame-clock.test.ts` (T33A2B) established for
 * `createAppFrameClock` — copied here rather than imported, since that
 * test file exports nothing (test files are not meant to be library
 * code). This suite drives the *real*, unmodified `createAppFrameClock`
 * production adapter (not `TestFrameClock`'s simpler unconditional-
 * foreground fake from `@picompanion/frontend-core`), so the proof below
 * covers the actual code path a real Android app boundary runs.
 */
class FakeLifecycle implements AppLifecycle {
  private state: AppLifecycleState;
  private readonly listeners = new Set<(state: AppLifecycleState) => void>();

  constructor(initial: AppLifecycleState = "active") {
    this.state = initial;
  }

  getState(): AppLifecycleState {
    return this.state;
  }

  subscribe(listener: (state: AppLifecycleState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setState(next: AppLifecycleState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

function createFakeSchedulers() {
  let nextHandle = 1;
  let nowMs = 0;
  const rafQueue = new Map<number, (timestamp: number) => void>();
  const timerQueue = new Map<number, { callback: () => void; dueAt: number }>();

  return {
    requestAnimationFrame: vi.fn((callback: (timestamp: number) => void) => {
      const handle = nextHandle++;
      rafQueue.set(handle, callback);
      return handle;
    }),
    cancelAnimationFrame: vi.fn((handle: number) => {
      rafQueue.delete(handle);
    }),
    setTimeout: vi.fn((callback: () => void, delayMs: number) => {
      const handle = nextHandle++;
      timerQueue.set(handle, { callback, dueAt: nowMs + delayMs });
      return handle;
    }),
    clearTimeout: vi.fn((handle: number) => {
      timerQueue.delete(handle);
    }),
    now: () => nowMs,
    flushRaf(): void {
      nowMs += 16;
      const pending = [...rafQueue.values()];
      rafQueue.clear();
      for (const callback of pending) callback(nowMs);
    },
    get rafPendingCount(): number {
      return rafQueue.size;
    },
  };
}

function harness(initial: AppLifecycleState = "active") {
  const lifecycle = new FakeLifecycle(initial);
  const schedulers = createFakeSchedulers();
  const batcher = createTranscriptMessageBatcher({ lifecycle, ...schedulers });
  return { lifecycle, schedulers, batcher };
}

/** One-token streaming deltas for the same assistant row, exactly the
 * shape `packages/frontend-core/src/timeline/coalescer.test.ts`'s
 * `buildStreamingDeltas` uses for the identical claim on web/core: N
 * flushes of one streamed message, each its own `(epoch, seqStart)` row
 * per the reducer's contract, matching what the daemon's 60ms server-side
 * coalescer actually emits for one streaming turn. */
function streamingDeltas(count: number, seqOffset = 0): AgentStreamMessage[] {
  const messages: AgentStreamMessage[] = [];
  for (let index = 0; index < count; index += 1) {
    messages.push({
      type: "agent_stream",
      payload: {
        agentId: "agt_fixture_t33a2",
        epoch: "epoch-t33a2-0001",
        seq: 10 + seqOffset + index,
        timestamp: `2026-09-03T10:00:${String(index).padStart(2, "0")}.000Z`,
        event: {
          type: "timeline",
          provider: "pi",
          item: {
            type: "assistant_message",
            text: `token-${index} `,
            messageId: "msg_t33a2_0001",
          },
        },
      },
    });
  }
  return messages;
}

describe("createTranscriptMessageBatcher: a burst of N pushes applies as ONE transition per frame tick", () => {
  it("queues every push without applying until the frame clock ticks", () => {
    const { batcher } = harness();
    for (const message of streamingDeltas(5)) {
      batcher.push(message);
    }
    expect(batcher.pendingCount()).toBe(5);
    expect(batcher.getMessageEntries()).toHaveLength(0);
  });

  it("notifies subscribers exactly once for a 5-message burst, not five times", () => {
    const { batcher, schedulers } = harness();
    const listener = vi.fn();
    batcher.subscribe(listener);

    for (const message of streamingDeltas(5)) {
      batcher.push(message);
    }
    expect(listener).not.toHaveBeenCalled();

    schedulers.flushRaf();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(batcher.pendingCount()).toBe(0);
  });

  it("the single applied batch contains every queued delta's text, in order — none dropped, none reordered", () => {
    const { batcher, schedulers } = harness();
    const listener = vi.fn();
    batcher.subscribe(listener);

    for (const message of streamingDeltas(5)) {
      batcher.push(message);
    }
    schedulers.flushRaf();

    const entries = batcher.getMessageEntries();
    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry.text)).toEqual([
      "token-0 ",
      "token-1 ",
      "token-2 ",
      "token-3 ",
      "token-4 ",
    ]);
    expect(listener).toHaveBeenLastCalledWith(entries);
  });

  it("a second burst after the first flush produces its own single, separate transition", () => {
    const { batcher, schedulers } = harness();
    const listener = vi.fn();
    batcher.subscribe(listener);

    for (const message of streamingDeltas(3)) batcher.push(message);
    schedulers.flushRaf();
    expect(listener).toHaveBeenCalledTimes(1);

    for (const message of streamingDeltas(2, 100)) {
      batcher.push(message);
    }
    expect(listener).toHaveBeenCalledTimes(1); // still queued, not yet flushed
    schedulers.flushRaf();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("applyImmediate flushes any pending batch first, preserving relative order, and notifies once more", () => {
    const { batcher, schedulers } = harness();
    const listener = vi.fn();
    batcher.subscribe(listener);

    for (const message of streamingDeltas(2)) batcher.push(message);
    batcher.applyImmediate((state) => state); // no-op transform, but still flushes the pending batch first

    expect(listener).toHaveBeenCalledTimes(1); // the flush; the no-op applyImmediate itself changes nothing
    expect(batcher.getMessageEntries()).toHaveLength(2);
    expect(schedulers.rafPendingCount).toBe(0); // flush() cancels the now-redundant frame request
  });

  it("dispose() tears down the frame clock so a late tick cannot fire", () => {
    const { batcher, schedulers } = harness();
    const listener = vi.fn();
    batcher.subscribe(listener);
    batcher.push(streamingDeltas(1)[0]);
    batcher.dispose();

    expect(schedulers.rafPendingCount).toBe(0);
  });
});
