/**
 * Session rename action state (T38A4, plan.md §7.1/§8.3/§11.1).
 *
 * Mirrors `use-session-actions.ts`'s optimistic shape for the dialog
 * lifecycle (open a confirmation-style dialog, apply the mutation
 * optimistically the instant it is confirmed, roll back on failure) —
 * renaming, like delete, targets a row that already exists, unlike
 * fork/clone which produce a brand-new one.
 *
 * ## Concurrent renames reconcile predictably (T38A4's hard criterion)
 *
 * **The rule: last-write-wins at the daemon.** `set_session_name` (the
 * daemon's Pi-provider RPC command this would eventually call, T38A0)
 * takes no version or precondition — it unconditionally overwrites the
 * session's title. So when two clients rename the same session at
 * close to the same time, whichever write the daemon *finishes
 * processing* last determines the session's true, persisted name; the
 * other client's own write is silently superseded at the daemon, not
 * rejected.
 *
 * A client's own `renameSession` call resolving successfully does
 * **not**, by itself, prove that client won: `set_session_name` has no
 * conflict detection, so *every* submitted rename resolves with
 * exactly the name it asked for, whether or not a third write landed
 * a moment later and overwrote it again. The only way a client can
 * discover it lost a race is a **later, independent** signal revealing
 * the session's current name differs from what it itself set — and the
 * only such signal that exists in this codebase today is the next
 * authoritative session-list reconcile (`useSessionListSync`, T27B6:
 * `fetchSessions()` on reconnect/gap-recovery). No live
 * "title changed" push event exists yet (checked: zero
 * `agent_updated`/`agent.title.` occurrences reachable from a client in
 * `packages/protocol/src/messages.ts`) — filed as the same shape of gap
 * `daemon-sessions-client.ts`'s `renameAgent` doc discloses for the
 * fork/clone/rename wire messages themselves; a natural owner is
 * whichever protocol task closes that gap next (T51A or a follow-up).
 *
 * This hook models exactly that using `@picompanion/frontend-core`'s
 * `actions.RequestArbitrator` (T47A1a, T103) — read that module's doc
 * before assuming a second mechanism is needed; it already produces
 * precisely the outcome plan.md §12.3 requires of a superseded answer:
 * "not as an error, and never silently". Every rename attempt opens its
 * own arbitration entry (a session can be renamed more than once over
 * its life, unlike a single-shot permission request), and
 * `reconcileTitle` — called by `SessionsScreen` with every session's
 * title the moment a sync resolves — applies the daemon's authoritative
 * title as that attempt's resolution:
 *
 * - if it matches what this client itself submitted, `"confirmed"` —
 *   this client's rename won;
 * - if it differs, `"superseded"` — another client's later write won,
 *   and `onRenameSuperseded` fires with **both** names so a caller can
 *   tell the user plainly what happened, never silently reverting the
 *   optimistic value with no explanation.
 *
 * Deliberately **not** wired through this client's own `renameSession`
 * round trip resolving: calling `RequestArbitrator.applyResolution` is
 * terminal (by design — see that module's doc), so treating a client's
 * own ack as the resolution would permanently close the entry before a
 * genuinely later, authoritative sync could ever reveal a lost race.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Clock } from "@picompanion/frontend-core";
import { actions } from "@picompanion/frontend-core";

import { SESSIONS_ACTION_UNSUPPORTED, type SessionsClient } from "./sessions-client.js";
import type { SessionSummary } from "./types.js";
import { validateSessionName } from "./validate-session-name.js";

export type RenameSessionPhase = "idle" | "renaming";

export interface UseRenameSessionOptions {
  client: SessionsClient;
  /**
   * Must stay referentially stable across renders (memoize it, the way
   * `SessionsScreen` memoizes its resolved clock with `useMemo(() =>
   * clock ?? createBrowserClock(), [clock])`) — this hook's arbitrator
   * is itself memoized keyed on `clock`'s identity, so a fresh `Clock`
   * object passed in on every render would silently reset it, losing
   * every outstanding rename attempt's local answer before
   * `reconcileTitle` ever sees it.
   */
  clock: Clock;
  /** Applies an (optimistic or daemon-confirmed) title to the session identified by `sessionId`. */
  onRenamed: (sessionId: string, title: string) => void;
  /** Rolls a failed rename back to `session`'s pre-rename state. */
  onRenameFailed: (session: SessionSummary, message: string) => void;
  /**
   * Fires when this client's own submitted rename is confirmed lost to
   * a concurrent rename that reached the daemon later (see this
   * module's doc). Never an error path — the loser observes the
   * winning title, carried alongside its own attempted one, not a
   * failure. Optional so a caller that never syncs (no live connection
   * wired yet) simply never needs this.
   */
  onRenameSuperseded?: (sessionId: string, attempted: string, current: string) => void;
}

