/**
 * Placeholder `DiscoveredSessionsClient` (T27B5), the discovery/import
 * counterpart of `pending-connection-sessions-client.ts`.
 *
 * Until a task wires a real, host-scoped `DiscoveredSessionsClient` —
 * a thin adapter over `DaemonClient.fetchRecentProviderSessions`/
 * `DaemonClient.importAgent`, which `daemon-discovered-sessions-
 * client.ts` already builds — this placeholder is what
 * `SessionsScreen` uses by default. Every method rejects with
 * `SESSIONS_NOT_CONNECTED`, which `explainDiscoveredSessionsError`
 * turns into a clear, non-crashing "not connected" explanation instead
 * of ever touching a daemon session directly (plan.md §12.3).
 */
import { SESSIONS_NOT_CONNECTED } from "./sessions-client.js";
import type { DiscoveredSessionsClient } from "./discovered-sessions-client.js";

export function createPendingConnectionDiscoveredSessionsClient(): DiscoveredSessionsClient {
  return {
    listDiscoveredSessions() {
      return Promise.reject(new Error(SESSIONS_NOT_CONNECTED));
    },
    importSession() {
      return Promise.reject(new Error(SESSIONS_NOT_CONNECTED));
    },
  };
}
