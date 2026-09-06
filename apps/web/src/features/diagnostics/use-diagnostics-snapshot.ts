/**
 * Live diagnostics data source (T41B1). Wires
 * `useDaemonClientContext()` (T53A1's real `HostController`/`DaemonClient`
 * provider) to `diagnostics-model.ts`'s pure builder.
 *
 * Real sources, named:
 * - `info` (`HostController.getConnectionInfo()` via
 *   `subscribeConnectionInfo`) for connection status/kind/profile id;
 * - `hostController.getCurrentProfile()` for the `HostProfile` in use;
 * - `client.getLastServerInfoMessage()` for the daemon's own
 *   `server_info` handshake payload, refreshed on every `"status"` event
 *   whose `payload.status === "server_info"` — the same signal
 *   `host-session-screen.tsx`'s `unsubscribeServerInfo` already keys off
 *   (`DaemonClient` re-emits `server_info` after every reconnect).
 *
 * With no live client at all (`client === null`, disconnected or never
 * connected), `serverInfo` stays `null` and `buildDiagnosticsSnapshot`
 * renders every daemon-sourced field as truthfully unavailable — this is
 * the "the screen works while disconnected" acceptance criterion.
 */
import { useEffect, useMemo, useState } from "react";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";

import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import { buildDiagnosticsSnapshot, type DiagnosticsSection } from "./diagnostics-model.js";

export function useDiagnosticsSnapshot(appVersion: string, clientId: string): DiagnosticsSection[] {
  const { client, info, hostController } = useDaemonClientContext();
  const [serverInfo, setServerInfo] = useState<ServerInfoStatusPayload | null>(
    () => client?.getLastServerInfoMessage() ?? null,
  );

  useEffect(() => {
    setServerInfo(client?.getLastServerInfoMessage() ?? null);
    if (!client) return undefined;
    return client.on("status", (message) => {
      if (message.payload.status !== "server_info") return;
      setServerInfo(client.getLastServerInfoMessage());
    });
  }, [client]);

  return useMemo(
    () =>
      buildDiagnosticsSnapshot({
        appVersion,
        clientId,
        connectionInfo: info,
        profile: hostController?.getCurrentProfile() ?? null,
        serverInfo,
      }),
    [appVersion, clientId, info, hostController, serverInfo],
  );
}
