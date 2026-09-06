/**
 * Session archive/delete action state (T27B4, plan.md §8.3/§12.3).
 *
 * Mirrors `use-create-session.ts`'s shape (a controller hook consumed
 * by a thin presentational component) but drives two actions instead
 * of one:
 *
 * - `archive(session)` fires immediately (no confirmation — archiving
 *   is reversible in spirit, and this product exposes no undo, but it
 *   is non-destructive) and calls back twice: once *optimistically*,
 *   before the daemon round-trip resolves, and once more to reconcile
 *   with the daemon's real `archivedAt` (or to roll back on failure).
 * - `requestDelete(session)` opens a confirmation dialog
 *   (`DeleteSessionDialog`); only `confirmDelete()` actually calls the
 *   client, and it also removes the row optimistically before the
 *   round-trip resolves, rolling back on failure.
 *
 * This hook never touches `SessionListState` directly — the screen
 * that owns the list state passes `onArchived`/`onArchiveFailed`/
 * `onDeleted`/`onDeleteFailed` callbacks that apply (or undo) the
 * mutation, matching `useCreateSession`'s `onCreated` precedent.
 */
import { useCallback, useRef, useState } from "react";

import { SESSIONS_ACTION_UNSUPPORTED, type SessionsClient } from "./sessions-client.js";
import type { SessionSummary } from "./types.js";

export type DeleteSessionPhase = "idle" | "deleting";

export interface UseSessionActionsOptions {
  client: SessionsClient;
  /** Applies an (optimistic or reconciled) `archivedAt` to the session identified by `sessionId`. */
  onArchived: (sessionId: string, archivedAt: string) => void;
  /** Rolls a failed archive back to the session's pre-archive state. */
  onArchiveFailed: (session: SessionSummary, message: string) => void;
  /** Removes `session` from the list (called optimistically, before the daemon confirms). */
  onDeleted: (session: SessionSummary) => void;
  /** Re-inserts `session` after a failed delete. */
  onDeleteFailed: (session: SessionSummary, message: string) => void;
}

export interface SessionActionsController {
  /** The id of the session currently being archived, if any (drives a row's "Archiving…" state). */
  archivingSessionId: string | null;
  /** Whether the delete-confirmation dialog is open. */
  deleteDialogOpen: boolean;
  /** The session the delete-confirmation dialog targets, if open. */
  deleteTarget: SessionSummary | null;
  deletePhase: DeleteSessionPhase;
  archive: (session: SessionSummary) => void;
  requestDelete: (session: SessionSummary) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
}

export function useSessionActions(options: UseSessionActionsOptions): SessionActionsController {
  const { client, onArchived, onArchiveFailed, onDeleted, onDeleteFailed } = options;

  const [archivingSessionId, setArchivingSessionId] = useState<string | null>(null);
  const archivingRef = useRef<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [deletePhase, setDeletePhase] = useState<DeleteSessionPhase>("idle");
  const deletingRef = useRef(false);

  const archive = useCallback(
    (session: SessionSummary): void => {
      if (session.archivedAt) return; // already archived: nothing to do
      if (archivingRef.current) return; // one archive in flight at a time

      archivingRef.current = session.id;
      setArchivingSessionId(session.id);

      // Optimistic: mark it archived right away with a client-side
      // timestamp, then reconcile with the daemon's real one (or roll
      // back entirely) once the round-trip settles.
      const optimisticAt = new Date().toISOString();
      onArchived(session.id, optimisticAt);

      const request = client.archiveSession
        ? client.archiveSession(session.id)
        : Promise.reject(new Error(SESSIONS_ACTION_UNSUPPORTED));

      request.then(
        (result) => {
          archivingRef.current = null;
          setArchivingSessionId(null);
          onArchived(session.id, result.archivedAt);
        },
        (error: unknown) => {
          archivingRef.current = null;
          setArchivingSessionId(null);
          onArchiveFailed(session, error instanceof Error ? error.message : String(error));
        },
      );
    },
    [client, onArchived, onArchiveFailed],
  );

  const requestDelete = useCallback((session: SessionSummary): void => {
    if (deletingRef.current) return; // never abandon an in-flight delete
    setDeleteTarget(session);
    setDeletePhase("idle");
  }, []);

  const cancelDelete = useCallback((): void => {
    if (deletingRef.current) return; // never abandon an in-flight delete
    setDeleteTarget(null);
  }, []);

  const confirmDelete = useCallback((): void => {
    if (deletingRef.current) return;
    const target = deleteTarget;
    if (!target) return;

    deletingRef.current = true;
    setDeletePhase("deleting");
    // Optimistic: the row disappears (and the dialog closes) the
    // instant the user confirms, before the daemon round-trip
    // resolves; a failure re-inserts it via `onDeleteFailed`.
    onDeleted(target);
    setDeleteTarget(null);

    const request = client.deleteSession
      ? client.deleteSession(target.id)
      : Promise.reject(new Error(SESSIONS_ACTION_UNSUPPORTED));

    request.then(
      () => {
        deletingRef.current = false;
        setDeletePhase("idle");
      },
      (error: unknown) => {
        deletingRef.current = false;
        setDeletePhase("idle");
        onDeleteFailed(target, error instanceof Error ? error.message : String(error));
      },
    );
  }, [client, deleteTarget, onDeleted, onDeleteFailed]);

  return {
    archivingSessionId,
    deleteDialogOpen: deleteTarget !== null,
    deleteTarget,
    deletePhase,
    archive,
    requestDelete,
    confirmDelete,
    cancelDelete,
  };
}
