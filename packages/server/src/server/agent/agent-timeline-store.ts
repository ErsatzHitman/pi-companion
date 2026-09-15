import { randomUUID } from "node:crypto";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
} from "./agent-timeline-store-types.js";

export interface SeedAgentTimelineOptions {
  items?: readonly AgentTimelineItem[];
  rows?: readonly AgentTimelineRow[];
  epoch?: string;
  nextSeq?: number;
  timestamp?: string;
}

interface AgentTimelineState {
  epoch: string;
  rows: AgentTimelineRow[];
  nextSeq: number;
  /**
   * Rows previously appended with a `dedupeKey` (see `append`), keyed by
   * that key. Lets a second import of the same underlying source row —
   * e.g. Pi's full-history replay and `pi-live-tail.ts`'s independent
   * from-scratch bootstrap read racing each other after a daemon restart
   * — collapse onto the row already recorded instead of appending a
   * duplicate. Never consulted for an `append` call that omits
   * `dedupeKey` (the overwhelming majority — live turn streaming), so
   * this is purely additive: two genuinely distinct rows that happen to
   * carry no dedupe key, or different keys, are never merged.
   */
  dedupeKeys: Map<string, AgentTimelineRow>;
  /**
   * FIX-S10: FIFO of `seq`s for `user_message` rows appended by the *live*
   * turn path (`AgentManager.recordSubmittedPrompt`) before that row has
   * ever been matched to the stable, position-derived identity
   * (`msg:<provider>-history-user-<N>`) a history-derived importer
   * (`PiLiveTailWatcher.emitEvents`, today's only caller of
   * `appendHistoryBackfillTimelineItem`) assigns to the same underlying
   * Pi row once it reads it back off disk. The live path cannot compute
   * that identity itself — it doesn't know its own position among the
   * session's user rows, and `PiHistoryMapper`'s counter also advances for
   * system-injected envelope rows the live path never sees — so instead of
   * pre-computing a matching key, it queues its row here; the first
   * history-derived `user_message` dedupeKey that has no existing map entry
   * claims (`mergePendingLiveUserMessage`) the oldest queued row instead of
   * appending a new one, which is what stops the live send from also being
   * recorded by the tail watcher. Order-only matching (FIFO), never text:
   * two genuinely distinct sends of identical text still enqueue two
   * separate seqs and are claimed in the order they were queued.
   */
  pendingLiveUserMessageSeqs: number[];
  /**
   * FIX-S12: seqs already claimed once by `mergePendingLiveUserMessage`,
   * newest last. `PiHistoryMapper`'s positional `userIndex` (see
   * `history-mapper.ts`) is a running count of every `user`-role row a
   * given producer's own feed contains; at scale, two producers racing to
   * reconcile the *same* live send (e.g. `PiLiveTailWatcher`'s tail append
   * and a concurrent full-history replay) can each compute a *different*
   * count for that same underlying row, because nothing guarantees the two
   * feeds advance that counter in lockstep forever. `pendingLiveUserMessageSeqs`
   * alone only protects the *first* producer to arrive (it claims the one
   * queued seq); the second producer, computing a different `messageId`/
   * dedupeKey for the same row, previously found the queue already drained
   * and fell back to a plain append — a genuine duplicate. This ledger lets
   * that second (or third) producer's echo collapse onto the same
   * already-claimed row instead, without ever comparing the two producers'
   * keys or positions: see `mergePendingLiveUserMessage`'s fallback, which
   * only ever considers the single most-recently-claimed seq, and only
   * while no *newer* `user_message` row exists — the instant another live
   * send registers its own pending seq, this fallback stops applying to the
   * previous one, so two distinct sends (identical text or not) can never
   * collapse onto a single row.
   */
  resolvedLiveUserMessageSeqs: number[];
}

const DEFAULT_TIMELINE_FETCH_LIMIT = 200;

function cloneRow(row: AgentTimelineRow): AgentTimelineRow {
  return { ...row };
}

interface FetchContext {
  state: AgentTimelineState;
  direction: NonNullable<AgentTimelineFetchOptions["direction"]>;
  limit: number;
  selectAll: boolean;
  cursor: AgentTimelineFetchOptions["cursor"];
  minSeq: number;
  maxSeq: number;
  window: { minSeq: number; maxSeq: number; nextSeq: number };
}

function fetchTail(ctx: FetchContext): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, minSeq, window } = ctx;
  const selected =
    selectAll || limit >= state.rows.length
      ? state.rows
      : state.rows.slice(state.rows.length - limit);
  return {
    epoch: state.epoch,
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: selected.length > 0 && selected[0].seq > minSeq,
    hasNewer: false,
    rows: selected.map(cloneRow),
  };
}

