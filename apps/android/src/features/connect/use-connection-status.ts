import { useEffect, useState } from "react";

import type { DaemonConnectionSnapshot, DaemonConnectionStore } from "./daemon-connection-store.js";

/**
 * Reads live daemon connection state from a `DaemonConnectionStore`
 * (T32A1B) — the store `connection-shell.tsx` builds over
 * `daemon-connect-attempt.ts`'s real `connection.DaemonClientLifecycle`.
 *
 * Before T32A1B this hook took no arguments and read
 * `AppCore["network"]`, which `apps/android/src/platform/fake-network.ts`
 * backed with an in-memory, always-online fake — there was no real
 * connection anywhere on Android yet. That fake network adapter is no
 * longer on this hook's production path: this hook now reports exactly
 * what the live lifecycle (or its absence) says, `"idle"` until a
 * connection has ever been attempted.
 *
 * This paragraph previously said `apps/android/src/app/core.ts` "still
 * constructs `FakeNetworkReachability` for `AppCore["network"]`".
 * Corrected at the P5-W7 merge gate: T32S3 made both halves false and
 * could not edit this file (`features/connect/` was a sibling's grant
 * that wave). That module is now `apps/android/src/app-shell/core.ts`
 * (moved, no shim), and it constructs `PollingNetworkReachability`
 * (`../../platform/network-reachability.ts`), a real probe-based
 * adapter. `FakeNetworkReachability` survives only in
 * `../../platform/fake-network.ts`, reachable from one test and from
 * `../../platform/index.ts` — a barrel with no importer at all — so it
 * is off every production path, this hook's included.
 */
export function useConnectionStatus(store: DaemonConnectionStore): DaemonConnectionSnapshot {
  const [snapshot, setSnapshot] = useState<DaemonConnectionSnapshot>(store.getSnapshot());

  useEffect(() => {
    setSnapshot(store.getSnapshot());
    return store.subscribe(setSnapshot);
  }, [store]);

  return snapshot;
}
