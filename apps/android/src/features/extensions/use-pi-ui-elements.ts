/**
 * Live-subscribes one agent's Pi UI elements and revision out of a
 * `PiUiSession`'s store (T34A5), for whichever screen renders
 * `PinnedLiveExtensionArea` (T32S4, `apps/android/src/app-shell/`).
 *
 * Mirrors `apps/web/src/features/rail/use-pi-ui-rail-elements.ts`'s
 * `useSyncExternalStore` shape exactly, including its reason for existing:
 * `PiUiElementStore.getElements` allocates a fresh array on every call,
 * which violates `useSyncExternalStore`'s requirement that an unchanged
 * snapshot return the *same* reference (otherwise React re-renders in a
 * loop) — this hook caches the last snapshot per store revision
 * (`getRevision`) and only asks the store for a new array when the
 * revision has actually moved.
 *
 * Deliberately not unit-tested directly, matching this workspace's
 * existing precedent for a thin `react`-only (no `react-native`) hook over
 * an already-tested store — see `../connect/use-connection-status.ts`,
 * which wraps `daemon-connection-store.ts` the same way and carries no
 * test file of its own. The behavior this hook depends on —
 * store ordering, revision determinism, resync/discard rules — is proven
 * directly against the store in `pi-ui-session.test.ts`, without needing
 * React or `useSyncExternalStore` in the loop; this file only reaches
 * `react`, never `react-native`, so it stays outside the Flow-parse
 * limitation this workspace's `vitest` has for every `.tsx` renderer.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

import type { extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

export interface PiUiAgentElements {
  elements: readonly PiUiElement[];
  revision: number;
}

const EMPTY: PiUiAgentElements = { elements: [], revision: 0 };

/**
 * Reads `store`'s live elements and revision for one `agentId`. A route
 * passes `result.elements`/`result.revision` straight through to
 * `PinnedLiveExtensionArea`'s `elements`/`revision` props, unchanged.
 */
export function usePiUiElements(
  store: extensions.PiUiElementStore,
  agentId: string,
): PiUiAgentElements {
  const cacheRef = useRef<{ revision: number; snapshot: PiUiAgentElements } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      store.subscribe((changedAgentId) => {
        if (changedAgentId === agentId) onStoreChange();
      }),
    [store, agentId],
  );

  const getSnapshot = useCallback((): PiUiAgentElements => {
    const revision = store.getRevision(agentId);
    const cached = cacheRef.current;
    if (cached && cached.revision === revision) return cached.snapshot;
    const elements = store.getElements(agentId);
    const snapshot: PiUiAgentElements =
      elements.length === 0 && revision === 0 ? EMPTY : { elements, revision };
    cacheRef.current = { revision, snapshot };
    return snapshot;
  }, [store, agentId]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
