/**
 * Timeline row model — plan.md §7.4.
 *
 * A `TimelineRow` is the platform-neutral, canonical unit the timeline
 * reducer produces from either the live `agent_stream` push channel or an
 * authoritative `fetch_agent_timeline_response` window. It intentionally
 * mirrors the wire-level identity fields (`epoch`, `seqStart`/`seqEnd`)
 * rather than inventing a new identity scheme, so the reducer's dedupe and
 * ordering rules stay traceable to the protocol.
 *
 * `seqStart`/`seqEnd` differ only for rows ingested from a "projected"
 * `fetch_agent_timeline_response` window, which may have already collapsed
 * several source sequence numbers into one row server-side (see
 * `packages/server/src/server/agent/timeline-projection.ts`). Rows ingested
 * from the live `agent_stream` channel always have `seqStart === seqEnd`.
 */
import type { AgentTimelineItem } from "@picompanion/protocol/agent-types";

export interface TimelineRow {
  /**
   * Stable row identity. Confirmed rows use `${epoch}:${seqStart}`; local
   * optimistic rows (T20B, not yet acknowledged by the daemon) use
   * `optimistic:${clientMessageId}` — see `addOptimisticUserMessage` in
   * `./reducer.ts`. Safe to use as a list key either way.
   */
  id: string;
  epoch: string;
  seqStart: number;
  seqEnd: number;
  /**
   * The daemon-assigned timestamp for this row, preserved verbatim from the
   * wire message. The reducer never substitutes a local-clock value here
   * (plan.md §7.4 "preserve daemon timestamps"). Optimistic rows (see
   * `pending`) are the one exception: they carry the local submission time
   * until the daemon's own row reconciles them away.
   */
  timestamp: string;
  /** Agent/session provider, e.g. `"pi"`. */
  provider: string;
  item: AgentTimelineItem;
  /**
   * `true` for a locally-added optimistic row that has not yet been
   * reconciled with an accepted daemon row (T20B, plan.md §7.4 "reconcile
   * optimistic user rows with accepted daemon rows"). Absent (not `false`)
   * on every daemon-confirmed row.
   */
  pending?: boolean;
}

/**
 * A detected hole in the confirmed timeline's sequence numbers for `epoch`:
 * rows exist for both `fromSeq - 1` and `toSeq + 1`, but nothing loaded
 * covers `[fromSeq, toSeq]` itself (plan.md §7.4 "detect gaps and page
 * until complete"). `null` when the loaded rows for the current epoch are
 * contiguous.
 */
export interface TimelineGap {
  epoch: string;
  /** First missing sequence number, inclusive. */
  fromSeq: number;
  /** Last missing sequence number, inclusive. */
  toSeq: number;
}

export interface TimelineState {
  /**
   * The epoch this timeline is currently loaded for, or `null` before the
   * first row has been ingested. Ingesting a row for a different, non-null
   * epoch resets `rows` (plan.md §7.4 "reset on epoch change").
   */
  epoch: string | null;
  /** Confirmed daemon rows, in ascending `seqStart` order. Never contains duplicate `id`s. */
  rows: TimelineRow[];
  /**
   * Local optimistic rows awaiting daemon reconciliation (T20B). Kept apart
   * from `rows` (the server replica) per plan.md §7.2's "pending
   * mutations" vs. "server replica" split, so an epoch reset never
   * discards a submission that simply hasn't been acknowledged yet — see
   * `addOptimisticUserMessage` in `./reducer.ts`. Renderers that want one
   * combined view should use `getVisibleTimelineRows`.
   */
  pendingRows: TimelineRow[];
  /** The current gap in `rows` for `epoch`, or `null` if none. Purely derived from `rows`; never mutate directly. */
  gap: TimelineGap | null;
  /**
   * `true` when `rows` was populated from a locally restored offline cache
   * (`restoreCachedTimeline`) and has not yet been confirmed by an
   * authoritative `fetch_agent_timeline_response` (plan.md §7.4 "restore a
   * stale cached tail without marking it authoritative"; §12.5 "cached
   * timelines are marked stale until authoritative catch-up completes").
   */
  stale: boolean;
}

export function createEmptyTimelineState(): TimelineState {
  return { epoch: null, rows: [], pendingRows: [], gap: null, stale: false };
}
