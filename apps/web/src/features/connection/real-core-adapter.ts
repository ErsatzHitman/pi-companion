import type { Clock, hosts } from "@picompanion/frontend-core";

/**
 * Generic core-shaped connection adapter (originally built to replace
 * `fake-core-adapter.ts`'s T15 stand-in for the shell badge).
 *
 * FIX-L3: the shell badge (`connection-status.tsx`) no longer reads
 * through this adapter. It used to: `DaemonClientProvider`
 * (`app/daemon-client-context.tsx`) published its live `HostController`
 * snapshot in here from a `useEffect`, one render after the same `info`
 * already reached every direct `useDaemonClientContext()` reader (the
 * session rail's connection foot, `host-screen.tsx`, and so on) — a
 * second, effect-lagged hop that could and did leave the badge on a
 * stale status after the real connection had already moved on. The
 * badge now reads `useDaemonClientContext()` directly, the exact same
 * source every other live consumer already used, so it can never lag
 * behind them again. `DaemonClientProvider` still republishes into this
 * adapter (`toDaemonConnectionState` below is still its mapping), kept
 * for any future plain get/subscribe consumer that does not otherwise
 * need the full `DaemonClientContextValue` shape; nothing in this app
 * currently reads it.
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
