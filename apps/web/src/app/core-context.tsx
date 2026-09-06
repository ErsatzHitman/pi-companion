import type { CorePlatform } from "@picompanion/frontend-core";
import { createContext, useContext, useEffect, useMemo } from "react";

import { readDaemonConnectionHint } from "../features/connection/daemon-connection-hint.js";
import type { CoreConnectionAdapter } from "../features/connection/fake-core-adapter.js";
import { createFakeCoreAdapter } from "../features/connection/fake-core-adapter.js";
import { createWebPlatform } from "../platform/index.js";

export interface CoreContextValue {
  platform: CorePlatform;
  connection: CoreConnectionAdapter;
}

const CoreContext = createContext<CoreContextValue | null>(null);

/**
 * Provides this app's `CorePlatform` and (fake, until T19A) connection
 * adapter to the rest of the tree. Built once for the lifetime of the app
 * so subscriptions and platform resources are not recreated on re-render.
 */
export function CoreProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<CoreContextValue>(() => {
    const platform = createWebPlatform();
    const connection = createFakeCoreAdapter(platform, {
      hint: readDaemonConnectionHint(),
      devDaemonHost: import.meta.env.VITE_PASEO_DEV_DAEMON_HOST || null,
    });
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
