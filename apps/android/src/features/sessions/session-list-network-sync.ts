/**
 * Keeps `SessionListState` correct across Wi-Fi, cellular and relay
 * network path switches (T32B5, plan.md §7.4 applied to the session
 * rail).
 *
 * T32S3 landed a real `NetworkReachability` (`../../platform/
 * network-reachability.ts`, `PollingNetworkReachability`) so a genuine
 * offline -> online transition now fires for real. Its `kind` is not:
 * that adapter can only ever report `"unknown"` (online) or `"none"`
 * (offline) — a real Wi-Fi -> cellular *path* switch needs interface
 * metadata (`@react-native-community/netinfo`) no task in this phase is
 * permitted to install. So this module is driven directly by injected
 * `NetworkStatus` values (see `session-list-network-sync.test.ts`) that
 * exercise the `wifi -> cellular` transition the real adapter cannot
 * yet produce, rather than by subscribing to `NetworkReachability`
 * itself — a future task that adds the netinfo dependency can wire a
 * real subscription straight into `handleNetworkStatus` without
 * changing this module's shape. This module never claims to have
 * observed a real path switch; it proves the *reconciliation*, which is
 * fully provable without one.
 *
 * Two things happen on every `handleNetworkStatus(status)` call:
 *
 * - the list's `connectionPath` is always updated to `status.kind`
 *   (`setSessionListConnectionPath`, from `sessions-model.ts`) — "the
 *   active connection path is visible" holds even when nothing else
 *   about this call triggers a resync;
 * - moving to offline marks the list `stale`
 *   (`markSessionListStale`) without clearing it — plan.md §7.4
 *   "restore a stale cached tail without marking it authoritative";
 *   moving *to* online from offline, or a `kind` change while staying
 *   online (a path switch), fetches a fresh `SessionListWindow` and
 *   merges it via `applySessionListWindow`
 *   (`sessions-model.ts`'s `mergeSessionListWindow`), which is what
 *   keeps a Wi-Fi -> cellular switch from losing or duplicating rows.
 *
 * Every resync attempt is tagged with a local monotonic generation, the
 * same shape as `apps/web/src/features/sessions/
 * use-session-list-sync.ts`'s own fencing and T46A1's run-generation
 * fencing: a slow resync from an abandoned attempt (reconnect,
 * disconnect, reconnect again, within one round trip) can never resolve
 * after a newer attempt and clobber it.
 *
 * No React, no `react-native` — only this feature's own RN-free
 * `sessions-model.ts` and `NetworkStatus`'s plain data shape from
 * `@picompanion/frontend-core`. Testable directly in this workspace's
 * plain `vitest`, unlike `sessions-screen.tsx`.
 */
import type { NetworkStatus } from "@picompanion/frontend-core";

import {
  applySessionListWindow,
  markSessionListStale,
  setSessionListConnectionPath,
  type SessionListState,
  type SessionListWindow,
} from "./sessions-model";

export interface SessionListNetworkSyncDeps {
  /**
   * Fetches a fresh `SessionListWindow`. No live `DaemonClient` is wired
   * into Android yet (see `sessions-model.ts`'s module doc) — every test
   * here drives this against an injected fake, never a socket.
   */
  refreshSessions: () => Promise<SessionListWindow>;
  /** Read fresh on every resync attempt, never captured once. */
  getState: () => SessionListState;
  onStateChange: (state: SessionListState) => void;
  /** A resync attempt failed. Not fatal — the list stays whatever it last was (stale, if it was offline) and the next trigger tries again. */
  onRefreshFailed?: (message: string) => void;
}

/**
 * Drives `SessionListState` off a stream of `NetworkStatus` observations
 * fed to `handleNetworkStatus`. See module doc for exactly what each
 * call does and why it isn't itself subscribed to a real
 * `NetworkReachability`.
 */
export class SessionListNetworkSync {
  private readonly deps: SessionListNetworkSyncDeps;
  private previousStatus: NetworkStatus | null = null;
  private generation = 0;
  private resyncing = false;

  constructor(deps: SessionListNetworkSyncDeps) {
    this.deps = deps;
  }

  /** Whether a resync attempt is currently in flight. Test/inspection surface. */
  isResyncing(): boolean {
    return this.resyncing;
  }

  handleNetworkStatus(status: NetworkStatus): void {
    const previous = this.previousStatus;
    this.previousStatus = status;

    this.deps.onStateChange(setSessionListConnectionPath(this.deps.getState(), status.kind));

    if (!status.online) {
      this.deps.onStateChange(markSessionListStale(this.deps.getState()));
      return;
    }

    // `previous === null` means this is the first observation this
    // instance has ever made (fresh construction, or the very first
    // status a caller feeds in) -- not itself a resume signal, matching
    // `connection.ResumeController`'s own convention of only firing on
    // an *observed* offline -> online transition. An initial list load
    // is this feature's, not this module's.
    const cameOnline = previous !== null && previous.online === false;
    const pathSwitched = previous !== null && previous.online && previous.kind !== status.kind;
    if (cameOnline || pathSwitched) {
      void this.resync();
    }
  }

  private async resync(): Promise<void> {
    const generation = ++this.generation;
    this.resyncing = true;
    try {
      const window = await this.deps.refreshSessions();
      if (generation !== this.generation) return; // superseded by a newer resync attempt
      this.deps.onStateChange(applySessionListWindow(this.deps.getState(), window));
    } catch (error) {
      if (generation !== this.generation) return;
      const message = error instanceof Error ? error.message : String(error);
      this.deps.onRefreshFailed?.(message);
    } finally {
      if (generation === this.generation) this.resyncing = false;
    }
  }
}
