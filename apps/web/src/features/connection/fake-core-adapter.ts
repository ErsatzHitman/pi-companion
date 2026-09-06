import type { Clock, KeyValueStorage } from "@picompanion/frontend-core";

import type { DaemonConnectionHint } from "./daemon-connection-hint.js";

/**
 * Fake connection adapter for the blank shell (T15).
 *
 * `frontend-core`'s `connection/` domain is a skeleton stub until T19A
 * implements the real `DaemonClient` lifecycle there; this module stands
 * in for it so the shell's connected/disconnected state already flows
 * through a core-shaped interface (`getConnectionSnapshot` +
 * `subscribeConnection`, read via `useSyncExternalStore`, plan.md §8.2)
 * rather than component-local `useState`. `use-connection-state.ts` is the
 * only thing that will need to change when T19A lands a real adapter.
 */
export type DaemonConnectionState = "connecting" | "connected" | "disconnected";

export interface DaemonConnectionSnapshot {
  state: DaemonConnectionState;
  /** The daemon this connection targets, when known. */
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

/** The manually saved host key, per plan.md §8.2 "manually saved host". */
export const SAVED_DAEMON_HOST_STORAGE_KEY = "dev.savedDaemonHost";

export interface CreateFakeCoreAdapterOptions {
  /** The daemon-served connection hint, when this build was served by a daemon. */
  hint?: DaemonConnectionHint | null;
  /** An explicit standalone-development daemon host (plan.md §8.2), e.g. from `import.meta.env`. */
  devDaemonHost?: string | null;
}

export interface FakeCoreAdapterPlatform {
  clock: Pick<Clock, "now">;
  storage: Pick<KeyValueStorage, "getItem">;
}

/**
 * Builds a fake `CoreConnectionAdapter`.
 *
 * Resolution order mirrors plan.md §8.2: a daemon-served hint wins, then
 * an explicit standalone-dev host, then a manually saved host read from
 * storage; otherwise the shell starts (and stays) disconnected.
 */
export function createFakeCoreAdapter(
  platform: FakeCoreAdapterPlatform,
  options: CreateFakeCoreAdapterOptions = {},
): CoreConnectionAdapter {
  const listeners = new Set<() => void>();
  let disposed = false;
  let snapshot: DaemonConnectionSnapshot = {
    state: "connecting",
    serverId: null,
    label: null,
    updatedAtMs: platform.clock.now(),
  };

  const setSnapshot = (next: DaemonConnectionSnapshot): void => {
    snapshot = next;
    if (disposed) return;
    for (const listener of listeners) listener();
  };

  const resolve = async (): Promise<void> => {
    const hint = options.hint ?? null;
    if (hint) {
      setSnapshot({
        state: "connected",
        serverId: hint.listen,
        label: hint.label,
        updatedAtMs: platform.clock.now(),
      });
      return;
    }

    const devHost = options.devDaemonHost ?? null;
    if (devHost) {
      setSnapshot({
        state: "connected",
        serverId: devHost,
        label: "Standalone dev daemon",
        updatedAtMs: platform.clock.now(),
      });
      return;
    }

    const savedHost = await platform.storage.getItem(SAVED_DAEMON_HOST_STORAGE_KEY);
    if (disposed) return;
    if (savedHost) {
      setSnapshot({
        state: "connected",
        serverId: savedHost,
        label: "Saved host",
        updatedAtMs: platform.clock.now(),
      });
      return;
    }

    setSnapshot({
      state: "disconnected",
      serverId: null,
      label: null,
      updatedAtMs: platform.clock.now(),
    });
  };

  void resolve();

  return {
    getConnectionSnapshot: () => snapshot,
    subscribeConnection(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
