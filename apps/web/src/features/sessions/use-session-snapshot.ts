/**
 * One session's live snapshot for the app shell's chrome (the header's
 * workspace crumb and the live rail's own head). This is deliberately a
 * read-only presentation source: it maps a daemon `AgentSnapshotPayload`
 * through the feature's existing `toSessionSummary`, and it does not
 * duplicate any route's own resume/error surface.
 *
 * Kept as a narrow structural interface (matching `daemon-sessions-
 * client.ts`/`daemon-session-resume-client.ts`'s precedent) so this
 * module never imports `@picompanion/client`: a real `DaemonClient`
 * satisfies `SessionSnapshotSource` as-is.
 */
import { useEffect, useState } from "react";

import { toSessionSummary } from "./daemon-sessions-client.js";
import type { DaemonAgentSnapshot } from "./daemon-sessions-client.js";
import type { SessionSummary } from "./types.js";

/** The message shape `DaemonClient.on("agent_update", ...)` delivers, narrowed to the fields read here. */
export interface SessionUpdateLike {
  payload: { kind: "upsert"; agent: DaemonAgentSnapshot } | { kind: "remove"; agentId: string };
}

export interface SessionSnapshotSource {
  fetchAgent(agentId: string): Promise<{ agent: DaemonAgentSnapshot } | null>;
  /**
   * Subscribes to `agent_update` payloads; returns an unsubscribe.
   * Deliberately NOT named `on`: a real `DaemonClient.on` is a generic
   * overload set covering every outbound message type, which structural
   * assignability cannot satisfy, so the caller adapts it once (see
   * `root-route.tsx`'s `sessionSnapshotSource` memo).
   */
  subscribeAgentUpdates(handler: (message: SessionUpdateLike) => void): () => void;
}

/**
 * The current `SessionSummary` for `agentId`, seeded from one
 * `fetchAgent` read and then kept current by `agent_update` pushes
 * (both `upsert` and `remove`, so a deleted session's chrome empties
 * rather than showing a stale name). `null` means "no real snapshot
 * yet": no client, no agent id, a failed read, or a removed session.
 */
export function useSessionSnapshot(
  client: SessionSnapshotSource | null,
  agentId: string | null,
): SessionSummary | null {
  const [snapshot, setSnapshot] = useState<SessionSummary | null>(null);

  useEffect(() => {
    setSnapshot(null);
    if (!client || !agentId) return undefined;

    let cancelled = false;
    client
      .fetchAgent(agentId)
      .then((result) => {
        if (cancelled || !result?.agent) return;
        setSnapshot(toSessionSummary(result.agent));
      })
      .catch(() => {
        // The session route's own resume surface already reports a real
        // fetch failure with a retry; this hook feeds presentation
        // chrome, so a failed seed read leaves it empty rather than
        // duplicating that error in the header.
      });

    const unsubscribe = client.subscribeAgentUpdates((message) => {
      if (message.payload.kind === "remove") {
        if (message.payload.agentId === agentId) setSnapshot(null);
        return;
      }
      if (message.payload.agent.id !== agentId) return;
      setSnapshot(toSessionSummary(message.payload.agent));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, agentId]);

  return snapshot;
}
