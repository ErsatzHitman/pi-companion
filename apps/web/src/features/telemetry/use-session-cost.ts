import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";
import { useCallback, useRef, useSyncExternalStore } from "react";

import type { SessionCostStore } from "./session-cost-store.js";

/**
 * Live-subscribes a `SessionCostStore` (T48A2) for `SessionCostMeter`,
 * mirroring `features/rail/use-pi-ui-rail-elements.ts`'s
 * `usePiUiRailElements` (T29C2): `useSyncExternalStore` requires an
 * unchanged snapshot to return the *same* reference or React re-renders
 * every subscriber in a loop, and `SessionCostStore.getSessionCost`
 * already caches its own snapshot per revision — see the store's
 * `cachedSnapshot` field — so this hook only needs to re-read it when the
 * store's `getRevision()` has actually moved.
 *
 * Deliberately outside `PiExtensionRail`/`ContextMeter`'s own component
 * tree — this hook's whole purpose is to update independently of
 * whatever else is mounted (plan.md §7.4, §14.5: the transcript must not
 * re-render because a sibling rail value changed), so it is its own
 * `useSyncExternalStore` subscription rather than a value threaded down
 * through a shared parent that also renders the transcript.
 */
export function useSessionCost(store: SessionCostStore): coreTelemetry.SessionCost {
  const cacheRef = useRef<{ revision: number; cost: coreTelemetry.SessionCost } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );

  const getSnapshot = useCallback((): coreTelemetry.SessionCost => {
    const revision = store.getRevision();
    const cached = cacheRef.current;
    if (cached && cached.revision === revision) return cached.cost;
    const cost = store.getSessionCost();
    cacheRef.current = { revision, cost };
    return cost;
  }, [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