export interface RenameSessionController {
  /** Whether the rename dialog is open. */
  renameDialogOpen: boolean;
  /** The session the rename dialog targets, if open. */
  renameTarget: SessionSummary | null;
  /** The dialog's current draft name (a controlled input value). */
  renameDraft: string;
  renamePhase: RenameSessionPhase;
  /** A client-side validation error for the current draft (bounds/emptiness), if any. */
  renameValidationError: string | null;
  /** The raw daemon error message from the last failed submit, if any. */
  renameErrorMessage: string | null;
  requestRename: (session: SessionSummary) => void;
  setRenameDraft: (value: string) => void;
  confirmRename: () => void;
  cancelRename: () => void;
  /**
   * Feeds a freshly observed authoritative title for `sessionId` (from
   * a session-list reconcile) into this client's outstanding rename
   * arbitration for that session, if any — see this module's doc for
   * why this is the only channel a lost race can be discovered through
   * today.
   */
  reconcileTitle: (sessionId: string, title: string | null) => void;
}

let renameAttemptSequence = 0;

export function useRenameSession(options: UseRenameSessionOptions): RenameSessionController {
  const { client, clock, onRenamed, onRenameFailed, onRenameSuperseded } = options;

  const arbitrator = useMemo(() => new actions.RequestArbitrator<string>({ clock }), [clock]);
  useEffect(() => () => arbitrator.dispose(), [arbitrator]);

  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePhase, setRenamePhase] = useState<RenameSessionPhase>("idle");
  const [renameValidationError, setRenameValidationError] = useState<string | null>(null);
  const [renameErrorMessage, setRenameErrorMessage] = useState<string | null>(null);
  const renamingRef = useRef(false);

  // The most recent outstanding rename-attempt request id this client
  // submitted per session id, so `reconcileTitle` knows which
  // arbitration entry a fresh sync should resolve (and so a second
  // rename of the same session supersedes tracking the first attempt,
  // never double-resolves it).
  const pendingAttemptBySessionId = useRef(new Map<string, string>());

  const requestRename = useCallback((session: SessionSummary): void => {
    if (renamingRef.current) return; // never abandon an in-flight rename
    setRenameTarget(session);
    setRenameDraft(session.title ?? "");
    setRenamePhase("idle");
    setRenameValidationError(null);
    setRenameErrorMessage(null);
  }, []);

  const cancelRename = useCallback((): void => {
    if (renamingRef.current) return; // never abandon an in-flight rename
    setRenameTarget(null);
  }, []);

  const confirmRename = useCallback((): void => {
    if (renamingRef.current) return;
    const target = renameTarget;
    if (!target) return;

    const validation = validateSessionName(renameDraft);
    if (!validation.ok) {
      setRenameValidationError(validation.error);
      return;
    }
    const { name } = validation;

    setRenameValidationError(null);
    setRenameErrorMessage(null);
    renamingRef.current = true;
    setRenamePhase("renaming");

    // Open a fresh arbitration entry for this attempt (not per-session,
    // per-attempt — see module doc) and record this client's own
    // optimistic answer before the round trip resolves.
    const requestId = `rename:${target.id}:${(renameAttemptSequence += 1)}`;
    pendingAttemptBySessionId.current.set(target.id, requestId);
    arbitrator.open(requestId);
    arbitrator.submitLocalAnswer(requestId, name);

    // Optimistic: the row shows the new name immediately, before the
    // daemon round-trip resolves; a failure rolls it back via
    // `onRenameFailed`.
    onRenamed(target.id, name);
    setRenameTarget(null);

    const request = client.renameSession
      ? client.renameSession(target.id, { name })
      : Promise.reject(new Error(SESSIONS_ACTION_UNSUPPORTED));

    request.then(
      (result) => {
        renamingRef.current = false;
        setRenamePhase("idle");
        // Reconcile with whatever the daemon actually stored (it may
        // differ from `name` if the daemon ever normalizes it) — this
        // is this client's own ack, never fed to the arbitrator (see
        // module doc for why that would prematurely terminate the
        // entry before a later sync could reveal a lost race).
        if (result.session.title !== null && result.session.title !== name) {
          onRenamed(target.id, result.session.title);
        }
      },
      (error: unknown) => {
        renamingRef.current = false;
        setRenamePhase("idle");
        setRenameErrorMessage(error instanceof Error ? error.message : String(error));
        onRenameFailed(target, error instanceof Error ? error.message : String(error));
      },
    );
  }, [arbitrator, client, onRenamed, onRenameFailed, renameDraft, renameTarget]);

  const reconcileTitle = useCallback(
    (sessionId: string, title: string | null): void => {
      const requestId = pendingAttemptBySessionId.current.get(sessionId);
      if (!requestId) return; // no outstanding rename attempt for this session
      if (title === null) return; // nothing authoritative to reconcile against yet

      const outcome = arbitrator.applyResolution(requestId, { response: title });
      // Terminal either way (`applyResolution` always settles the
      // entry) — stop tracking this attempt so a later, unrelated sync
      // never re-fires a callback for it.
      pendingAttemptBySessionId.current.delete(sessionId);

      if (outcome.status === "superseded") {
        onRenameSuperseded?.(sessionId, outcome.localResponse, outcome.response);
      }
    },
    [arbitrator, onRenameSuperseded],
  );

  return {
    renameDialogOpen: renameTarget !== null,
    renameTarget,
    renameDraft,
    renamePhase,
    renameValidationError,
    renameErrorMessage,
    requestRename,
    setRenameDraft,
    confirmRename,
    cancelRename,
    reconcileTitle,
  };
}
