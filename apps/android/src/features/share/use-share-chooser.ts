/**
 * Live-subscribes a `ShareChooserRuntime`'s state for React (T69).
 *
 * Mirrors `../extensions/use-pi-ui-elements.ts`'s `useSyncExternalStore`
 * shape exactly: this file only reaches `react`, never `react-native`, so
 * it stays outside this workspace's Rolldown/`react-native` `vitest`
 * limitation (`../../CLAUDE.md`'s VITEST LIMITATION note) and — like
 * that hook, and `../connect/use-connection-status.ts` — is deliberately
 * not unit-tested directly. The state transitions this hook exposes are
 * already proven with real behavior, no React involved, against a
 * scripted-fake port in `share-chooser-runtime.test.ts`; this hook adds
 * no logic of its own beyond `useSyncExternalStore`'s own subscribe/
 * snapshot plumbing.
 */
import { useCallback, useSyncExternalStore } from "react";

import type { ShareChooserRuntime, ShareChooserSnapshot } from "./share-chooser-runtime.js";

/** The live snapshot of `runtime` — re-renders the calling component on every state change `runtime.subscribe` reports. */
export function useShareChooserSnapshot(runtime: ShareChooserRuntime): ShareChooserSnapshot {
  const subscribe = useCallback(
    (onStoreChange: () => void) => runtime.subscribe(() => onStoreChange()),
    [runtime],
  );
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
