import type { Clock, hosts } from "@picompanion/frontend-core";

/**
 * Live connection adapter for the shell badge (replaces
 * `fake-core-adapter.ts`'s T15 stand-in).
 *
 * The badge (`connection-status.tsx`, via `use-connection-state.ts`) reads
 * shell connection state through the core-shaped interface below
 * (`getConnectionSnapshot` + `subscribeConnection`, read via
 * `useSyncExternalStore`). The fake resolved that interface from static
 * sources alone (a daemon-served hint, a dev-env host, a saved host) and
 * so claimed "Connected" without ever opening a socket. This adapter
 * carries no resolution logic of its own: `DaemonClientProvider`
 * (`app/daemon-client-context.tsx`) publishes the live
 * `HostController` snapshot it already subscribes to, so the badge reads
 * the same `DaemonClient` lifecycle every live screen already reads via
 * `useDaemonClientContext()` — one `HostController`, one subscription
 * chain. This module never calls `subscribeConnectionInfo` itself, so it
 * adds no second subscription.
 */
export type DaemonConnectionState = "connecting" | "connected" | "disconnected";

export interface DaemonConnectionSnapshot {
  state: DaemonConnectionState;
  /** The connected profile's id (`HostControllerConnectionInfo.profileId`), when known. */
  serverId: string | null;
  /** A human-readable label for the target daemon, when known. */
  label: string | null;
  updatedAtMs: number;
}

export interface CoreConnectionAdapter {
  getConnectionSnapshot(): DaemonConnectionSnapshot;
  /** Subscribes to snapshot changes; returns an unsubscribe function. */
  subscribeConnection(listener: () => void): () => void;
  /** Releases resources and stops notifying subscribers. */
  dispose(): void;
}

/** A live `CoreConnectionAdapter` fed by `DaemonClientProvider`'s own `HostController` snapshot. */
export interface RealCoreAdapter extends CoreConnectionAdapter {
  /**
   * Replaces the snapshot from `HostController`'s live
   * `HostControllerConnectionInfo` plus its current profile's label.
   * Notifies subscribers only when `state`/`serverId`/`label` actually
   * changed, so a republish of the same generation (e.g. React
   * StrictMode's double effect) never fans out into a spurious render.
   */
  publishHostConnection(
    info: hosts.HostControllerConnectionInfo,
    profileLabel: string | null,
  ): void;
}

/**
 * Collapses `HostControllerConnectionStatus` onto the badge's three
 * states, mirroring `routes/root-route.tsx`'s `toSessionListConnectionState`
 * so the shell badge and the session rail never disagree: only a live
 * `"connected"` reads connected; the three in-flight statuses read
 * connecting; everything else (`"idle"`, `"disconnected"`, `"disposed"`,
 * `"offline"`) reads disconnected — in every case no live `DaemonClient`
 * exists behind the badge.
 */
export function toDaemonConnectionState(
  status: hosts.HostControllerConnectionStatus,
): DaemonConnectionState {
  if (status === "connected") return "connected";
  if (status === "connecting" || status === "probing" || status === "reconnect-pending") {
    return "connecting";
  }
  return "disconnected";
}

const DISCONNECTED_SNAPSHOT = {
  state: "disconnected",
  serverId: null,
  label: null,
} as const;

/**
 * Builds the live adapter. Starts disconnected (no `DaemonClient`
 * exists before `DaemonClientProvider` publishes its first snapshot),
 * which is also what a `CoreProvider`-only tree — no
 * `DaemonClientProvider` above the badge — honestly renders.
 */
export function createRealCoreAdapter(clock: Pick<Clock, "now">): RealCoreAdapter {
  const listeners = new Set<() => void>();
  let disposed = false;
  let snapshot: DaemonConnectionSnapshot = {
    ...DISCONNECTED_SNAPSHOT,
    updatedAtMs: clock.now(),
  };

  const setSnapshot = (next: DaemonConnectionSnapshot): void => {
    const unchanged =
      next.state === snapshot.state &&
      next.serverId === snapshot.serverId &&
      next.label === snapshot.label;
    snapshot = next;
    if (unchanged || disposed) return;
    for (const listener of listeners) listener();
  };

  return {
    getConnectionSnapshot: () => snapshot,
    subscribeConnection(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publishHostConnection(info, profileLabel) {
      setSnapshot({
        state: toDaemonConnectionState(info.status),
        serverId: info.profileId,
        label: profileLabel,
        updatedAtMs: clock.now(),
      });
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
