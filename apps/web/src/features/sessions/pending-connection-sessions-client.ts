/**
 * Placeholder `SessionsClient` (T27B2).
 *
 * This placeholder is used whenever no live `DaemonClient` exists yet
 * (the shell badge's own live view over that same connection is
 * `features/connection/real-core-adapter.ts`). Until a task wires a real, host-scoped `SessionsClient`
 * — a thin adapter over `DaemonClient.createAgent`, which
 * `daemon-sessions-client.ts` already builds — this placeholder is what
 * `SessionsScreen` uses by default. It always rejects with
 * `SESSIONS_NOT_CONNECTED`, which `explainSessionsCreateError` turns
 * into a clear, non-crashing "not connected" explanation instead of
 * ever touching a daemon session directly (plan.md §12.3).
 *
 * Swap only this file (or the call site that constructs it) when a real
 * client lands; nothing else in this feature depends on it being fake.
 */
import { SESSIONS_NOT_CONNECTED, type SessionsClient } from "./sessions-client.js";

export function createPendingConnectionSessionsClient(): SessionsClient {
  return {
    createSession() {
      return Promise.reject(new Error(SESSIONS_NOT_CONNECTED));
    },
    archiveSession() {
      return Promise.reject(new Error(SESSIONS_NOT_CONNECTED));
    },
    deleteSession() {
      return Promise.reject(new Error(SESSIONS_NOT_CONNECTED));
    },
    fetchSessions() {
      return Promise.reject(new Error(SESSIONS_NOT_CONNECTED));
    },
    forkSession() {
      return Promise.reject(new Error(SESSIONS_NOT_CONNECTED));
    },
    cloneSession() {
      return Promise.reject(new Error(SESSIONS_NOT_CONNECTED));
    },
    renameSession() {
      return Promise.reject(new Error(SESSIONS_NOT_CONNECTED));
    },
  };
}
