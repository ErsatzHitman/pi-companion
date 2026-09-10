/**
 * A live `AgentUsage` for one session, on Android (T352).
 *
 * Nothing in this app had ever read a session's token usage. The
 * derivation has existed since T29C1
 * (`@picompanion/frontend-core`'s `telemetry.deriveContextWindowUsage`)
 * and `apps/web` has had a rail reading it since T29C2; Android had
 * neither a subscription nor a consumer, so the context readout the
 * redesign's Live screen and prompt bar both need had no source.
 *
 * **Why `agent_update`, not `agent_stream`'s `usage_updated`.** The
 * daemon's own `AgentStreamEvent` union
 * (`@picompanion/protocol/agent-types`) does declare a `usage_updated`
 * variant, so reaching for it is the obvious move and it is the wrong
 * one — measured here, not assumed. `AgentStreamEventPayloadSchema`
 * (`packages/protocol/src/messages.ts`), which is what `DaemonClient`
 * actually validates an incoming `agent_stream` against, has no
 * `usage_updated` member, and `DaemonClient` drops a whole message that
 * fails that validation. What the daemon really sends is an
 * `agent_update` push carrying the entire refreshed
 * `AgentSnapshotPayload`, whose `lastUsage` the server folds every
 * `usage_updated` into. `apps/web`'s `features/telemetry/
 * daemon-session-cost-client.ts` reached the same conclusion for the
 * same reason and reads the same channel; this module is Android's
 * sibling of it, deliberately not a copy — it carries no cost store and
 * no turn attribution, and its `fetchAgent` bootstrap seeds the usage
 * rather than only the model, because a context READOUT wants the newest
 * numbers whatever turn produced them, while a cost LEDGER must never
 * attribute a turn it did not watch begin.
 *
 * That difference is why there is no cold-snapshot guard here. A
 * resumed session whose window is already 60% full should say 60% the
 * moment it loads; refusing to show it until a new turn starts would be
 * the opposite of useful, and unlike a running cost total, a
 * context-window reading carries no risk of being double-counted.
 *
 * Kept free of any React/React Native import so it is directly testable
 * under this workspace's plain `vitest` setup, the same split
 * `../sessions/turn-running-signal.ts` uses and for the same reason.
 *
 * Never logs. No handler here reads or surfaces anything but
 * `payload.kind`, `payload.agent.id` and `payload.agent.lastUsage`.
 */
import type { AgentUsage } from "@picompanion/protocol/agent-types";

/** The slice of `AgentSnapshotPayload` this module reads; a real snapshot carries far more. */
export interface ContextUsageAgentFields {
  id: string;
  lastUsage?: AgentUsage;
}

/** The narrow `agent_update` wire message shape (`AgentUpdateMessageSchema`) this module reads. */
export interface AgentUpdateUsageMessage {
  type: "agent_update";
  payload: { kind: "upsert"; agent: ContextUsageAgentFields } | { kind: "remove"; agentId: string };
}

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * module needs. `on("agent_update", handler)` is already public there,
 * so a real `DaemonClient` satisfies this as-is — the same
 * narrow-adapter convention `../sessions/turn-running-signal.ts`'s
 * `DaemonTurnStreamSource` established for this app.
 *
 * `fetchAgent` is optional and is the bootstrap: without it a screen
 * opened between two turns would show nothing until the next push, even
 * though the daemon has known the answer all along.
 */
export interface DaemonAgentUsageSource {
  on(type: "agent_update", handler: (message: AgentUpdateUsageMessage) => void): () => void;
  fetchAgent?(agentId: string): Promise<{ agent: ContextUsageAgentFields } | null>;
}

/** A live usage signal for one `agentId`, and its disposer. */
export interface ContextUsageSignal {
  /** The newest usage the daemon has reported, or `null` before any has arrived. */
  getUsage(): AgentUsage | null;
  /** Stops listening. Idempotent; safe to call more than once. */
  dispose(): void;
}

/**
 * Builds a live usage signal for `agentId` over `daemon`.
 *
 * `onChange` fires only when the numbers actually differ — compared by
 * their serialized form, because the daemon re-sends the whole snapshot
 * on every unrelated field change (a title edit, a mode switch) and a
 * consumer wiring this into `useState` must not re-render for those.
 *
 * An update for a different `agentId` is ignored outright: the
 * underlying `DaemonClient` is shared across every open session (see
 * `app-shell/core.ts`), so this filter is what keeps one session's
 * numbers off another session's screen.
 *
 * A `remove` push is not treated as "usage is now zero" — the agent is
 * gone, and the last thing it reported stays the last thing it
 * reported until this signal is disposed with the screen.
 */
export function createContextUsageSignal(
  daemon: DaemonAgentUsageSource,
  agentId: string,
  onChange: (usage: AgentUsage | null) => void,
): ContextUsageSignal {
  let usage: AgentUsage | null = null;
  let lastJson: string | null = null;
  let disposed = false;

  function setUsage(next: AgentUsage | undefined): void {
    if (disposed || !next) return;
    const json = JSON.stringify(next);
    if (json === lastJson) return;
    lastJson = json;
    usage = next;
    onChange(usage);
  }

  const offUpdate = daemon.on("agent_update", (message) => {
    if (disposed) return;
    if (message.payload.kind !== "upsert") return;
    if (message.payload.agent.id !== agentId) return;
    setUsage(message.payload.agent.lastUsage);
  });

  if (daemon.fetchAgent && agentId.length > 0) {
    void daemon
      .fetchAgent(agentId)
      .then((result) => {
        if (disposed || !result) return;
        setUsage(result.agent.lastUsage);
      })
      .catch(() => {
        // Best-effort bootstrap: a failed fetch leaves the readout at
        // "unknown", which is what it already said, and live pushes
        // still arrive. Never surfaced as its own error — the screen's
        // connection state already reports a daemon that cannot answer.
      });
  }

  return {
    getUsage: () => usage,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      offUpdate();
    },
  };
}
