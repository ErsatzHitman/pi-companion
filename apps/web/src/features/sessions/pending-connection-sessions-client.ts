/**
 * Placeholder `SessionsClient` (T27B2).
 *
 * `apps/web`'s daemon connection is not yet wired end to end (see
 * `features/connection/fake-core-adapter.ts` and
 * `features/files/pending-connection-file-browser-client.ts`, which
 * stand in for the real `DaemonClientLifecycle`/`DaemonClient` for the
 * same reason). Until a task wires a real, host-scoped `SessionsClient`
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
  };
}
