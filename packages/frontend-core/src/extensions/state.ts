/**
 * Pi UI element state — the client-side counterpart of the daemon's
 * `PiUiStateStore` (plan.md §4.2 "Bridge state correctness", §7.1, §11.3-11.5,
 * §12.2; T21B).
 *
 * Owns, per agent:
 *
 * - elements keyed by composite `ns:id` identity (`identity.ts`), never a
 *   bare id, so two extensions using the same `id` never collide;
 * - the deterministic revision rules from `revision.ts`, applied to every
 *   incoming `pi_ui_delta`/`pi_ui_state` event exactly as the daemon producer
 *   intends them to be applied;
 * - canonical-payload normalization (`normalize.ts`) on every stored
 *   element, so a consumer never has to branch on whether the daemon or an
 *   old helper sent the v1 top-level projection or the canonical `payload`.
 *
 * This store is intentionally the *only* thing it is: an in-memory ephemeral
 * projection of the live Pi UI Bridge stream. It never persists anything —
 * ephemeral Pi UI state must never enter a local durable cache (plan.md
 * §4.2, §11.5). Durable snapshots travel as ordinary `pi_ui_snapshot`
 * timeline items and are the timeline domain's concern; `piUiSnapshotState`
 * below only extracts one so the *same* revision rules can replay it into
 * this store during reconnect — it still never writes to disk.
 *
 * What this module deliberately does not do (out of T21B's scope, per
 * docs/issues-from-plan.md):
 *
 * - it does not dispatch `pi.ui.action.request`/track action results — that
 *   is `T21C`'s `ExtensionActionController`, composite action identity
 *   `(agentId, namespace, elementId, actionId, requestId)`, plan.md §12.3;
 * - it does not decide *where* an element renders (status/pinned/inline/
 *   sheet/screen) — that is the renderer registry (plan.md §11.4-11.5),
 *   built on top of the state this module exposes.
 */

import type { AgentStreamEvent, AgentTimelineItem } from "@picompanion/protocol/agent-types";
import type { PiUiDelta, PiUiElement, PiUiState } from "@picompanion/protocol/pi-ui-bridge/schema";
import { piUiElementKey, piUiElementKeyOf } from "./identity.js";
import { normalizePiUiElementTyped } from "./normalize.js";
import {
  PIUI_INITIAL_REVISION,
  PiUiRevisionTracker,
  type PiUiDeltaRevisionDecision,
  type PiUiFullStateRevisionDecision,
} from "./revision.js";

/** What happened to one ingested delta or full state. */
export type PiUiIngestOutcome =
  | { action: "applied"; revision: number }
  | { action: "discarded"; reason: "stale" | "invalid" }
  | { action: "resync-requested"; reason: "gap" | "invalid" };

function toOutcome(
  decision: PiUiDeltaRevisionDecision | PiUiFullStateRevisionDecision,
): PiUiIngestOutcome {
  if (decision.action === "apply") return { action: "applied", revision: decision.revision };
  if (decision.action === "discard") return { action: "discarded", reason: decision.reason };
  return { action: "resync-requested", reason: decision.reason };
}

/** A read-only, ordered snapshot of one agent's live Pi UI elements. */
export interface PiUiAgentSnapshot {
  agentId: string;
  revision: number;
  elements: PiUiElement[];
}

type PiUiAgentEntry = {
  tracker: PiUiRevisionTracker;
  elements: Map<string, PiUiElement>; // key = `${ns}:${id}`, insertion order preserved
};

/** Reasons this store asks its owner to request a fresh subscribe/full state. */
export type PiUiResyncReason = "gap" | "invalid";

export type PiUiResyncListener = (agentId: string, reason: PiUiResyncReason) => void;
export type PiUiChangeListener = (agentId: string) => void;

/**
 * Resolves a `remove` delta's element key.
 *
 * `ns` is present on every current-generation delta. A legacy bare id
 * (`ns` absent) is resolved the same way the daemon resolves it: matched
 * against live state, honored only when exactly one namespace owns that id,
 * and otherwise ignored — so a bare id can never remove another namespace's
 * element (plan.md §4.2, "ns:id identity is preserved everywhere").
 */
