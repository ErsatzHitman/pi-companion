import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";

import type { hosts } from "@picompanion/frontend-core";

import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import {
  SessionsScreen,
  createDaemonDiscoveredSessionsClient,
  createDaemonSessionsClient,
  createPendingConnectionDiscoveredSessionsClient,
  createPendingConnectionSessionsClient,
} from "../../features/sessions/index.js";
import type { SessionListConnectionState } from "../../features/sessions/index.js";

const routeApi = getRouteApi("/h/$serverId/sessions");

/**
 * Maps `DaemonClientProvider`'s connection status
 * (`hosts.HostControllerConnectionInfo["status"]`) onto
 * `use-session-list-sync.ts`'s narrower three-state
 * `SessionListConnectionState`. Duplicated, not imported, from
 * `root-route.tsx`'s identical private helper of the same name: that
 * file is a different task's owned file in this wave (T53A3) and does
 * not export it, and this mapping is small enough that copying it here
 * is cheaper than widening either file's public surface just to share
 * one four-line function.
 */
function toSessionListConnectionState(
  status: hosts.HostControllerConnectionInfo["status"],
): SessionListConnectionState {
  if (status === "connected") return "connected";
  if (status === "connecting" || status === "probing" || status === "reconnect-pending") {
    return "connecting";
  }
  return "disconnected";
}

/**
 * `/h/:serverId/sessions` screen body (T27B2 built the feature; T53A4
 * wires it to the live daemon). Kept as a thin, lazily loaded wrapper
 * around the sessions feature (`apps/web/src/features/sessions/`),
 * matching `host-session-files-screen.tsx`'s precedent so this file
 * never needs to change again as that feature grows behind the same
 * import boundary.
 *
 * Before this task, this screen never passed `SessionsScreen` a
 * `client`/`discoveredClient`/`connectionState` at all, so it always
 * fell back to `SessionsScreen`'s own `createPendingConnectionSessions
 * Client()`/`createPendingConnectionDiscoveredSessionsClient()`
 * defaults and a hard-coded `connectionState="connected"` — meaning
 * "New session" always reported "not connected" even with a fully
 * authenticated `DaemonClient` open (documented, before this fix, by
 * `e2e/session-lifecycle.spec.ts`'s first test, which is a different
 * task's (T31B2) owned file, not touched here). This mirrors
 * `SessionRailContent` in `root-route.tsx` (T53A3): build the real
 * daemon-backed adapters from `useDaemonClientContext()`'s `client`
 * when one exists, else keep the same pending-connection placeholders
 * `SessionsScreen` always defaulted to, so "no connection yet" stays a
 * normal rendered state rather than a crash.
 */
export function HostSessionsScreen() {
  const { serverId } = routeApi.useParams();
  const { client, info } = useDaemonClientContext();

  const sessionsClient = useMemo(
    () => (client ? createDaemonSessionsClient(client) : createPendingConnectionSessionsClient()),
    [client],
  );
  const discoveredClient = useMemo(
    () =>
      client
        ? createDaemonDiscoveredSessionsClient(client)
        : createPendingConnectionDiscoveredSessionsClient(),
    [client],
  );
  const connectionState = toSessionListConnectionState(info.status);

  return (
    <SessionsScreen
      serverId={serverId}
      client={sessionsClient}
      discoveredClient={discoveredClient}
      connectionState={connectionState}
    />
  );
}
