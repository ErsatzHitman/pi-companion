import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { actions, permissions } from "@picompanion/frontend-core";

import { sendPermissionAnswer, type DaemonPermissionsSource } from "./daemon-permissions-client.js";
import { buildOutcomeNotice, type OutcomeNoticeViewModel } from "./outcome-notice.js";

/**
 * Live-subscribes `controller`'s pending queue, the way
 * `features/rail/use-pi-ui-rail-elements.ts`'s `usePiUiRailElements`
 * live-subscribes a `PiUiElementStore`. `PermissionsController.getPending`
 * allocates a fresh array on every call (`entries.values().filter().map()`),
 * which would violate `useSyncExternalStore`'s "an unchanged snapshot
 * must return the *same* reference" requirement and re-render in a loop;
 * this caches the last snapshot and only recomputes after `controller`
 * actually notifies a change, mirroring that hook's own revision-cache
 * technique (here keyed by a dirty flag set inside `subscribe`, since
 * `PermissionsController` exposes no revision counter to compare against).
 */
function usePendingPermissions(
  controller: permissions.PermissionsController,
): readonly permissions.PermissionDialogViewModel[] {
  const cacheRef = useRef<readonly permissions.PermissionDialogViewModel[]>(
    controller.getPending(),
  );
  const dirtyRef = useRef(true);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      controller.subscribe(() => {
        dirtyRef.current = true;
        onStoreChange();
      }),
    [controller],
  );

  const getSnapshot = useCallback((): readonly permissions.PermissionDialogViewModel[] => {
    if (dirtyRef.current) {
      cacheRef.current = controller.getPending();
      dirtyRef.current = false;
    }
    return cacheRef.current;
  }, [controller]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export interface UseApprovalsQueueOptions {
  /** The `PermissionsController` instance to read/answer from (constructed once by `ApprovalsContainer`). */
  controller: permissions.PermissionsController;
  /**
   * Scopes the visible queue to one session/agent, matching
   * `ComposerContainer`'s `sessionId` prop. Omit to show every pending
   * request the controller knows about (e.g. a future cross-session
   * approvals surface).
   */
  sessionId?: string;
  /**
   * Live daemon adapter. `undefined` until a route wires a real
   * `DaemonClient` — the same "no live route yet" seam
   * `features/composer/use-composer.ts`'s `if (!client) return;` already
   * documents for `submit()`/`abort()`. Without one, `respond()` still
   * records the local answer (so this client's own UI reflects the
   * decision and the dialog closes) but sends nothing, since there is no
   * transport to send it over.
   */
  client?: DaemonPermissionsSource;
  /**
   * Optional single-answer arbitrator (T47A1a, reached through
   * `@picompanion/frontend-core`'s `actions` namespace per T103) that
   * detects when this client's view of a request was contested or
   * superseded by another connected client (T47A2, plan.md §12.3). Omit
   * to skip that surfacing entirely — `notice` then stays `null` forever
   * and behavior is unchanged from before this task. `ApprovalsContainer`
   * constructs one per session, the same way it already owns `controller`.
   */
  arbitrator?: actions.RequestArbitrator<permissions.AgentPermissionResponse>;
}

export interface ApprovalsQueueState {
  /** The oldest still-pending request, or `null` when the queue is empty. Dialogs are answered one at a time, in receipt order. */
  current: permissions.PermissionDialogViewModel | null;
  /** How many further requests are queued behind `current`. */
  waitingCount: number;
  /**
   * The most recent send failure, or `null`. `PermissionsController.answer`
   * is synchronous and optimistic (plan.md §7.2 — the daemon resolution
   * always wins later, but the local dialog closes immediately, the same
   * way `use-composer.ts`'s optimistic user row appears before its
   * network send settles) so a dialog is never held open "submitting" —
   * by the time a send could fail, `current` has already advanced past
   * it. This mirrors `use-composer.ts`'s own `sendError`: a banner
   * surfaced *after* the optimistic UI update, not a blocking spinner.
   * Persists across `current` changes (a slow failure for an *earlier*
   * request must stay visible even after a *later* one is already
   * showing) until `dismissError()` is called.
   */
  error: string | null;
  /** Answers `current` and advances the queue. A no-op if there is no `current`, and safely inert if `current` was already answered elsewhere (`sendPermissionAnswer` resolves `null`). */
  respond: (response: permissions.AgentPermissionResponse) => void;
  /** Clears `error`. */
  dismissError: () => void;
  /**
   * A readable explanation that the request this client was just looking
   * at (`current`, or the request it had just answered) was contested or
   * superseded by another client (T47A2, plan.md §12.3) — `null` when
   * nothing of the sort has happened, including whenever no `arbitrator`
   * was supplied. Takes over the same modal slot `current` would
   * otherwise occupy (`ApprovalsHost` shows at most one of the two at a
   * time) until `dismissNotice()` is called, so the losing client's
   * dialog closes with this explanation rather than the request simply
   * vanishing from the queue.
   */
  notice: OutcomeNoticeViewModel | null;
  /** Clears `notice` and lets the queue advance to whatever is next. */
  dismissNotice: () => void;
}

/**
 * Queue state and answer dispatch for the approvals surface (T28B7,
 * plan.md §12.3). One request is presented at a time — `current` — with
 * `waitingCount` surfacing (in text, not just count) that more are
 * queued behind it, matching the transcript/composer precedent of never
 * hiding queued work silently (plan.md §7.4, T28B3's queue display).
 */
export function useApprovalsQueue({
  controller,
  sessionId,
  client,
  arbitrator,
}: UseApprovalsQueueOptions): ApprovalsQueueState {
  const pending = usePendingPermissions(controller);
  const scoped = useMemo(
    () =>
      sessionId === undefined ? pending : pending.filter((view) => view.agentId === sessionId),
    [pending, sessionId],
  );
  const current = scoped[0] ?? null;
  const waitingCount = Math.max(0, scoped.length - 1);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<OutcomeNoticeViewModel | null>(null);

  // Every requestId this hook has ever shown as `current`, so a settled
  // arbitration outcome for a request this user never looked at (e.g. one
  // still queued behind `current` when another client answered it) never
  // produces a notice — see `outcome-notice.ts`'s module doc: this task's
  // charter is "the request they are looking at", not every request this
  // client merely knows about.
  const displayedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (current) displayedRef.current.add(current.requestId);
  }, [current]);

  useEffect(() => {
    if (!arbitrator) return;
    return arbitrator.subscribe((requestId, outcome) => {
      if (outcome.status !== "superseded" && outcome.status !== "resolved-elsewhere") return;
      if (!displayedRef.current.has(requestId)) return;
      const view = controller.get(requestId)?.view;
      if (!view) return;
      setNotice(buildOutcomeNotice(view, outcome));
    });
  }, [arbitrator, controller]);

  const respond = useCallback(
    (response: permissions.AgentPermissionResponse) => {
      if (!current) return;
      const requestId = current.requestId;
      arbitrator?.submitLocalAnswer(requestId, response);
      if (!client) {
        // No live client yet (see `error`'s own doc comment): record the
        // local answer so the dialog closes and the queue advances, but
        // there is nothing to send.
        controller.answer(requestId, response);
        return;
      }
      void sendPermissionAnswer(controller, client, requestId, response).catch((sendError) => {
        setError(sendError instanceof Error ? sendError.message : String(sendError));
      });
    },
    [arbitrator, client, controller, current],
  );

  const dismissError = useCallback(() => setError(null), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return { current, waitingCount, error, respond, dismissError, notice, dismissNotice };
}
