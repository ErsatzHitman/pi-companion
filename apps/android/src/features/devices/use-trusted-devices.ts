/**
 * Live trusted-device list (T42A1) — wraps `trusted-devices-model.ts`'s
 * `fetchTrustedDevices` in `useState`/`useEffect`, the same "subscribe,
 * set state" shape `../diagnostics/use-diagnostics-snapshot.ts` already
 * uses for a plain store. No colocated test file for the identical
 * reason that hook has none: there is nothing here beyond wiring for a
 * render pass to get wrong that `trusted-devices-model.test.ts`'s
 * pure-function tests do not already cover.
 *
 * Takes a STRUCTURAL `subscribeToConnectionChanges` callback rather than
 * importing `features/connect`'s concrete `DaemonConnectionStore` —
 * this feature directory stays decoupled from its siblings, exactly as
 * `use-diagnostics-snapshot.ts`'s own doc comment describes for the
 * identical reason. A real caller wraps
 * `connection.subscribe(() => onChange())` to satisfy it — see
 * `app/h/[serverId]/devices.tsx`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  LOADING_TRUSTED_DEVICES_SNAPSHOT,
  fetchTrustedDevices,
  type TrustedDevicesClient,
  type TrustedDevicesSnapshot,
} from "./trusted-devices-model.js";

export interface UseTrustedDevicesOptions {
  /** Re-read on every call — a reconnect swaps in a new client instance, the same fresh-read convention every daemon-backed hook in this app follows (see `use-diagnostics-snapshot.ts`'s own doc comment). `null` when no client is live. */
  getClient: () => TrustedDevicesClient | null;
  /**
   * Wraps whatever connection-change signal the caller has (a reconnect,
   * a fresh connect) into a plain no-argument callback — e.g.
   * `(onChange) => connection.subscribe(() => onChange())`. Omit to fetch
   * once on mount and rely on the returned `refresh()` only.
   */
  subscribeToConnectionChanges?: (onChange: () => void) => () => void;
}

export interface UseTrustedDevicesResult {
  snapshot: TrustedDevicesSnapshot;
  /** Re-fetches immediately, e.g. from a pull-to-refresh or a manual "Refresh" button. */
  refresh: () => void;
}

export function useTrustedDevices(options: UseTrustedDevicesOptions): UseTrustedDevicesResult {
  const { getClient, subscribeToConnectionChanges } = options;
  const [snapshot, setSnapshot] = useState<TrustedDevicesSnapshot>(
    LOADING_TRUSTED_DEVICES_SNAPSHOT,
  );
  /** Guards against a slow, stale fetch overwriting a newer one's result — the same shape a reconnect-triggered re-fetch racing a manual refresh needs. */
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    setSnapshot(LOADING_TRUSTED_DEVICES_SNAPSHOT);
    void fetchTrustedDevices(getClient()).then((result) => {
      if (requestSeq.current === seq) {
        setSnapshot(result);
      }
    });
  }, [getClient]);

  useEffect(() => {
    load();
    if (!subscribeToConnectionChanges) {
      return undefined;
    }
    return subscribeToConnectionChanges(load);
  }, [load, subscribeToConnectionChanges]);

  return { snapshot, refresh: load };
}
