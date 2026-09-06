import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { permissions } from "@picompanion/frontend-core";

import type { VibrationPlatform } from "../../platform/haptics/index.js";

import {
  fireApprovalDecisionHaptic,
  fireBlockedHapticOnNewRequest,
} from "./approvals-haptics-model.js";
import { getApprovalsQueueSnapshot, type ApprovalsQueueSnapshot } from "./approvals-queue-model.js";
import { sendPermissionAnswer, type DaemonPermissionsSource } from "./daemon-permissions-client.js";

/**
 * Thin React wiring over `approvals-queue-model.ts`'s pure
 * `getApprovalsQueueSnapshot` — mirrors
 * `apps/web/src/features/approvals/use-approvals-queue.ts`'s own
 * `usePendingPermissions`/`useApprovalsQueue` structure, including its
 * `useSyncExternalStore` snapshot-caching trick (`PermissionsController.
 * getPending` allocates a fresh array every call, which would violate
 * `useSyncExternalStore`'s "same reference for an unchanged snapshot"
 * requirement without it).
 *
 * **Untested directly** — this workspace has no `@testing-library/
 * react`/`react-test-renderer` (`apps/android/package.json`'s
 * `devDependencies` carries neither, unlike `apps/web`), so a real hook
 * render is not available here the way `use-approvals-queue.test.ts`
 * exercises it on web. Every behavior this hook has is instead proved
 * against `getApprovalsQueueSnapshot`/`sendPermissionAnswer` directly in
 * `approvals-queue-model.test.ts`/`daemon-permissions-client.test.ts`;
 * this file only wires those pure functions to `useState`/
 * `useSyncExternalStore`, the same "thin view over a tested model"
 * convention `Composer.tsx` documents for `composer-model.ts`.
 */
function usePendingSnapshot(
  controller: permissions.PermissionsController,
  sessionId: string | undefined,
): ApprovalsQueueSnapshot {
  const cacheRef = useRef<ApprovalsQueueSnapshot>(getApprovalsQueueSnapshot(controller, sessionId));
  const dirtyRef = useRef(true);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      controller.subscribe(() => {
        dirtyRef.current = true;
        onStoreChange();
      }),
    [controller],
  );

  const getSnapshot = useCallback((): ApprovalsQueueSnapshot => {
    if (dirtyRef.current) {
      cacheRef.current = getApprovalsQueueSnapshot(controller, sessionId);
      dirtyRef.current = false;
    }
    return cacheRef.current;
  }, [controller, sessionId]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export interface UseApprovalsQueueOptions {
  /** The `PermissionsController` instance to read/answer from (constructed once by `ApprovalsContainer`). */
  controller: permissions.PermissionsController;
  /** Scopes the visible queue to one session/agent. Omit to show every pending request the controller knows about. */
  sessionId?: string;
  /** Live daemon adapter. `undefined` until a route wires a real `DaemonClient` — see `daemon-permissions-client.ts`'s doc comment. */
  client?: DaemonPermissionsSource;
  /**
   * Real device vibration adapter (T32S9, `platform/haptics/`), constructed
   * once in `app-shell/core.ts` and threaded down as `AppCore.vibrationPlatform`.
   * `undefined` disables both haptic triggers below entirely — there is
   * nothing to vibrate through, not a silently-ignored setting.
   */
  vibrationPlatform?: VibrationPlatform;
  /**
   * Whether haptics are enabled by the app/system setting. No settings
   * surface exists yet for this anywhere in `apps/android` (see
   * `approvals-haptics-model.ts`'s doc comment) — defaults to `true`
   * rather than inventing a private toggle.
   */
  hapticsEnabled?: boolean;
}

export interface ApprovalsQueueState {
  readonly current: permissions.PermissionDialogViewModel | null;
  readonly waitingCount: number;
  /** The most recent send failure, or `null`. Persists across `current` changes until `dismissError()` is called — mirrors the web hook's own contract. */
  readonly error: string | null;
  /** Answers `current` and advances the queue. A no-op if there is no `current`. */
  respond: (response: permissions.AgentPermissionResponse) => void;
  /** Clears `error`. */
  dismissError: () => void;
}

/** Queue state and answer dispatch for the approvals surface (T33B5, plan.md §12.3). Ported from `apps/web/src/features/approvals/use-approvals-queue.ts`. */
export function useApprovalsQueue({
  controller,
  sessionId,
  client,
  vibrationPlatform,
  hapticsEnabled = true,
}: UseApprovalsQueueOptions): ApprovalsQueueState {
  const snapshot = usePendingSnapshot(controller, sessionId);
  const [error, setError] = useState<string | null>(null);

  // T32S9: fires the "blocked" haptic (plan.md §9.3) the moment a *new*
  // request becomes `snapshot.current` — see `approvals-haptics-model.ts`
  // for why "blocked" (not "approval") owns that moment.
  // `previousSnapshotRef` starts at this render's own `snapshot`, so the
  // very first render (including one that mounts with a request already
  // pending) never fires — only a transition *after* mount does.
  const previousSnapshotRef = useRef<ApprovalsQueueSnapshot>(snapshot);
  useEffect(() => {
    if (vibrationPlatform) {
      fireBlockedHapticOnNewRequest(
        vibrationPlatform,
        hapticsEnabled,
        previousSnapshotRef.current,
        snapshot,
      );
    }
    previousSnapshotRef.current = snapshot;
  }, [snapshot, vibrationPlatform, hapticsEnabled]);

  const respond = useCallback(
    (response: permissions.AgentPermissionResponse) => {
      const current = snapshot.current;
      if (!current) return;
      const requestId = current.requestId;
      // T32S9: fires the "approval" haptic (plan.md §9.3) for the user's
      // own decision, synchronously with the local `controller.answer()`
      // commit below — before any network round-trip. See
      // `approvals-haptics-model.ts`'s doc comment for why this is
      // "approval" rather than "blocked".
      if (vibrationPlatform) {
        fireApprovalDecisionHaptic(vibrationPlatform, hapticsEnabled);
      }
      if (!client) {
        // No live client yet: record the local answer so the dialog
        // closes and the queue advances, but there is nothing to send.
        controller.answer(requestId, response);
        return;
      }
      void sendPermissionAnswer(controller, client, requestId, response).catch((sendError) => {
        setError(sendError instanceof Error ? sendError.message : String(sendError));
      });
    },
    [client, controller, snapshot.current, vibrationPlatform, hapticsEnabled],
  );

  const dismissError = useCallback(() => setError(null), []);

  return {
    current: snapshot.current,
    waitingCount: snapshot.waitingCount,
    error,
    respond,
    dismissError,
  };
}
