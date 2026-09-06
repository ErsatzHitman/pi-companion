/**
 * Real `SessionCostStore` attachment over a `DaemonClient`-shaped object
 * (T48A2, plan.md §7.1/§7.4/§12.2). Mirrors the narrow-adapter convention
 * `features/sessions/daemon-sessions-client.ts` (T27B2) and
 * `features/composer/daemon-agent-turn-client.ts` (T28B5) established:
 * this module only depends on the slice of `@picompanion/client`'s
 * `DaemonClient` it actually calls, so it never has to import
 * `@picompanion/client` to stay structurally compatible with it — a real
 * `DaemonClient` satisfies `DaemonSessionCostClient` as-is.
 *
 * **Why `agent_update`, not `agent_stream`.** The daemon's per-event
 * `AgentStreamEvent` union (`@picompanion/protocol/agent-types`) declares
 * `usage_updated` and `model_changed` variants, but the *wire* schema the
 * client actually validates incoming `agent_stream` messages against
 * (`AgentStreamEventPayloadSchema`, `@picompanion/protocol/messages.ts`)
 * does not include either literal — and `DaemonClient` drops a whole
 * incoming message when it fails that validation
 * (`packages/client/src/daemon-client.ts`'s `handleJsonPayload`). This is
 * intentional on the server side, not a bug this task can or should fix
 * by editing the protocol package: `agent-manager.ts`'s
 * `dispatchStreamEventByType` folds both events into the agent's snapshot
 * (`agent.lastUsage`/`agent.runtimeInfo`) and calls `emitState`, which
 * server-side forwards as an `agent_update` push
 * (`AgentUpdateMessageSchema`) carrying the *whole* updated
 * `AgentSnapshotPayload` — exactly the channel T28B5's own
 * `onAgentModelSnapshotChange` already reads for live model reflection.
 * This adapter reuses that same confirmed-live channel for usage too,
 * rather than a route this repository's protocol schema does not
 * actually deliver.
 *
 * **Turn attribution and the cold-snapshot guard.** `AgentSnapshotPayload.
 * activeTurn.turnId` is only present while a turn is running; `lastUsage`
 * persists on the agent across turns until the next `usage_updated`/
 * `turn_completed` overwrites it (`agent-manager.ts`), so a snapshot
 * observed the instant a *new* turn starts can still carry the
 * *previous* turn's final `lastUsage` for one push. This adapter never
 * lets that (or a cold-resume idle snapshot, whose `lastUsage` may be
 * from a turn that finished in a browser session before this one ever
 * connected — `SessionCostStore`'s own module doc explains why that must
 * read as "unknown", not a fabricated carry-over) get attributed:
 *
 * - a `lastUsage` reading is only ever ingested once this attachment has
 *   itself observed at least one live `activeTurn` (`haveObservedLiveTurn`);
 * - it is only ingested when its JSON differs from the last reading
 *   already attributed (`lastAttributedUsageJson`), so the one stale
 *   push that still carries the *previous* turn's numbers under the
 *   *new* turn's id is recognized as unchanged and skipped, and the new
 *   turn's entry opens only once genuinely new numbers arrive for it.
 */
import type { AgentUsage } from "@picompanion/protocol/agent-types";

import type { SessionCostStore } from "./session-cost-store.js";

/**
 * The slice of `AgentSnapshotPayload`
 * (`packages/protocol/src/messages.ts`) this adapter reads. A real
 * `AgentSnapshotPayload` has every one of these fields (plus many more
 * this adapter ignores), so it satisfies this type as-is.
 */
export interface DaemonSessionCostAgentFields {
  id: string;
  model: string | null;
  lastUsage?: AgentUsage;
  activeTurn?: { turnId: string; startedAt: string | null } | null;
}

/** Raw `fetch_agent_response` payload shape this adapter reads. */
export interface DaemonFetchAgentCostResult {
  agent: DaemonSessionCostAgentFields;
}

/** Raw `agent_update` wire message shape (`AgentUpdateMessageSchema`). */
export interface DaemonAgentUpdateCostMessage {
  type: "agent_update";
  payload:
    | { kind: "upsert"; agent: DaemonSessionCostAgentFields }
    | { kind: "remove"; agentId: string };
}

/**
 * Selects which raw wire message shape `DaemonSessionCostClient.on`
 * resolves to, mirroring `DaemonClient`'s own generic overloaded `on`
 * (`daemon-agent-turn-client.ts`'s `DaemonAgentEventMessage` explains why
 * this must stay generic rather than a plain literal parameter: a plain
 * literal parameter here would make a real `DaemonClient` fail this
 * interface even though it satisfies it at runtime).
 */
type DaemonSessionCostEventMessage<TType extends "agent_update"> = TType extends "agent_update"
  ? DaemonAgentUpdateCostMessage
  : never;

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * adapter needs. A real `DaemonClient` satisfies this as-is.
 */
export interface DaemonSessionCostClient {
  on<TType extends "agent_update">(
    type: TType,
    handler: (message: DaemonSessionCostEventMessage<TType>) => void,
  ): () => void;

  /**
   * Matches `@picompanion/client`'s `DaemonClient.fetchAgent(agentId)`:
   * resolves with `fetch_agent_response`'s payload, or `null` when the
   * daemon reports no such agent. Optional so a caller that has not
   * wired a `fetchAgent`-capable client yet still gets live updates —
   * cost then starts "unknown" until the first live snapshot arrives,
   * instead of throwing.
   */
  fetchAgent?(agentId: string): Promise<DaemonFetchAgentCostResult | null>;
}

/**
 * Attaches a `SessionCostStore` to one session's live `agent_update`
 * pushes (and, when available, an initial `fetchAgent` bootstrap for the
 * model only — see the module doc for why usage is never bootstrapped).
 * Returns an unsubscribe function; call it when the session route
 * unmounts or switches to a different `agentId`.
 */
export function attachSessionCostStore(
  daemon: DaemonSessionCostClient,
  agentId: string,
  store: SessionCostStore,
): () => void {
  let disposed = false;
  let haveObservedLiveTurn = false;
  let lastAttributedUsageJson: string | null = null;

  function applySnapshot(agent: DaemonSessionCostAgentFields): void {
    store.setModel(agent.model);

    const turnId = agent.activeTurn?.turnId;
    if (turnId) {
      haveObservedLiveTurn = true;
    }

    if (agent.lastUsage && (turnId || haveObservedLiveTurn)) {
      const usageJson = JSON.stringify(agent.lastUsage);
      if (usageJson !== lastAttributedUsageJson) {
        lastAttributedUsageJson = usageJson;
        store.ingestUsage(turnId, agent.lastUsage);
      }
    }

    if (!turnId) {
      store.closeTurn();
    }
  }

  if (daemon.fetchAgent) {
    void daemon
      .fetchAgent(agentId)
      .then((result) => {
        if (disposed || !result) return;
        // Bootstrap the model only: seeding `lastUsage` here would risk
        // attributing a turn that finished before this connection ever
        // existed — see the module doc's cold-snapshot guard.
        store.setModel(result.agent.model);
      })
      .catch(() => {
        // Best-effort bootstrap only — live `agent_update` pushes still
        // update the store even if this initial fetch fails, or the
        // daemon here doesn't implement `fetchAgent` at all.
      });
  }

  const unsubscribe = daemon.on("agent_update", (message) => {
    if (message.payload.kind !== "upsert") return;
    if (message.payload.agent.id !== agentId) return;
    applySnapshot(message.payload.agent);
  });

  return () => {
    disposed = true;
    unsubscribe();
  };
}
