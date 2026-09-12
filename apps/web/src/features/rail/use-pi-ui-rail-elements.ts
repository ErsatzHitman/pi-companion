import { extensions } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { useCallback, useRef, useSyncExternalStore } from "react";

type PiUiElementStore = InstanceType<typeof extensions.PiUiElementStore>;

/**
 * Live-subscribes one agent's Pi UI elements out of a `PiUiElementStore`
 * (`@picompanion/frontend-core`'s ephemeral projection of the Pi UI Bridge
 * stream, plan.md §7.1/§11.5). `features/extensions/pi-ui-session-context.tsx`'s
 * `PiUiSessionProvider` uses this to publish one live element list to every
 * placement destination (the right rail's pinned/status strips and the
 * centre column's inline/sheet/screen hosts); the name is historical — this
 * is no longer rail-only.
 *
 * `PiUiElementStore.getElements` allocates a fresh array on every call, which
 * violates `useSyncExternalStore`'s requirement that an unchanged snapshot
 * return the *same* reference (otherwise React re-renders in a loop). This
 * hook caches the last snapshot per store revision (`getRevision`) and only
 * asks the store for a new array when the revision the store reports has
 * actually moved — cheap, and correct even across a `reset`/resync, since
 * every mutation path in `state.ts` bumps the tracked revision.
 *
 * Not tied to any single destination: it only needs *a* store and an agent
 * id, so it is fully testable against a bare `PiUiElementStore` and is
 * reused by every placement host through `PiUiSessionProvider`.
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
