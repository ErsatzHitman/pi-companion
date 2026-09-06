import { extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { useCallback, useRef, useSyncExternalStore } from "react";

type PiUiElementStore = InstanceType<typeof extensions.PiUiElementStore>;

/**
 * Live-subscribes one agent's Pi UI elements out of a `PiUiElementStore`
 * (`@picompanion/frontend-core`'s ephemeral projection of the Pi UI Bridge
 * stream, plan.md §7.1/§11.5) for `PiExtensionRail`.
 *
 * `PiUiElementStore.getElements` allocates a fresh array on every call, which
 * violates `useSyncExternalStore`'s requirement that an unchanged snapshot
 * return the *same* reference (otherwise React re-renders in a loop). This
 * hook caches the last snapshot per store revision (`getRevision`) and only
 * asks the store for a new array when the revision the store reports has
 * actually moved — cheap, and correct even across a `reset`/resync, since
 * every mutation path in `state.ts` bumps the tracked revision.
 *
 * Not wired to `CoreProvider` yet — connecting a real `PiUiElementStore` to a
 * live session is a later task's concern (plan.md §12.2); this hook only
 * needs *a* store and an agent id, so it is fully testable against a bare
 * `PiUiElementStore` today.
 */
export function usePiUiRailElements(
  store: PiUiElementStore,
  agentId: string,
): readonly PiUiElement[] {
  const cacheRef = useRef<{ revision: number; elements: PiUiElement[] } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      store.subscribe((changedAgentId) => {
        if (changedAgentId === agentId) onStoreChange();
      }),
    [store, agentId],
  );

  const getSnapshot = useCallback((): readonly PiUiElement[] => {
    const revision = store.getRevision(agentId);
    const cached = cacheRef.current;
    if (cached && cached.revision === revision) return cached.elements;
    const elements = store.getElements(agentId);
    cacheRef.current = { revision, elements };
    return elements;
  }, [store, agentId]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