function fetchAfter(ctx: FetchContext): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, cursor, minSeq, maxSeq, window } = ctx;
  const baseSeq = cursor?.seq ?? 0;
  const startIdx = state.rows.findIndex((row) => row.seq > baseSeq);
  if (startIdx < 0) {
    return {
      epoch: state.epoch,
      direction,
      reset: false,
      staleCursor: false,
      gap: false,
      window,
      hasOlder: baseSeq >= minSeq,
      hasNewer: false,
      rows: [],
    };
  }

  const selected = selectAll
    ? state.rows.slice(startIdx)
    : state.rows.slice(startIdx, startIdx + limit);
  const lastSelected = selected[selected.length - 1];
  return {
    epoch: state.epoch,
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: selected[0].seq > minSeq,
    hasNewer: lastSelected !== null && lastSelected !== undefined && lastSelected.seq < maxSeq,
    rows: selected.map(cloneRow),
  };
}

function fetchBefore(ctx: FetchContext): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, cursor, minSeq, window } = ctx;
  const beforeSeq = cursor?.seq ?? state.nextSeq;
  const endExclusive = state.rows.findIndex((row) => row.seq >= beforeSeq);
  const boundedRows = endExclusive < 0 ? state.rows : state.rows.slice(0, endExclusive);
  const selected =
    selectAll || limit >= boundedRows.length
      ? boundedRows
      : boundedRows.slice(boundedRows.length - limit);
  return {
    epoch: state.epoch,
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: selected.length > 0 && selected[0].seq > minSeq,
    hasNewer: endExclusive >= 0,
    rows: selected.map(cloneRow),
  };
}

function fetchReset(
  ctx: FetchContext,
  flags: { staleCursor: boolean; gap: boolean },
): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, minSeq, window } = ctx;
  const rows =
    selectAll || limit >= state.rows.length
      ? state.rows.map(cloneRow)
      : state.rows.slice(state.rows.length - limit).map(cloneRow);
  return {
    epoch: state.epoch,
    direction,
    reset: true,
    staleCursor: flags.staleCursor,
    gap: flags.gap,
    window,
    hasOlder: rows.length > 0 && rows[0].seq > minSeq,
    hasNewer: false,
    rows,
  };
}

export class InMemoryAgentTimelineStore {
  private readonly states = new Map<string, AgentTimelineState>();

  has(agentId: string): boolean {
    return this.states.has(agentId);
  }

  initialize(agentId: string, options?: SeedAgentTimelineOptions): void {
    const timestamp = options?.timestamp ?? new Date().toISOString();
    const rows = options?.rows?.length
      ? options.rows.map(cloneRow)
      : this.buildRowsFromItems(options?.items ?? [], options?.nextSeq ?? 1, timestamp);
    const nextSeq = options?.nextSeq ?? (rows.length ? rows[rows.length - 1].seq + 1 : 1);
    this.states.set(agentId, {
      epoch: options?.epoch ?? randomUUID(),
      rows,
      nextSeq,
      dedupeKeys: new Map(),
      pendingLiveUserMessageSeqs: [],
      resolvedLiveUserMessageSeqs: [],
    });
  }

  delete(agentId: string): void {
    this.states.delete(agentId);
  }

  getItems(agentId: string): AgentTimelineItem[] {
    return this.requireState(agentId).rows.map((row) => row.item);
  }

  getRows(agentId: string): AgentTimelineRow[] {
    return this.requireState(agentId).rows.map(cloneRow);
  }

  getSubmittedUserMessage(agentId: string, clientMessageId: string): AgentTimelineRow | null {
    const row = this.requireState(agentId).rows.find(
      (candidate) =>
        candidate.item.type === "user_message" &&
        candidate.item.clientMessageId === clientMessageId,
    );
    return row ? cloneRow(row) : null;
  }

  enrichSubmittedUserMessage(
    agentId: string,
    clientMessageId: string,
    providerMessageId: string,
  ): AgentTimelineRow | null {
    const state = this.requireState(agentId);
    const index = state.rows.findIndex(
      (candidate) =>
        candidate.item.type === "user_message" &&
        candidate.item.clientMessageId === clientMessageId,
    );
    const row = state.rows[index];
    if (!row || row.item.type !== "user_message") {
      return null;
    }
    const enriched: AgentTimelineRow = { ...row, providerMessageId };
    state.rows[index] = enriched;
    return cloneRow(enriched);
  }

  getEpoch(agentId: string): string {
    return this.requireState(agentId).epoch;
  }

  /**
   * True if `append(agentId, item, { dedupeKey })` with this exact key has
   * already recorded a row for this agent, i.e. the next such call would be
   * an idempotent no-op rather than a fresh append. Lets a caller (e.g.
   * `AgentManager.appendHistoryBackfillTimelineItem`) decide whether to
   * broadcast/persist without needing to infer it from a row-count diff.
   */
  wouldDedupe(agentId: string, dedupeKey: string): boolean {
    return this.requireState(agentId).dedupeKeys.has(dedupeKey);
  }