function resolveRemoveKey(
  elements: Map<string, PiUiElement>,
  id: string,
  ns?: string,
): string | null {
  if (ns !== undefined) return piUiElementKey(ns, id);
  const matches = [...elements.values()].filter((el) => el.id === id);
  if (matches.length !== 1) return null;
  return piUiElementKeyOf(matches[0]!);
}

/**
 * Multi-agent Pi UI element store.
 *
 * One `PiUiElementStore` covers every agent this client currently has Pi UI
 * state for (a companion client may show more than one agent/session at
 * once). Each agent's elements and revision are fully independent.
 */
export class PiUiElementStore {
  private readonly agents = new Map<string, PiUiAgentEntry>();
  private readonly resyncListeners = new Set<PiUiResyncListener>();
  private readonly changeListeners = new Set<PiUiChangeListener>();

  /** Subscribes to "this store asks for a resync" notifications. */
  onResyncNeeded(listener: PiUiResyncListener): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  /** Subscribes to "this agent's elements or revision changed" notifications. */
  subscribe(listener: PiUiChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notifyChange(agentId: string): void {
    for (const listener of this.changeListeners) listener(agentId);
  }

  private notifyResync(agentId: string, reason: PiUiResyncReason): void {
    for (const listener of this.resyncListeners) listener(agentId, reason);
  }

  private ensureAgent(agentId: string): PiUiAgentEntry {
    let entry = this.agents.get(agentId);
    if (!entry) {
      entry = { tracker: new PiUiRevisionTracker(), elements: new Map() };
      this.agents.set(agentId, entry);
    }
    return entry;
  }

  /** Every agent this store currently holds Pi UI state for. */
  getAgentIds(): string[] {
    return [...this.agents.keys()];
  }

  /** Current known revision for an agent (0 if never seen). */
  getRevision(agentId: string): number {
    return this.agents.get(agentId)?.tracker.current ?? PIUI_INITIAL_REVISION;
  }

  /** Live elements for an agent, in stable insertion order. */
  getElements(agentId: string): PiUiElement[] {
    return [...(this.agents.get(agentId)?.elements.values() ?? [])];
  }

  /** One element by composite identity. */
  getElement(agentId: string, ns: string, id: string): PiUiElement | undefined {
    return this.agents.get(agentId)?.elements.get(piUiElementKey(ns, id));
  }

  /** Read-only snapshot of one agent's state, convenient for selectors. */
  getSnapshot(agentId: string): PiUiAgentSnapshot {
    const entry = this.agents.get(agentId);
    return {
      agentId,
      revision: entry?.tracker.current ?? PIUI_INITIAL_REVISION,
      elements: entry ? [...entry.elements.values()] : [],
    };
  }

  /**
   * Applies a `pi_ui_delta` (upsert/remove/reset) under the deterministic
   * revision rules. A stale or gapped delta never touches `elements`.
   */
  ingestDelta(agentId: string, revision: number, delta: PiUiDelta): PiUiIngestOutcome {
    const entry = this.ensureAgent(agentId);
    const decision = entry.tracker.ingestDelta(revision);
    const outcome = toOutcome(decision);
    if (outcome.action !== "applied") {
      if (outcome.action === "resync-requested") this.notifyResync(agentId, outcome.reason);
      return outcome;
    }
    this.applyDelta(entry, delta);
    this.notifyChange(agentId);
    return outcome;
  }

  private applyDelta(entry: PiUiAgentEntry, delta: PiUiDelta): void {
    switch (delta.op) {
      case "upsert": {
        const normalized = normalizePiUiElementTyped(delta.element);
        entry.elements.set(piUiElementKeyOf(normalized), normalized);
        return;
      }
      case "remove": {
        const key = resolveRemoveKey(entry.elements, delta.id, delta.ns);
        if (key !== null) entry.elements.delete(key);
        return;
      }
      case "reset": {
        entry.elements.clear();
        for (const raw of delta.elements) {
          const normalized = normalizePiUiElementTyped(raw);
          entry.elements.set(piUiElementKeyOf(normalized), normalized);
        }
        return;
      }
      default: {
        // Exhaustiveness guard: the wire schema is a closed discriminated
        // union (plan.md §4.2), so an unknown op can only reach here from a
        // daemon ahead of this client. Ignore it rather than throw.
        return;
      }
    }
  }

  /**
   * Applies a full `pi_ui_state` (or a replayed `pi_ui_snapshot` state — see
   * `piUiSnapshotState`) under the full-state revision rule: accepted only when
   * its revision is at least the current one, and always replaces every
   * element for that agent.
   */
  ingestFullState(state: PiUiState): PiUiIngestOutcome {
    const entry = this.ensureAgent(state.agentId);
    const decision = entry.tracker.ingestFullState(state.revision);
    const outcome = toOutcome(decision);
    if (outcome.action !== "applied") return outcome;

    entry.elements.clear();
    for (const raw of state.elements) {
      const normalized = normalizePiUiElementTyped(raw);
      entry.elements.set(piUiElementKeyOf(normalized), normalized);
    }
    this.notifyChange(state.agentId);
    return outcome;
  }

  /**
   * Dispatches one `AgentStreamEvent` from the frontend-core event parser
   * (plan.md §12.2). Returns `null` for any event this store does not own
   * (including `pi_ui_action_result`, which is T21C's `ExtensionActionController`).
   */
  ingestEvent(event: AgentStreamEvent): PiUiIngestOutcome | null {
    switch (event.type) {
      case "pi_ui_state":
        return this.ingestFullState(event.state);
      case "pi_ui_delta":
        return this.ingestDelta(event.agentId, event.revision, event.delta);
      default:
        return null;
    }
  }

  /**
   * Reconnect replay, part 1: back to "never seen state" for one agent — an
   * epoch reset, a disconnect, or the agent shutting down. The next
   * `pi_ui_state`/`pi_ui_delta` for this `agentId` starts a fresh entry at
   * revision 0, exactly like a daemon that lost the agent's state.
   */
  resetAgent(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.tracker.reset();
    entry.elements.clear();
    this.notifyChange(agentId);
  }

  /** Drops an agent entirely (e.g. the session was closed/removed). */
  removeAgent(agentId: string): void {
    if (this.agents.delete(agentId)) this.notifyChange(agentId);
  }
}

/**
 * Reconnect replay: the daemon catches a reconnecting client up either with
 * a bounded window of buffered `pi_ui_delta` events or with one full
 * `pi_ui_state` (`PiUiStateStore.replayFor` server-side) — both are ordinary
 * `AgentStreamEvent`s from this store's point of view, so replaying them is
 * just calling `ingestEvent` (or `ingestDelta`/`ingestFullState` directly)
 * for each one, in order. This helper exists for that common case: apply a
 * whole batch and report every outcome, so a caller can log or assert a
 * resync was clean without hand-rolling the loop.
 */
export function ingestPiUiReplayBatch(
  store: PiUiElementStore,
  events: readonly AgentStreamEvent[],
): PiUiIngestOutcome[] {
  const outcomes: PiUiIngestOutcome[] = [];
  for (const event of events) {
    const outcome = store.ingestEvent(event);
    if (outcome !== null) outcomes.push(outcome);
  }
  return outcomes;
}

/**
 * Extracts the `PiUiState` carried by a durable `pi_ui_snapshot` timeline
 * item, or `null` for any other timeline item. `pi_ui_snapshot` items travel
 * through the ordinary authoritative timeline (plan.md §4.2, §11.5) — e.g.
 * the `reconnect-with-gap` fixture bundles one into a post-restart catch-up
 * window — precisely so a reconnecting client can fully replay Pi UI Bridge
 * elements instead of incrementally patching. `PiUiElementStore.ingestFullState`
 * is the exact same full-state rule this snapshot must be applied under, so
 * a caller (the timeline domain, wiring reconnect together) does:
 *
 * ```ts
 * const state = piUiSnapshotState(item);
 * if (state) piUiStore.ingestFullState(state);
 * ```
 */
export function piUiSnapshotState(item: AgentTimelineItem): PiUiState | null {
  return item.type === "pi_ui_snapshot" ? item.state : null;
}
