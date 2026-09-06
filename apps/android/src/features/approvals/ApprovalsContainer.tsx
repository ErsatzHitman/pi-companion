import { useEffect, useMemo } from "react";

import { permissions, type Clock, type TimerHandle } from "@picompanion/frontend-core";

import type { VibrationPlatform } from "../../platform/haptics/index.js";

import { ApprovalsHost } from "./ApprovalsHost";
import {
  wirePermissionsController,
  type DaemonPermissionsSource,
} from "./daemon-permissions-client";
import { useApprovalsQueue } from "./use-approvals-queue";

/**
 * Real-time `Clock` (plan.md §7.3) for `PermissionsController`. No
 * shared `platform/clock.ts` exists on Android yet (only `platform/
 * frame-clock.ts`, a different interface for animation frames), so this
 * is a small local implementation over the global `setTimeout`/
 * `clearTimeout`/`Date.now` React Native's JS runtime already provides
 * — not a DOM/browser global, and not a repository-invariant violation
 * (that rule binds `packages/frontend-core`, not `apps/android`).
 *
 * Like `apps/web/src/features/approvals/ApprovalsContainer.tsx`, no
 * `defaultTimeoutMs` is passed to `PermissionsController` below, so
 * `setTimeout`/`clearTimeout` are never actually invoked in practice —
 * inventing a client-side approval deadline would be guessing at a
 * value Pi's own protocol does not specify (see that file's own doc
 * comment). They are implemented correctly anyway rather than left as
 * throwing stubs, since — unlike a test double — this runs in the real
 * app.
 */
class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    return setTimeout(callback, delayMs) as unknown as TimerHandle;
  }
  clearTimeout(handle: TimerHandle): void {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    return setInterval(callback, intervalMs) as unknown as TimerHandle;
  }
  clearInterval(handle: TimerHandle): void {
    clearInterval(handle as unknown as ReturnType<typeof setInterval>);
  }
}

export interface ApprovalsContainerProps {
  /** Conversation this approvals surface answers for. */
  sessionId: string;
  /**
   * Live turn-control client. `undefined` until a route wires a real
   * `DaemonPermissionsSource` — see this file's own doc comment for
   * exactly what that requires today.
   */
  client?: DaemonPermissionsSource;
  /** Forwarded to `ApprovalsHost`'s own `onOpenChange` — see that component's doc comment. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Forwarded to `useApprovalsQueue` (T32S9, plan.md §9.3). The real
   * adapter is `AppCore.vibrationPlatform` (`app-shell/core.ts`),
   * constructed once and threaded down — `undefined` disables both the
   * "blocked" and "approval" haptic triggers this container fires.
   */
  vibrationPlatform?: VibrationPlatform;
  /** Forwarded to `useApprovalsQueue`. Defaults to `true` — see that hook's doc comment for why (no settings surface exists yet). */
  hapticsEnabled?: boolean;
}

/**
 * Wires the approvals surface (T33B5) to a real `PermissionsController`
 * and, once available, a live `client`. Owns the one controller instance
 * for this session: built once via `useMemo`, disposed on unmount,
 * re-wired to `client` whenever either changes — mirrors `apps/web/src/
 * features/approvals/ApprovalsContainer.tsx` exactly.
 *
 * **Nothing in `apps/android/src/app/` or `app-shell/` renders this
 * yet** (both are T32S6's grant this wave, `P5-W10`). The next
 * router-root task must:
 *
 * 1. Mount `<ApprovalsContainer sessionId={...} client={...} />` once
 *    per open session screen (or once globally, scoped by the active
 *    session id — either is a legitimate choice this task leaves open).
 * 2. Supply `sessionId` from whatever already identifies the open
 *    session (e.g. the session route's `agentId`).
 * 3. Supply `client`. The real candidate is
 *    `useAppCore().connection.getActiveLifecycle()?.getDaemonClient()`
 *    (`features/connect/daemon-connection-store.ts`, `AppCore.connection`
 *    — both unowned this wave). At runtime that *is* a real
 *    `@picompanion/client` `DaemonClient`, which structurally satisfies
 *    `DaemonPermissionsSource` (it has `respondToPermission`/`on(...)`).
 *    Its *type*, though, is `connection.DaemonClientLike`
 *    (`packages/frontend-core/src/connection/daemon-client-lifecycle.ts`),
 *    a narrower interface that does not declare those two members — so
 *    the mount point needs a cast
 *    (`getDaemonClient() as unknown as DaemonPermissionsSource | undefined`)
 *    until `DaemonClientLike` itself grows them (a `frontend-core`
 *    change, out of this task's `Owns` grant and unproven here).
 * 4. Render this inside (or as a sibling that shares state with) a
 *    `<PortalHost>` for `Sheet`'s Portal path to have a target — see
 *    `Sheet.tsx`'s own doc comment. T32S6 already mounted `<PortalHost>`
 *    around `<Stack>` in `app-shell/navigation-shell.tsx` (commit
 *    `fe6d221`), so any route rendered by that `<Stack>` is already
 *    inside a host and this step needs no new one — corrected by the
 *    P5-W10 merge gate, which found this line still describing the
 *    pre-T32S6 state.
 * 5. Optionally wire `onOpenChange` to a shared `ComposerFocusState`
 *    (`features/composer/composer-focus-model.ts`) via
 *    `openSheet(state, "extension")`/`closeSheet(state)` — see
 *    `ApprovalsHost.tsx`'s own doc comment for the exact call shape.
 */
export function ApprovalsContainer({
  sessionId,
  client,
  onOpenChange,
  vibrationPlatform,
  hapticsEnabled = true,
}: ApprovalsContainerProps) {
  const controller = useMemo(
    () => new permissions.PermissionsController({ clock: new SystemClock() }),
    [],
  );

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    if (!client) return;
    return wirePermissionsController(controller, client);
  }, [client, controller]);

  const queue = useApprovalsQueue({
    controller,
    sessionId,
    client,
    vibrationPlatform,
    hapticsEnabled,
  });

  return (
    <ApprovalsHost
      current={queue.current}
      waitingCount={queue.waitingCount}
      error={queue.error}
      onAnswer={queue.respond}
      onDismissError={queue.dismissError}
      onOpenChange={onOpenChange}
      testId="approvals-dialog"
    />
  );
}

export default ApprovalsContainer;
