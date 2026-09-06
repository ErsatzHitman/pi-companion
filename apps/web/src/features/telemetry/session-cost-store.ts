/**
 * Live session-cost accumulator (plan.md §7.4, §8.3, §11.5; T48A2).
 *
 * `@picompanion/frontend-core`'s `telemetry/cost.ts` (T48A1) derives one
 * turn's monetary cost from its `AgentUsage` and model id, and accumulates
 * an array of already-derived `TurnCost`s into a `SessionCost` — both pure
 * functions with no notion of a live event stream. This module is the
 * `apps/web` piece that owns the *live* half: turning per-turn usage
 * snapshots for one session into a running `SessionCost`, updated as each
 * arrives.
 *
 * Turn identity and update semantics (plan.md §7.4 timeline invariants,
 * §12.3 action identity — the same "never guess an id" discipline applied
 * here to turns instead of Pi UI actions):
 *
 * - a usage reading is *cumulative* for the turn it belongs to, not a
 *   delta (the daemon's own `AgentSnapshotPayload.lastUsage` is a
 *   replace-on-update field — see `daemon-session-cost-client.ts`'s
 *   module doc for why `agent_update`, not `agent_stream`, is this
 *   store's real live source), so re-ingesting the same `turnId`
 *   overwrites (never adds to) that turn's entry. This is what makes the
 *   readout "update during a turn" per T48A2's third acceptance
 *   criterion: the session total recomputes from the map's current
 *   values on every ingest, with no double-counting.
 * - when a caller ingests usage without a `turnId` (the daemon's snapshot
 *   carries no active turn to attribute it to — e.g. the turn has just
 *   finished and gone idle), this store falls back to whichever turn key
 *   is still open (`currentTurnKey`, opened by the most recent explicit
 *   `turnId`), so that turn's *final* reading lands on the same entry as
 *   its running total did. `closeTurn` then clears that fallback so a
 *   later, unrelated idle reading can never be misattributed to a turn
 *   that has already finished.
 * - ingesting `null`/`undefined` usage is a deliberate no-op: it never
 *   creates an entry and never overwrites an already-known cost with
 *   "unknown" — callers only ever call `ingestUsage` when they actually
 *   have a reading to attribute (see `daemon-session-cost-client.ts`'s
 *   own staleness guard for why a cold/idle snapshot's usage is
 *   deliberately never passed here at all).
 * - `setModel` affects turns priced *after* the call; already-accumulated
 *   turns keep the price they were actually billed at, matching
 *   `TurnUsageRecord`'s per-turn `modelId` design in `cost.ts` (a session
 *   that switches models mid-stream must not have its history re-priced
 *   at the new rate).
 *
 * This store deliberately never seeds itself from `AgentSnapshotPayload.
 * lastUsage` on cold resume: that field is a single latest-usage
 * snapshot, not a per-turn history, and no daemon RPC (`fetchAgentTimeline`
 * included — `AgentTimelineItem` carries no `usage` field) can
 * reconstruct one. A resumed session's cost is therefore honestly
 * "unknown" (zero priced turns) until this connection observes a turn
 * complete, never a fabricated carry-over total — enforced by
 * `daemon-session-cost-client.ts`, not by this store (this store trusts
 * whatever its caller ingests).
 */
import { telemetry as coreTelemetry } from "@picompanion/frontend-core";
import type { AgentUsage } from "@picompanion/protocol/agent-types";

export type SessionCostListener = () => void;

let fallbackKeySequence = 0;

/** Ephemeral, session-scoped `SessionCost` accumulator — see module doc. */
export class SessionCostStore {
  private modelId: string | null = null;
  private readonly turns = new Map<string, coreTelemetry.TurnCost>();
  private currentTurnKey: string | null = null;
  private revision = 0;
  private cachedSnapshot: coreTelemetry.SessionCost | null = null;
  private readonly listeners = new Set<SessionCostListener>();

  /**
   * Sets the model priced turns are ingested against, from now until the
   * next call. Used both for the session's initial model (from a cold
   * `fetchAgent`, before any live update has arrived) and for live model
   * changes.
   */
  setModel(modelId: string | null | undefined): void {
    this.modelId = modelId ?? null;
  }

  /**
   * Ingests a cumulative usage-so-far reading, keyed by `turnId` when
   * given or by whichever turn is currently open otherwise (see the
   * module doc's fallback rule). A missing/`null` `usage` is a no-op.
   */
  ingestUsage(turnId: string | undefined, usage: AgentUsage | null | undefined): void {
    if (!usage) return;
    const key = turnId ?? this.currentTurnKey ?? this.allocateFallbackKey();
    this.currentTurnKey = key;
    this.turns.set(key, coreTelemetry.deriveTurnCost(usage, this.modelId));
    this.bump();
  }

  /**
   * Closes whichever turn is currently open, so a later idle reading
   * with no `turnId` can never be misattributed to a turn that already
   * finished. Cheap no-op when nothing is open.
   */
  closeTurn(): void {
    this.currentTurnKey = null;
  }

  private allocateFallbackKey(): string {
    fallbackKeySequence += 1;
    return `__no-turn-id-${fallbackKeySequence}`;
  }

  /** Derives the current accumulated session cost from every ingested turn. */
  getSessionCost(): coreTelemetry.SessionCost {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = coreTelemetry.accumulateSessionCost([...this.turns.values()]);
    }
    return this.cachedSnapshot;
  }

  /** Monotonic revision, bumped on every change — for `useSyncExternalStore` snapshot caching. */
  getRevision(): number {
    return this.revision;
  }

  subscribe(listener: SessionCostListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Clears all accumulated state — e.g. when switching to a different session id. */
  reset(): void {
    this.modelId = null;
    this.turns.clear();
    this.currentTurnKey = null;
    this.bump();
  }

  private bump(): void {
    this.revision += 1;
    this.cachedSnapshot = null;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
