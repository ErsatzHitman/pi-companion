import { useSyncExternalStore } from "react";

import { useCore } from "../../app/core-context.js";
import type { DaemonConnectionSnapshot } from "./fake-core-adapter.js";

/**
 * Reads the current daemon connection snapshot from the core adapter.
 *
 * This is the only place a component reaches into the adapter directly;
 * everything else renders from the returned snapshot, so connection state
 * flows through the core interface rather than component-local state.
 */
export function useConnectionState(): DaemonConnectionSnapshot {
  const { connection } = useCore();
  return useSyncExternalStore(connection.subscribeConnection, connection.getConnectionSnapshot);
}