  /**
   * FIX-S10: records that `seq` (a `user_message` row just appended by the
   * live turn path) has no history-derived identity yet, so a later
   * `mergePendingLiveUserMessage` call for the matching underlying row
   * claims it instead of appending a duplicate. See the doc comment on
   * `AgentTimelineState.pendingLiveUserMessageSeqs`.
   */
  registerPendingLiveUserMessage(agentId: string, seq: number): void {
    this.requireState(agentId).pendingLiveUserMessageSeqs.push(seq);
  }

  /**
   * FIX-S11: read-only count of still-unclaimed live `user_message` rows
   * (see `pendingLiveUserMessageSeqs`), without mutating the queue. A full
   * history-replay importer (`AgentManager.primeTimelineFromLegacyProviderHistory`,
   * `forceHydrateTimelineFromLegacyProviderHistory`) uses this to bound how
   * many of the *trailing* history rows it may attempt to merge — unlike
   * the tail watcher's append-only stream, a replay walks the whole
   * session and can present rows both before and after a pending live one,
   * so it must not treat every unrecorded row as a merge candidate.
   */
  pendingLiveUserMessageCount(agentId: string): number {
    return this.requireState(agentId).pendingLiveUserMessageSeqs.length;
  }

  /**
   * FIX-S12: true when `mergePendingLiveUserMessage`'s fallback (see its own
   * doc comment) would have something to merge onto even though the
   * primary FIFO (`pendingLiveUserMessageSeqs`) is empty — i.e. the most
   * recently claimed live row is still the newest `user_message` row in the
   * timeline. `AgentManager.computeReplayMergeEligibleIndices` bounds a full
   * replay's trailing merge window by `pendingLiveUserMessageCount` alone;
   * without this, that count reaching zero the instant a *first* racing
   * importer (e.g. the tail watcher) claims the one pending row makes the
   * window zero-width for every *other* racing importer too, so their own
   * independently-keyed echo of the exact same row is never even offered to
   * `mergePendingLiveUserMessage` — it is gated out one layer above, where
   * this fix's fallback can't help. This lets that caller widen the window
   * by exactly one slot in that case, while `mergePendingLiveUserMessage`
   * itself still makes the final, authoritative decision.
   */
  hasResolvableLiveUserMessageFallback(agentId: string): boolean {
    const state = this.requireState(agentId);
    const lastResolvedSeq = state.resolvedLiveUserMessageSeqs.at(-1);
    if (lastResolvedSeq === undefined) {
      return false;
    }
    return !state.rows.some((row) => row.item.type === "user_message" && row.seq > lastResolvedSeq);
  }

  /**
   * FIX-S10: claims the oldest still-unmatched live `user_message` row (see
   * `pendingLiveUserMessageSeqs`) for `dedupeKey`, merging `incoming`'s
   * `messageId` onto that existing row instead of creating a new one, and
   * registers `dedupeKey` against the merged row so a further re-import of
   * this same source row dedupes normally through `wouldDedupe`/`append`.
   * Returns `null` (no merge performed) when there is no pending row to
   * claim, or every queued seq's row is no longer present — the caller is
   * expected to fall back to a normal `append` in that case.
   */
  mergePendingLiveUserMessage(
    agentId: string,
    dedupeKey: string,
    incoming: Extract<AgentTimelineItem, { type: "user_message" }>,
  ): AgentTimelineRow | null {
    const state = this.requireState(agentId);
    const pending = state.pendingLiveUserMessageSeqs;
    while (pending.length > 0) {
      const seq = pending.shift();
      const index = state.rows.findIndex((row) => row.seq === seq);
      if (index === -1) continue;
      const row = state.rows[index];
      if (row.item.type !== "user_message") continue;
      const merged = this.applyLiveUserMessageMerge(state, index, row, dedupeKey, incoming);
      state.resolvedLiveUserMessageSeqs.push(seq as number);
      return merged;
    }
    // FIX-S12: the primary FIFO is empty, i.e. every live send registered so
    // far has already been claimed once — but this may be a *second*,
    // independently-keyed observation of the very same row (a concurrent
    // full-history replay racing the tail watcher's own echo of the
    // identical send, each computing a different position-derived
    // `messageId` for it) rather than a genuinely new row. Only the single
    // most-recently-claimed seq is eligible, and only while it is still the
    // newest `user_message` row in the timeline: the moment a later live
    // send registers its own pending seq, that seq becomes strictly newer
    // and this fallback no longer applies to the earlier one, so two
    // distinct sends can never collapse onto one row (see
    // `resolvedLiveUserMessageSeqs`'s own doc comment for the full
    // rationale, and the FIX-S12 regression test for the at-scale race this
    // closes).
    const lastResolvedSeq = state.resolvedLiveUserMessageSeqs.at(-1);
    if (lastResolvedSeq !== undefined) {
      const hasNewerUserMessage = state.rows.some(
        (row) => row.item.type === "user_message" && row.seq > lastResolvedSeq,
      );
      if (!hasNewerUserMessage) {
        const index = state.rows.findIndex((row) => row.seq === lastResolvedSeq);
        const row = state.rows[index];
        if (row && row.item.type === "user_message") {
          return this.applyLiveUserMessageMerge(state, index, row, dedupeKey, incoming);
        }
      }
    }
    return null;
  }

