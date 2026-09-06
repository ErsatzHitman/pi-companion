/**
 * Timeline domain — plan.md §6/§7.1/§7.4.
 *
 * Owns timeline ingestion, live reconciliation, pagination, and gap
 * recovery.
 *
 * T20A ("Implement timeline reducer core invariants") implements
 * ingestion plus the §7.4 invariants that do not require pagination: epoch
 * reset, epoch/seq dedupe, `replaceMessageId` correction in place, tool
 * updates attached to their call, and preserved daemon timestamps. See
 * `./reducer.ts` for the reducer and `./types.ts` for the row/state model.
 *
 * T20B ("Implement pagination, gap recovery, and reconciliation") adds gap
 * detection/backfill (`TimelineGap`, `planGapBackfillRequest`),
 * optimistic-row reconciliation (`addOptimisticUserMessage`,
 * `getVisibleTimelineRows`), stale-cache restoration
 * (`restoreCachedTimeline`), and restart-during-active-turn recovery
 * (pending rows surviving an epoch reset) on top of this module.
 *
 * T28A1 ("Build the transcript view model in frontend-core") adds
 * `./transcript-view.ts` on top of both: a pure projection of
 * `TimelineState` into a framework-neutral, typed `TranscriptEntry[]`
 * covering every §11.1 lifecycle state the timeline domain carries data
 * for, with a safe `"unknown"` fallback for forward compatibility.
 *
 * T46A1 ("Fence asynchronous responses with a run generation") adds
 * `./run-generation.ts`: a generic `RunGenerationTracker` fencing
 * primitive that discards any asynchronous response belonging to an
 * abandoned prompt run before it can mutate shared state (plan.md §7.4).
 *
 * T45A2 ("Batch streaming timeline updates onto the frame clock") adds
 * `./coalescer.ts`: `TimelineCoalescer` paces live `agent_stream` pushes
 * onto a `FrameClock` (T45A1) so a burst of streaming deltas applies as
 * one state transition per frame tick, without ever dropping, replacing,
 * or reordering a row (plan.md §7.4, §14.5).
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
export type { TimelineGap, TimelineRow, TimelineState } from "./types.js";
export { createEmptyTimelineState } from "./types.js";
export {
  addOptimisticUserMessage,
  getVisibleTimelineRows,
  ingestAgentStreamMessage,
  ingestTimelineWindow,
  planGapBackfillRequest,
  restoreCachedTimeline,
} from "./reducer.js";
export type {
  CachedTimelineSnapshot,
  FetchAgentTimelineRequestMessage,
  OptimisticUserMessageInput,
} from "./reducer.js";
export {
  buildTranscriptEntries,
  buildTranscriptEntry,
  buildTranscriptView,
} from "./transcript-view.js";
export type {
  TranscriptEntry,
  TranscriptEntryBase,
  TranscriptEntryKind,
  TranscriptView,
  TranscriptViewOptions,
} from "./transcript-view.js";
export { RunGenerationTracker, fenceAsyncResponse } from "./run-generation.js";
export type { RunGeneration, RunGenerationSnapshot } from "./run-generation.js";
export { TimelineCoalescer } from "./coalescer.js";
export type { TimelineCoalescerListener } from "./coalescer.js";
