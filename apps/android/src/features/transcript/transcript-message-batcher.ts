/**
 * Streaming message batching (T33A2; plan.md §7.4, §14.5).
 *
 * Composes `TimelineCoalescer` (`@picompanion/frontend-core`'s
 * `timeline.TimelineCoalescer`, T45A2) with this platform's real
 * `FrameClock` adapter (`../../platform/frame-clock.ts`'s
 * `createAppFrameClock`, T33A2B) so a burst of N live `agent_stream`
 * pushes for the transcript screen applies as **one** `TimelineState`
 * transition per frame tick, not N — the data-batching half of "streaming
 * text updates incrementally without full re-render" (the render-level
 * half is `message-row-model.ts`'s `areMessageRowPropsEqual`).
 *
 * This module owns no wire I/O and no socket — a caller (the not-yet-
 * built session-connection wiring; T32A1B builds the first real
 * `DaemonClient` on Android this wave, but nothing here waits on or
 * assumes one) feeds already-deserialized `AgentStreamMessage` values
 * through `push`. It narrows `TimelineCoalescer`'s general
 * `TimelineState` to just the `user-message`/`assistant-message` rows
 * this feature renders, via `buildTranscriptEntries` +
 * `isCoreMessageEntry` (both from `@picompanion/frontend-core`,
 * unmodified) — never a private reimplementation of either.
 */
import { timeline as coreTimeline } from "@picompanion/frontend-core";
import type { AgentStreamMessage } from "@picompanion/protocol/messages";

import { createAppFrameClock, type AppFrameClockDeps } from "../../platform/frame-clock";
import { isCoreMessageEntry, type CoreMessageEntry } from "./message-row-model";

export type TranscriptMessageBatcherListener = (entries: CoreMessageEntry[]) => void;

export interface TranscriptMessageBatcher {
  /** Queues one live `agent_stream` message. Never applied synchronously
   * — see `TimelineCoalescer.push`'s doc comment for the "never dropped,
   * never applied out of order" guarantee this delegates to unchanged. */
  push(message: AgentStreamMessage): void;
  /** Applies a non-batchable transition immediately (an authoritative
   * timeline window, a stale-cache restore, an optimistic row) —
   * delegates to `TimelineCoalescer.applyImmediate` unchanged. */
  applyImmediate(
    transform: (state: coreTimeline.TimelineState) => coreTimeline.TimelineState,
  ): void;
  /** Subscribes to every applied batch (frame-flushed or immediate),
   * receiving just the `user-message`/`assistant-message` rows this
   * feature renders. Returns an unsubscribe function. */
  subscribe(listener: TranscriptMessageBatcherListener): () => void;
  /** The message rows from the most recently applied batch. Does not
   * include a batch still queued for the next frame tick. */
  getMessageEntries(): CoreMessageEntry[];
  /** The full underlying `TimelineState`, for a caller that also needs
   * non-message rows (thinking, tool calls, ...) or `gap`/`stale`. */
  getState(): coreTimeline.TimelineState;
  /** Number of `agent_stream` messages queued for the next frame tick,
   * not yet applied. Test/diagnostic use, mirroring
   * `TimelineCoalescer.pendingCount`. */
  pendingCount(): number;
  /** Tears down the frame clock and coalescer. Call on session-view
   * unmount. */
  dispose(): void;
}

function messageEntriesFrom(state: coreTimeline.TimelineState): CoreMessageEntry[] {
  return coreTimeline.buildTranscriptEntries(state).filter(isCoreMessageEntry);
}

/**
 * Builds one batcher for one session's transcript. `frameClockDeps` is
 * forwarded to `createAppFrameClock` unchanged — the real app boundary
 * passes React Native's `requestAnimationFrame`/`setTimeout` globals plus
 * `AppCore["lifecycle"]`; tests pass the same hand-rolled fakes
 * `../../platform/frame-clock.test.ts` already established (`FakeLifecycle`
 * + `createFakeSchedulers()`), so this stays fully deterministic and
 * `react-native`-free under `vitest`.
 */
export function createTranscriptMessageBatcher(
  frameClockDeps: AppFrameClockDeps,
  initialState: coreTimeline.TimelineState = coreTimeline.createEmptyTimelineState(),
): TranscriptMessageBatcher {
  const frameClock = createAppFrameClock(frameClockDeps);
  const coalescer = new coreTimeline.TimelineCoalescer(frameClock, initialState);

  return {
    push(message) {
      coalescer.push(message);
    },
    applyImmediate(transform) {
      coalescer.applyImmediate(transform);
    },
    subscribe(listener) {
      return coalescer.subscribe((state) => {
        listener(messageEntriesFrom(state));
      });
    },
    getMessageEntries() {
      return messageEntriesFrom(coalescer.getState());
    },
    getState() {
      return coalescer.getState();
    },
    pendingCount() {
      return coalescer.pendingCount();
    },
    dispose() {
      coalescer.dispose();
    },
  };
}
