/**
 * Streaming timeline batcher — plan.md §7.4, §14.5; T45A2.
 *
 * **Verified, not assumed:** the daemon's stream is delta-based end to
 * end. `packages/server/src/server/agent/agent-stream-coalescer.ts`
 * coalesces on a 60 ms window by *concatenation*
 * (`previous.text += entry.text`) and flushes an item carrying only that
 * window's text; `./reducer.ts`'s `ingestAgentStreamMessage` never
 * concatenates — every flush becomes its own row keyed by
 * `(epoch, seqStart)` (see `ingestEntry`/`findInsertIndex` there). So
 * **dropping or replacing a pending update permanently loses text**: a
 * naive "only keep the latest" rate limiter is unsafe here, and this
 * module never does that.
 *
 * Instead, `TimelineCoalescer` batches the **render**, never the data
 * (plan.md §7.4 "Rate control therefore batches the render onto a frame
 * clock ... and must never drop or replace a row"):
 *
 * - every pushed `agent_stream` message is queued, in order, and none is
 *   ever discarded;
 * - a single `FrameClock` (T45A1) frame is requested the moment the queue
 *   goes from empty to non-empty;
 * - when that frame fires, every queued message ingests through the
 *   existing, unmodified `ingestAgentStreamMessage` reducer, in order, as
 *   one state transition — so a burst of N deltas in one frame window
 *   produces exactly one state update and one listener notification,
 *   bounding paint cost to one paint per frame regardless of N
 *   (plan.md §14.5's "core batches pending rows into one application per
 *   tick");
 * - `applyImmediate` lets a caller fold in a non-batchable transition (an
 *   authoritative `fetch_agent_timeline_response` window, a stale-cache
 *   restore, an optimistic-row addition) — anything that must not wait a
 *   frame and must not be reordered against already-queued pushes. It
 *   flushes the pending batch first, so relative ordering between batched
 *   live pushes and the non-batchable transition is always preserved.
 *
 * This module owns no wire I/O and no socket: a host (the connection
 * layer that already deserializes `agent_stream` frames) calls `push` for
 * each one instead of calling `ingestAgentStreamMessage` directly. Epoch
 * reset, epoch/seq dedupe, gap detection, `replaceMessageId` correction,
 * and optimistic reconciliation are entirely `reducer.ts`'s (T20A/T20B)
 * concern, unchanged: this module only decides *when* those reducer calls
 * happen, never *what* they compute.
 */
import type { AgentStreamMessage } from "@picompanion/protocol/messages";

import type { FrameCallback, FrameClock } from "../platform/frame-clock.js";
import { ingestAgentStreamMessage } from "./reducer.js";
import type { TimelineState } from "./types.js";

export type TimelineCoalescerListener = (state: TimelineState) => void;

/**
 * Batches live `agent_stream` timeline pushes onto a `FrameClock` (T45A1)
 * so a burst of streaming deltas produces one applied state transition per
 * frame tick instead of one per message, without ever dropping, replacing,
 * or reordering a row (see module doc comment).
 */
export class TimelineCoalescer {
  private readonly frameClock: FrameClock;
  private readonly listeners = new Set<TimelineCoalescerListener>();
  private state: TimelineState;
  private pending: AgentStreamMessage[] = [];
  private readonly onFrame: FrameCallback = () => {
    this.flush();
  };

  constructor(frameClock: FrameClock, initialState: TimelineState) {
    this.frameClock = frameClock;
    this.state = initialState;
  }

  /** The most recently applied `TimelineState`. Does not include any batch
   * still waiting for the next frame tick — call `flush()` first if a
   * caller needs the very latest state synchronously (e.g. before reading
   * it for an immediate, non-rendering purpose). */
  getState(): TimelineState {
    return this.state;
  }

  /** Number of `agent_stream` messages queued for the next frame tick,
   * not yet applied. Test/diagnostic use. */
  pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Registers `listener` to be called with the new `TimelineState` every
   * time this coalescer applies one (whether via a batched frame flush or
   * `applyImmediate`). Returns an unsubscribe function. A listener is
   * never called for a flush that changes nothing (reference-equal
   * before/after), mirroring `reducer.ts`'s own no-op-preserves-reference
   * convention.
   */
  subscribe(listener: TimelineCoalescerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Queues one live `agent_stream` message for batched application. Never
   * applied synchronously and never dropped: it is guaranteed to ingest,
   * in the order it was pushed relative to every other queued message,
   * the next time this coalescer's pending batch flushes (on the next
   * frame tick, or sooner via an explicit `flush()`/`applyImmediate()`
   * call).
   */
  push(message: AgentStreamMessage): void {
    this.pending.push(message);
    if (this.pending.length === 1) {
      // Empty -> non-empty: this is the first queued message since the
      // last flush, so a frame is not already pending for this batch.
      // (`FrameClock.requestFrame` replaces rather than queues a second
      // callback, so calling this defensively on every push would still
      // be safe, but tracking it explicitly here keeps the "at most one
      // outstanding frame request per batch" invariant visible in this
      // module's own logic, not just inferred from the platform contract.)
      this.frameClock.requestFrame(this.onFrame);
    }
  }

  /**
   * Applies every currently queued message, in order, as a single state
   * transition, and notifies subscribers at most once with the result.
   * A no-op (does not touch the frame clock or notify anyone) when
   * nothing is queued — safe to call unconditionally, including from a
   * frame tick that raced an already-manually-flushed batch.
   */
  flush(): void {
    if (this.pending.length === 0) {
      return;
    }
    const batch = this.pending;
    this.pending = [];
    this.frameClock.cancelFrame();
    this.applyAndNotify((state) => {
      let next = state;
      for (const message of batch) {
        next = ingestAgentStreamMessage(next, message);
      }
      return next;
    });
  }

  /**
   * Applies a non-batchable state transition immediately: flushes any
   * pending batched pushes first (so a non-batchable event's relative
   * order against already-queued live pushes is preserved — this
   * module's "any non-batchable event flushes the pending batch before
   * it" contract, T45A2), then runs `transform` and notifies subscribers
   * if it changed anything. Returns the resulting state.
   *
   * Intended for the timeline transitions this module deliberately does
   * not batch: an authoritative `fetch_agent_timeline_response` window
   * (`ingestTimelineWindow`), a stale-cache restore
   * (`restoreCachedTimeline`), or adding a local optimistic row
   * (`addOptimisticUserMessage`) — none of these are a live `agent_stream`
   * push, and each represents information a caller needs reflected
   * without waiting a frame.
   */
  applyImmediate(transform: (state: TimelineState) => TimelineState): TimelineState {
    this.flush();
    this.applyAndNotify(transform);
    return this.state;
  }

  private applyAndNotify(transform: (state: TimelineState) => TimelineState): void {
    const next = transform(this.state);
    if (next === this.state) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  /** Cancels any pending frame request and drops any not-yet-applied
   * queued messages. Only for host teardown (e.g. a session view
   * unmounting): dropping queued-but-unflushed messages here is not the
   * "never drop a row" violation the module doc comment warns about,
   * since nothing after teardown will ever read the resulting state
   * again. Call `flush()` first if a caller wants queued messages applied
   * before teardown instead. */
  dispose(): void {
    this.frameClock.cancelFrame();
    this.pending = [];
    this.listeners.clear();
  }
}
