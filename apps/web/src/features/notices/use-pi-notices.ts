/**
 * Live-subscribes a `PiNoticeStore` (T112) for `PiNoticeBanner`, mirroring
 * `features/telemetry/use-session-cost.ts`'s `useSessionCost` and
 * `features/rail/use-pi-ui-rail-elements.ts`'s `usePiUiRailElements`:
 * `PiNoticeStore.getSnapshot()` already returns the same array reference
 * until the next `ingest`/`dismiss`, so `useSyncExternalStore` never
 * re-renders this subscriber on an unchanged snapshot.
 *
 * Deliberately its own `useSyncExternalStore` subscription rather than a
 * value threaded down through a shared parent that also renders the
 * transcript or composer — the same "a sibling rail value changing must
 * not re-render the transcript" isolation `useSessionCost`'s own doc
 * comment explains.
 */
import { useCallback, useSyncExternalStore } from "react";

import type { PiNoticeEntry, PiNoticeStore } from "./pi-notice-store.js";

export function usePiNotices(store: PiNoticeStore): readonly PiNoticeEntry[] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
