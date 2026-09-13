import type { CorePlatform } from "@picompanion/frontend-core";
import { createContext, useContext, useEffect, useMemo } from "react";

import type { RealCoreAdapter } from "../features/connection/real-core-adapter.js";
import { createRealCoreAdapter } from "../features/connection/real-core-adapter.js";
import { createWebPlatform } from "../platform/index.js";

export interface CoreContextValue {
  platform: CorePlatform;
  connection: RealCoreAdapter;
}

const CoreContext = createContext<CoreContextValue | null>(null);

/**
 * Provides this app's `CorePlatform` and live connection adapter to the
 * rest of the tree. Built once for the lifetime of the app so
 * subscriptions and platform resources are not recreated on re-render.
 *
 * The adapter starts disconnected and carries no connection logic of its
 * own: `DaemonClientProvider` (`daemon-client-context.tsx`, nested
 * inside) publishes `HostController`'s live snapshot into it, so the
 * shell badge (`features/connection/connection-status.tsx`) reflects the
 * real `DaemonClient` lifecycle — the same one every live screen already
 * reads via `useDaemonClientContext()`.
 */
export function CoreProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<CoreContextValue>(() => {
    const platform = createWebPlatform();
    const connection = createRealCoreAdapter(platform.clock);
    return { platform, connection };
  }, []);

  useEffect(() => () => value.connection.dispose(), [value]);

  return <CoreContext.Provider value={value}>{children}</CoreContext.Provider>;
}

export function useCore(): CoreContextValue {
  const value = useContext(CoreContext);
  if (!value) {
    throw new Error("useCore() must be called within a <CoreProvider>");
  }
  return value;
}
