/**
 * The open session's daemon-side workspace root (protocol `cwd`) for the
 * session-scoped file and terminal routes.
 *
 * Sourced through `features/sessions`' existing `useSessionSnapshot`
 * hook — the same `fetchAgent` -> `AgentSnapshotPayload.cwd` source the
 * app shell's `SessionWorkspaceCrumb` already reads — rather than a new
 * fetch invented for these screens. `client.fetchAgent`'s result is
 * passed straight through, and `agent_update` pushes keep the value
 * current (an `agent_update` re-render updates only this hook's owner).
 *
 * Returns `""` while no client exists, the snapshot is still loading, or
 * the read fails — the same "pending, not fabricated" placeholder
 * `FileBrowserScreen`/`TerminalRoute` already accept, so neither screen
 * ever issues a request against a guessed root.
 */
import type { DaemonClient } from "@picompanion/client";
import { useMemo } from "react";

import { useSessionSnapshot } from "../../features/sessions/index.js";
import type { SessionSnapshotSource } from "../../features/sessions/index.js";

export function useSessionWorkspaceRoot(client: DaemonClient | null, agentId: string): string {
  // `DaemonClient.on` is a generic overload set, so a real client cannot
  // satisfy `SessionSnapshotSource` structurally; adapt it once, the same
  // way `root-route.tsx` builds its `SessionChromeClient`.
  const source = useMemo<SessionSnapshotSource | null>(() => {
    if (!client) return null;
    return {
      fetchAgent: (sessionId) => client.fetchAgent(sessionId),
      subscribeAgentUpdates: (handler) =>
        client.on("agent_update", (message) => handler({ payload: message.payload })),
    };
  }, [client]);

  const session = useSessionSnapshot(source, agentId);
  return session?.cwd ?? "";
}
