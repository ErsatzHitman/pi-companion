/**
 * Session-list reconnect/gap-recovery sync (T27B6, plan.md §7.4 applied
 * to the session rail; see `merge-sessions.ts`'s module doc for why the
 * merge step alone is not enough — this hook decides *when* to run it).
 *
 * `apps/web`'s daemon connection is not yet wired end to end (see
 * `pending-connection-sessions-client.ts`'s module doc); this hook does
 * not reach into `features/connection` for that reason — it takes
 * `connectionState` as a plain prop so it works today against a caller
 * that drives it directly (this feature's own tests, and eventually a
 * real connection signal once one is wired through `SessionsScreen`'s
 * caller) without depending on `<CoreProvider>` existing in the tree.
 *
 * Two things happen on every `connectionState` transition:
 *
 * - moving away from `"connected"` marks the list `stale`: the rows
 *   already on screen stop being treated as confirmed-live, but they
 *   are not cleared (plan.md §7.4 "restore a stale cached tail without
 *   marking it authoritative");
 * - moving *to* `"connected"` (including the very first render, which
 *   is indistinguishable from "just reconnected" from this hook's
 *   point of view) fetches the authoritative list and merges it into
 *   whatever is currently known via `mergeSessionList`, then clears
 *   `stale`.
 *
 * Every fetch attempt is tagged with a local monotonic generation so a
 * slow fetch from an abandoned attempt (e.g. reconnect, disconnect,
 * reconnect again, all within one round-trip) can never resolve after
 * a newer attempt and clobber it — the same shape as T46A1's run
 * generation fencing, kept local here since this hook has no run
 * lifecycle of its own to share it with.
 */
import { useEffect, useRef, useState } from "react";

import { mergeSessionList } from "./merge-sessions.js";
import type { SessionSummary } from "./types.js";

/** Mirrors `features/connection/fake-core-adapter.ts`'s `DaemonConnectionState` without importing it (see module doc). */
export type SessionListConnectionState = "connecting" | "connected" | "disconnected";

export interface SessionListSyncClient {
  /**
   * Fetches the full authoritative session list. Optional so a caller
   * still on a placeholder client (no daemon connection wired yet)
   * simply never syncs, matching every other optional-capability in
   * this feature (`SessionsClient.archiveSession`, etc.).
   */
  fetchSessions?(): Promise<SessionSummary[]>;
}

export interface UseSessionListSyncOptions {
  client: SessionListSyncClient;
  connectionState: SessionListConnectionState;
  /**
   * Reads the currently known sessions at the moment a sync resolves.
   * A function (not the array itself) so this hook never needs
   * `sessions` in its effect's dependency list — only a connection
   * change (or a new client) should ever start a new sync attempt.
   */
  getSessions: () => readonly SessionSummary[];
  /** Called with the merged, reconciled list once a sync resolves and is still current. */
  onSynced: (sessions: SessionSummary[]) => void;
  /** Called with a friendly-ish message if `fetchSessions()` rejects. Never throws past this hook. */
  onSyncFailed?: (message: string) => void;
}

export interface SessionListSyncResult {
  /** True while the rendered list has not been reconfirmed against the daemon since the last disconnect. */
  stale: boolean;
}

export function useSessionListSync({
  client,
  connectionState,
  getSessions,
  onSynced,
  onSyncFailed,
}: UseSessionListSyncOptions): SessionListSyncResult {
  const [stale, setStale] = useState(false);

  // Refs so the effect below only needs to depend on `client` and
  // `connectionState` — the actual identities of `getSessions`/
  // `onSynced`/`onSyncFailed` change every render in a typical caller
  // (they close over component state), and re-running the sync just
  // because a render happened would defeat the point of gating it on
  // connection transitions.
  const getSessionsRef = useRef(getSessions);
  getSessionsRef.current = getSessions;
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  const onSyncFailedRef = useRef(onSyncFailed);
  onSyncFailedRef.current = onSyncFailed;

  const generationRef = useRef(0);

  useEffect(() => {
    if (connectionState !== "connected") {
      setStale(true);
      return;
    }

    if (typeof client.fetchSessions !== "function") {
      // Nothing to reconcile against (e.g. still the pending-connection
      // placeholder client) — treat "connected" with no fetch
      // capability as trivially in sync rather than stuck stale.
      setStale(false);
      return;
    }

    const generation = ++generationRef.current;
    let cancelled = false;

    client
      .fetchSessions()
      .then((fetched) => {
        if (cancelled || generation !== generationRef.current) return;
        onSyncedRef.current(mergeSessionList(getSessionsRef.current(), fetched));
        setStale(false);
      })
      .catch((error: unknown) => {
        if (cancelled || generation !== generationRef.current) return;
        onSyncFailedRef.current?.(error instanceof Error ? error.message : String(error));
        // Leave `stale` as-is: still unconfirmed, still worth surfacing.
      });

    return () => {
      cancelled = true;
    };
  }, [client, connectionState]);

  return { stale };
}
