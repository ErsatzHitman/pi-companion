/**
 * Timeline reducer — plan.md §7.4.
 *
 * T20A implemented the subset of §7.4's invariants that do not require
 * pagination: epoch reset, epoch/seq dedupe, `replaceMessageId` correction
 * in place, tool updates attached to their call, and preserved daemon
 * timestamps.
 *
 * T20B extends this module with the remaining §7.4 invariants:
 *
 * - detect gaps and page until complete (`TimelineGap`, `planGapBackfillRequest`);
 * - reconcile optimistic user rows with accepted daemon rows
 *   (`addOptimisticUserMessage`, folded automatically into `ingestEntry`);
 * - restore a stale cached tail without marking it authoritative
 *   (`restoreCachedTimeline`; only `ingestTimelineWindow` clears `stale`);
 * - recover after app restart during an active turn (pending/optimistic
 *   rows deliberately survive an epoch reset — see `TimelineState.pendingRows`
 *   in `./types.ts`).
 *
 * Every exported function is a pure reducer: it never mutates its `state`
 * argument and always returns a new `TimelineState`. This keeps the module
 * trivially usable from a Zustand vanilla store (plan.md §7.2) without this
 * package ever importing Zustand or any platform code itself.
 */
import type {
  AgentTimelineItem,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "@picompanion/protocol/agent-types";
import type {
  AgentStreamMessage,
  FetchAgentTimelineResponseMessage,
  SessionInboundMessage,
} from "@picompanion/protocol/messages";
import type { TimelineGap, TimelineRow, TimelineState } from "./types.js";

/**
 * The wire request that asks the daemon for a bounded timeline page
 * (`packages/protocol/src/messages.ts` `FetchAgentTimelineRequestMessageSchema`).
 * Protocol does not export this type directly (only the aggregate
 * `SessionInboundMessage` union it is a member of), so it is narrowed here
 * rather than re-declared, to stay traceable to the real wire schema.
 */
export type FetchAgentTimelineRequestMessage = Extract<
  SessionInboundMessage,
  { type: "fetch_agent_timeline_request" }
>;

function rowId(epoch: string, seqStart: number): string {
  return `${epoch}:${seqStart}`;
}

function optimisticRowId(clientMessageId: string): string {
  return `optimistic:${clientMessageId}`;
}

interface IngestedEntry {
  epoch: string;
  seqStart: number;
  seqEnd: number;
  timestamp: string;
  provider: string;
  item: AgentTimelineItem;
}

/** The mutable-shaped fields `ingestEntry` folds over one entry at a time.
 * `gap` and `stale` are purely derived/orthogonal to per-entry ingestion, so
 * they live outside this shape and are computed once by the public
 * `ingestAgentStreamMessage`/`ingestTimelineWindow` wrappers. */
interface IngestCore {
  epoch: string | null;
  rows: TimelineRow[];
  pendingRows: TimelineRow[];
}

function isToolCallItem(item: AgentTimelineItem): item is ToolCallTimelineItem {
  return item.type === "tool_call";
}

/** Mirrors the daemon's `mergeToolCallItems` (timeline-projection.ts) closely
 * enough to keep client-side merge behavior predictable, without importing
 * server code: prefer a resolved (non-"unknown") detail, merge metadata, and
 * apply the incoming status's error semantics. */
function mergeToolCallItem(
  existing: ToolCallTimelineItem,
  incoming: ToolCallTimelineItem,
): ToolCallTimelineItem {
  const mergedDetail: ToolCallDetail =
    existing.detail.type === "unknown" && incoming.detail.type !== "unknown"
      ? incoming.detail
      : incoming.detail.type === "unknown" && existing.detail.type !== "unknown"
        ? existing.detail
        : incoming.detail;
  const mergedMetadata =
    existing.metadata || incoming.metadata
      ? { ...existing.metadata, ...incoming.metadata }
      : undefined;

  return {
    ...existing,
    ...incoming,
    detail: mergedDetail,
    metadata: mergedMetadata,
  };
}

function findInsertIndex(rows: readonly TimelineRow[], seqStart: number): number {
  // Ingestion is normally already in ascending seq order (live push, or a
  // sorted window), so scanning from the end is the common fast path; a
  // full binary search is unnecessary for this reducer's scope.
  let index = rows.length;
  while (index > 0) {
    const previous = rows[index - 1];
    if (previous && previous.seqStart <= seqStart) {
      break;
    }
    index -= 1;
  }
  return index;
}

/**
 * Reconciles an incoming confirmed `user_message` against any local
 * optimistic row awaiting exactly this `clientMessageId` (plan.md §7.4
 * "reconcile optimistic user rows with accepted daemon rows"). Matching is
 * by `clientMessageId` alone, independent of epoch: a submission made just
 * before a daemon restart must still reconcile once the confirmed row
 * reappears under the new epoch (plan.md §7.4 "recover after app restart
 * during an active turn").
 *
 * Returns the same array reference when nothing changes, so callers can use
 * reference equality as a cheap "did anything change" check.
 */
function reconcilePendingRows(
  pendingRows: readonly TimelineRow[],
  item: AgentTimelineItem,
): TimelineRow[] {
  if (item.type !== "user_message" || item.clientMessageId === undefined) {
    return pendingRows as TimelineRow[];
  }
  const clientMessageId = item.clientMessageId;
  let changed = false;
  const next = pendingRows.filter((row) => {
    const isMatch =
      row.item.type === "user_message" && row.item.clientMessageId === clientMessageId;
    if (isMatch) {
      changed = true;
    }
    return !isMatch;
  });
  return changed ? next : (pendingRows as TimelineRow[]);
}

function ingestEntry(core: IngestCore, entry: IngestedEntry): IngestCore {
  // Reset on epoch change (plan.md §7.4). The very first ingested entry
  // establishes the epoch without treating it as a "change". Only the
  // confirmed `rows` reset here: `pendingRows` are local mutations, kept
  // apart from the server replica (plan.md §7.2), and deliberately survive
  // an epoch reset so a submission made just before a reconnect is not
  // silently forgotten.
  const rows = core.epoch !== null && core.epoch !== entry.epoch ? [] : core.rows;
  const epoch = entry.epoch;
  const pendingRows = reconcilePendingRows(core.pendingRows, entry.item);

  const id = rowId(entry.epoch, entry.seqStart);

  // Deduplicate by epoch and sequence: an exact re-delivery of the same
  // (epoch, seqStart) is a no-op, never a duplicate row.
  if (rows.some((row) => row.id === id)) {
    if (epoch === core.epoch && rows === core.rows && pendingRows === core.pendingRows) {
      return core;
    }
    return { epoch, rows, pendingRows };
  }

  // `replaceMessageId` corrections replace the target row's content in
  // place, at its existing position, rather than appending a new row.
  if (entry.item.type === "assistant_message" && entry.item.replaceMessageId) {
    const replaceMessageId = entry.item.replaceMessageId;
    const targetIndex = rows.findIndex(
      (row) => row.item.type === "assistant_message" && row.item.messageId === replaceMessageId,
    );
    if (targetIndex !== -1) {
      const existing = rows[targetIndex];
      if (existing) {
        const nextRows = rows.slice();
        nextRows[targetIndex] = {
          ...existing,
          seqEnd: Math.max(existing.seqEnd, entry.seqEnd),
          timestamp: entry.timestamp,
          item: entry.item,
        };
        return { epoch, rows: nextRows, pendingRows };
      }
    }
    // No loaded row matches replaceMessageId (e.g. the corrected row is
    // outside what this reducer instance has ingested so far, or is still
    // behind an open gap). Fall through and insert the correction as its
    // own row so it is never silently dropped; gap backfill (below) will
    // eventually load the row it corrects, and a second, later
    // `replaceMessageId` delivery — or a page that includes the original —
    // can still collapse them once both are present.
  }

  // Tool execution updates stay attached to their tool call: a later
  // timeline row for the same `callId` merges into the existing row instead
  // of forking a second row for the same invocation.
  if (isToolCallItem(entry.item)) {
    const callId = entry.item.callId;
    const targetIndex = rows.findIndex(
      (row) => isToolCallItem(row.item) && row.item.callId === callId,
    );
    if (targetIndex !== -1) {
      const existing = rows[targetIndex];
      if (existing && isToolCallItem(existing.item)) {
        const nextRows = rows.slice();
        nextRows[targetIndex] = {
          ...existing,
          seqEnd: Math.max(existing.seqEnd, entry.seqEnd),
          timestamp: entry.timestamp,
          item: mergeToolCallItem(existing.item, entry.item),
        };
        return { epoch, rows: nextRows, pendingRows };
      }
    }
  }

  const newRow: TimelineRow = {
    id,
    epoch: entry.epoch,
    seqStart: entry.seqStart,
    seqEnd: entry.seqEnd,
    timestamp: entry.timestamp,
    provider: entry.provider,
    item: entry.item,
  };
  const insertIndex = findInsertIndex(rows, entry.seqStart);
  const nextRows = rows.slice();
  nextRows.splice(insertIndex, 0, newRow);
  return { epoch, rows: nextRows, pendingRows };
}

/**
 * Scans confirmed, seq-sorted `rows` for the first hole in their sequence
 * numbers (plan.md §7.4 "detect gaps and page until complete"). `rows` is
 * assumed sorted ascending by `seqStart`, which every ingestion path in
 * this module maintains. Reports only the first hole: once backfill closes
 * it, a re-scan finds the next one, if any, so gaps are always resolved
 * one contiguous window at a time.
 */
function findGap(epoch: string, rows: readonly TimelineRow[]): TimelineGap | null {
  for (let index = 0; index < rows.length - 1; index += 1) {
    const current = rows[index];
    const next = rows[index + 1];
    if (current && next && next.seqStart > current.seqEnd + 1) {
      return { epoch, fromSeq: current.seqEnd + 1, toSeq: next.seqStart - 1 };
    }
  }
  return null;
}

function finalizeTimelineState(params: {
  epoch: string | null;
  rows: TimelineRow[];
  pendingRows: TimelineRow[];
  stale: boolean;
}): TimelineState {
  return {
    epoch: params.epoch,
    rows: params.rows,
    pendingRows: params.pendingRows,
    gap: params.epoch === null ? null : findGap(params.epoch, params.rows),
    stale: params.stale,
  };
}

/**
 * Ingests one `agent_stream` wire message (plan.md §12.2's live-turn path).
 *
 * Only `event.type === "timeline"` payloads carry timeline rows; every other
 * `AgentStreamEvent` variant (turn lifecycle, permissions, Pi UI state, ...)
 * belongs to a different frontend-core domain (sessions/permissions/
 * extensions) and is a no-op here. A `timeline` event missing `epoch`/`seq`
 * is likewise not ingestible as a row and is skipped rather than guessed.
 *
 * A live push landing past a hole in the loaded rows does not block: it is
 * still inserted at its sorted position, and the resulting `state.gap`
 * records the hole so a caller can request backfill via
 * `planGapBackfillRequest`. `state.stale` is left untouched — only an
 * authoritative `fetch_agent_timeline_response` (`ingestTimelineWindow`)
 * can clear it.
 */
export function ingestAgentStreamMessage(
  state: TimelineState,
  message: AgentStreamMessage,
): TimelineState {
  const { event, epoch, seq, timestamp } = message.payload;
  if (event.type !== "timeline" || epoch === undefined || seq === undefined) {
    return state;
  }
  const core = ingestEntry(
    { epoch: state.epoch, rows: state.rows, pendingRows: state.pendingRows },
    { epoch, seqStart: seq, seqEnd: seq, timestamp, provider: event.provider, item: event.item },
  );
  if (
    core.epoch === state.epoch &&
    core.rows === state.rows &&
    core.pendingRows === state.pendingRows
  ) {
    return state; // pure no-op: preserve the exact reference, not just equal content
  }
  return finalizeTimelineState({
    epoch: core.epoch,
    rows: core.rows,
    pendingRows: core.pendingRows,
    stale: state.stale,
  });
}

/**
 * Ingests a `fetch_agent_timeline_response` window (plan.md §12.1's
 * directory/session-snapshot path, the reconnect path, and gap backfill
 * pages requested via `planGapBackfillRequest`).
 *
 * Applies the response's own `reset` flag as well as an epoch mismatch: both
 * force a full reset before the window's entries are ingested, so a client
 * that reconnects after a daemon restart discards its stale epoch's rows
 * exactly once, per row, rather than merging across epochs. A bounded gap
 * backfill page (`mergeWindow: true`, `reset: false`) instead merges its
 * entries into the existing sorted rows, which is what closes `state.gap`
 * once enough pages have arrived — call this repeatedly, using
 * `planGapBackfillRequest(nextState, ...)` for the next request, until it
 * returns `null` (plan.md §7.4 "page until complete").
 *
 * Ingesting any window here is this reducer's authoritative catch-up
 * signal: `state.stale` is always cleared afterward (plan.md §12.5 "cached
 * timelines are marked stale until authoritative catch-up completes"),
 * even for a window with no new entries.
 */
export function ingestTimelineWindow(
  state: TimelineState,
  response: FetchAgentTimelineResponseMessage,
): TimelineState {
  const { epoch, reset, entries } = response.payload;
  const shouldReset = reset || (state.epoch !== null && state.epoch !== epoch);
  // Decide the reset once, up front, and adopt the new epoch immediately so
  // per-entry ingestion never re-triggers its own epoch-mismatch reset.
  let core: IngestCore = shouldReset
    ? { epoch, rows: [], pendingRows: state.pendingRows }
    : { epoch, rows: state.rows, pendingRows: state.pendingRows };

  for (const entry of entries) {
    core = ingestEntry(core, {
      epoch,
      seqStart: entry.seqStart,
      seqEnd: entry.seqEnd,
      timestamp: entry.timestamp,
      provider: entry.provider,
      item: entry.item,
    });
  }

  return finalizeTimelineState({
    epoch: core.epoch,
    rows: core.rows,
    pendingRows: core.pendingRows,
    stale: false,
  });
}

/**
 * Builds the next `fetch_agent_timeline_request` needed to close
 * `state.gap`, or `null` if there is nothing to backfill (plan.md §7.4
 * "detect gaps and page until complete"). The request asks, going
 * backward, for entries immediately before the row that revealed the gap;
 * feeding the response back through `ingestTimelineWindow` narrows or
 * closes the gap, and calling this again with the resulting state produces
 * the next page's request until the gap is fully closed and this returns
 * `null`. Callers (the hosts/connection controller that owns sending
 * requests and generating `requestId`s) drive that loop; this reducer only
 * plans one page at a time, so it stays pure and side-effect free.
 */
export function planGapBackfillRequest(
  state: TimelineState,
  input: { agentId: string; requestId: string; limit?: number },
): FetchAgentTimelineRequestMessage | null {
  if (!state.gap) {
    return null;
  }
  return {
    type: "fetch_agent_timeline_request",
    agentId: input.agentId,
    requestId: input.requestId,
    direction: "before",
    cursor: { epoch: state.gap.epoch, seq: state.gap.toSeq + 1 },
    limit: input.limit ?? 200,
    projection: "projected",
    mergeWindow: true,
  };
}

/** Input to `addOptimisticUserMessage`: the client's own submission, before
 * any daemon acknowledgment. `clientMessageId` must be the same stable id
 * the corresponding `send_agent_message_request`/`create_agent_request`
 * used, since that is the only field `reconcilePendingRows` can match
 * against the daemon's eventual confirmed `user_message` row. */
export interface OptimisticUserMessageInput {
  clientMessageId: string;
  text: string;
  /** Local submission time. Replaced by the daemon's own timestamp once reconciled. */
  timestamp: string;
  provider?: string;
}

/**
 * Adds a local optimistic row for a prompt the user just submitted, before
 * any daemon acknowledgment (plan.md §7.4 "reconcile optimistic user rows
 * with accepted daemon rows"; §7.2 "pending mutations"). The row is kept in
 * `state.pendingRows`, separate from the confirmed server replica in
 * `state.rows`, and is automatically removed — without ever appearing
 * twice — the moment `ingestAgentStreamMessage`/`ingestTimelineWindow`
 * ingests a confirmed `user_message` row carrying the same
 * `clientMessageId` (see `reconcilePendingRows`).
 *
 * Idempotent: calling this again with an already-pending or
 * already-reconciled `clientMessageId` is a no-op, so a caller does not
 * need to track whether it already added a given submission.
 */
export function addOptimisticUserMessage(
  state: TimelineState,
  input: OptimisticUserMessageInput,
): TimelineState {
  const id = optimisticRowId(input.clientMessageId);
  if (state.pendingRows.some((row) => row.id === id)) {
    return state;
  }
  const alreadyConfirmed = state.rows.some(
    (row) => row.item.type === "user_message" && row.item.clientMessageId === input.clientMessageId,
  );
  if (alreadyConfirmed) {
    return state;
  }
  const row: TimelineRow = {
    id,
    epoch: state.epoch ?? "",
    // Optimistic rows have no daemon-assigned sequence yet; sorting past
    // every confirmed row keeps them at the tail, in submission order,
    // until reconciliation gives them a real (epoch, seq) identity.
    seqStart: Number.POSITIVE_INFINITY,
    seqEnd: Number.POSITIVE_INFINITY,
    timestamp: input.timestamp,
    provider: input.provider ?? "pi",
    pending: true,
    item: { type: "user_message", text: input.text, clientMessageId: input.clientMessageId },
  };
  return { ...state, pendingRows: [...state.pendingRows, row] };
}

/**
 * One combined, render-ready view of confirmed and pending rows: confirmed
 * `rows` (already in ascending `seqStart` order) followed by any
 * not-yet-reconciled `pendingRows`, in the order they were submitted.
 * Never duplicates a row: a pending row is removed from `pendingRows` the
 * moment its daemon-confirmed counterpart is ingested (plan.md §7.4
 * "reconcile optimistic user rows with accepted daemon rows").
 */
export function getVisibleTimelineRows(state: TimelineState): TimelineRow[] {
  return state.pendingRows.length === 0 ? state.rows : [...state.rows, ...state.pendingRows];
}

/** A previously cached timeline window to restore before the daemon
 * connection is available (plan.md §12.5 "web stores ordinary data in
 * IndexedDB" / "Android stores ordinary data in Expo SQLite"). Owned by the
 * `offline` domain's cache serialization (T22); this reducer only defines
 * how the restored snapshot re-enters timeline state. */
export interface CachedTimelineSnapshot {
  epoch: string;
  rows: readonly TimelineRow[];
}

/**
 * Restores a previously cached timeline tail as a starting point before the
 * daemon connection is available (plan.md §7.4 "restore a stale cached
 * tail without marking it authoritative"). The restored state is always
 * `stale: true`: only a subsequent authoritative `ingestTimelineWindow`
 * call clears it, never this function and never a live
 * `ingestAgentStreamMessage` push on its own.
 */
export function restoreCachedTimeline(cached: CachedTimelineSnapshot): TimelineState {
  const rows = [...cached.rows];
  return {
    epoch: cached.epoch,
    rows,
    pendingRows: [],
    gap: findGap(cached.epoch, rows),
    stale: true,
  };
}