  private applyLiveUserMessageMerge(
    state: AgentTimelineState,
    index: number,
    row: AgentTimelineRow,
    dedupeKey: string,
    incoming: Extract<AgentTimelineItem, { type: "user_message" }>,
  ): AgentTimelineRow {
    const mergedItem: AgentTimelineItem = {
      ...row.item,
      ...(incoming.messageId ? { messageId: incoming.messageId } : {}),
    };
    const merged: AgentTimelineRow = { ...row, item: mergedItem };
    state.rows[index] = merged;
    state.dedupeKeys.set(dedupeKey, merged);
    return cloneRow(merged);
  }

  fetch(agentId: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    const state = this.requireState(agentId);
    const direction = options?.direction ?? "tail";
    const requestedLimit = options?.limit;
    const limit =
      requestedLimit === undefined
        ? DEFAULT_TIMELINE_FETCH_LIMIT
        : Math.max(0, Math.floor(requestedLimit));
    const cursor = options?.cursor;
    const minSeq = state.rows.length ? state.rows[0].seq : 0;
    const maxSeq = state.rows.length ? state.rows[state.rows.length - 1].seq : 0;
    const selectAll = limit === 0;

    const window = {
      minSeq,
      maxSeq,
      nextSeq: state.nextSeq,
    };

    const ctx: FetchContext = {
      state,
      direction,
      limit,
      selectAll,
      cursor,
      minSeq,
      maxSeq,
      window,
    };

    if (cursor && typeof cursor.epoch === "string" && cursor.epoch !== state.epoch) {
      return fetchReset(ctx, { staleCursor: true, gap: false });
    }

    if (direction === "after" && cursor && state.rows.length > 0 && cursor.seq < minSeq - 1) {
      return fetchReset(ctx, { staleCursor: false, gap: true });
    }

    if (state.rows.length === 0) {
      return {
        epoch: state.epoch,
        direction,
        reset: false,
        staleCursor: false,
        gap: false,
        window,
        hasOlder: false,
        hasNewer: false,
        rows: [],
      };
    }

    if (direction === "tail") {
      return fetchTail(ctx);
    }
    if (direction === "after") {
      return fetchAfter(ctx);
    }
    return fetchBefore(ctx);
  }

  append(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string; providerMessageId?: string; dedupeKey?: string },
  ): AgentTimelineRow {
    const state = this.requireState(agentId);
    if (options?.dedupeKey) {
      const existing = state.dedupeKeys.get(options.dedupeKey);
      if (existing) {
        return cloneRow(existing);
      }
    }
    const row: AgentTimelineRow = {
      seq: state.nextSeq,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      item,
      ...(options?.providerMessageId ? { providerMessageId: options.providerMessageId } : {}),
    };
    state.nextSeq += 1;
    state.rows.push(row);
    if (options?.dedupeKey) {
      state.dedupeKeys.set(options.dedupeKey, row);
    }
    return cloneRow(row);
  }

  getLastItem(agentId: string): AgentTimelineItem | null {
    const state = this.requireState(agentId);
    return state.rows[state.rows.length - 1]?.item ?? null;
  }

  getLastAssistantMessage(agentId: string): string | null {
    const rows = this.requireState(agentId).rows;
    const chunks: string[] = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const item = rows[i].item;
      if (item.type !== "assistant_message") {
        if (chunks.length > 0) {
          break;
        }
        continue;
      }
      chunks.push(item.text);
    }

    if (chunks.length === 0) {
      return null;
    }

    return chunks.toReversed().join("");
  }

  private requireState(agentId: string): AgentTimelineState {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Unknown agent '${agentId}'`);
    }
    return state;
  }

  private buildRowsFromItems(
    items: readonly AgentTimelineItem[],
    startSeq: number,
    timestamp: string,
  ): AgentTimelineRow[] {
    let nextSeq = startSeq;
    return items.map((item) => {
      const row: AgentTimelineRow = {
        seq: nextSeq,
        timestamp,
        item,
      };
      nextSeq += 1;
      return row;
    });
  }
}
