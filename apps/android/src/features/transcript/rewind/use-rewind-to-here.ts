/**
 * The Android "Rewind to here" call site — T395, `plan.md` §4.2 ("Workspace
 * checkpoint snapshots").
 *
 * The web surface (`apps/web/src/features/transcript/rewind/use-rewind-to-here.ts`)
 * and this one drive the same `frontend-core` `RewindController` and keep
 * the same state; they are separate modules because the two apps share no
 * code. This hook owns the state the sheet draws — which message is being
 * rewound, which scope is selected, the outcome being shown, and this app
 * session's own undone-turns record — and `rewind-sheet-model.ts` turns
 * that state into the sheet's exact contents, so this file holds no copy or
 * gate logic of its own that a test could not call.
 *
 * ## The conflict answer is explicit, never automatic
 *
 * A `conflict` outcome means the work tree moved under the snapshot and the
 * daemon refused to overwrite it. This hook never re-issues on its own: it
 * parks the outcome and exposes `restoreAnyway()`, which `RewindSheet.tsx`
 * wires to a distinct "Restore anyway" action, so the user makes that
 * choice. The `force: true` re-issue is a second, explicit request through
 * the same controller.
 *
 * ## The undone list is local, and says so
 *
 * `undoneTurns` records each successful rewind's target (`messageId`,
 * snippet, mode) in memory for `sessionId`. It is not daemon state, is not
 * persisted across a process restart, and is reset when the session
 * changes. `returnToTurn` re-issues a `"conversation"` rewind through the
 * same controller, because a files restore is a restore to an earlier
 * snapshot and cannot be replayed forward.
 *
 * This module may import React and the shared domain package; it must not
 * import `react-native` (so its logic stays callable in a plain test) and
 * must not import Expo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rewind, timeline } from "@picompanion/frontend-core";

import { addUndoneTurn, buildUndoneTurn, snippetFor } from "./undone-turns";
import type { UndoneTurn } from "./undone-turns";
import type { RewindDialogState, RewindTarget } from "./rewind-sheet-model";
import type { RewindMode } from "./rewind-scopes";

export interface RewindToHereOptions {
  /** The open session; changing it resets the local record and the sheet. */
  sessionId: string;
  /** The live transcript entries the target is resolved from. */
  entries: readonly timeline.TranscriptEntry[];
  /** The `DaemonClient` (structurally a `rewind.RewindClientPort`), or `null` while disconnected. */
  client?: rewind.RewindClientPort | null;
  /** `true` while a turn is in flight; disables the primary action and is explained in the sheet. */
  turnRunning?: boolean;
  /** Called after a successful rewind, for the caller to refresh the transcript. */
  onRewound?: () => void;
}

export interface RewindToHereController {
  /** Opens the sheet for the user-message entry `entryId`, if it has a daemon id to target. */
  readonly requestRewind: (entryId: string) => void;
  readonly close: () => void;
  readonly selectMode: (mode: RewindMode) => void;
  /** Sends the selected scope. No-op while submitting, mid-turn, or not connected. */
  readonly submit: () => void;
  /** Re-issues the same request with `force: true` after a conflict. */
  readonly restoreAnyway: () => void;
  /** Re-rewinds the conversation to a recorded turn through the same controller. */
  readonly returnToTurn: (turn: UndoneTurn) => void;
  readonly dialog: RewindDialogState;
  /** Whether a daemon connection is available to rewind at all. */
  readonly enabled: boolean;
}

export function useRewindToHere(options: RewindToHereOptions): RewindToHereController {
  const { sessionId, entries, client, turnRunning = false, onRewound } = options;

  const controller = useMemo(() => (client ? new rewind.RewindController(client) : null), [client]);

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<RewindTarget | null>(null);
  const [mode, setMode] = useState<RewindMode>("conversation");
  const [status, setStatus] = useState<RewindDialogState["status"]>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [undoneTurns, setUndoneTurns] = useState<readonly UndoneTurn[]>([]);
  // Guards a response that resolves after the sheet closed, the session
  // changed, or a newer request started from overwriting fresher state.
  const runRef = useRef(0);
  const onRewoundRef = useRef(onRewound);
  onRewoundRef.current = onRewound;

  useEffect(() => {
    runRef.current += 1;
    setOpen(false);
    setTarget(null);
    setMode("conversation");
    setStatus("idle");
    setMessage(null);
    setUndoneTurns([]);
  }, [sessionId]);

  const requestRewind = useCallback(
    (entryId: string) => {
      const entry = entries.find((candidate) => candidate.id === entryId);
      if (!entry || entry.kind !== "user-message") {
        return;
      }
      const messageId = entry.messageId ?? entry.clientMessageId;
      if (!messageId) {
        return;
      }
      setTarget({ messageId, snippet: snippetFor(entry.text) });
      setMode("conversation");
      setStatus("idle");
      setMessage(null);
      setOpen(true);
    },
    [entries],
  );

  const performRewind = useCallback(
    (nextTarget: RewindTarget, nextMode: RewindMode, force: boolean) => {
      if (!controller) {
        setStatus("failed");
        setMessage("Not connected to the daemon.");
        setOpen(true);
        return;
      }
      const run = runRef.current + 1;
      runRef.current = run;
      setStatus("submitting");
      setMessage(null);
      void controller
        .rewind({
          agentId: sessionId,
          messageId: nextTarget.messageId,
          mode: nextMode,
          ...(force ? { force: true } : {}),
        })
        .then((outcome) => {
          if (runRef.current !== run) return;
          if (outcome.status === "success") {
            setStatus("success");
            setMessage(null);
            setUndoneTurns((current) =>
              addUndoneTurn(current, buildUndoneTurn(nextTarget, nextMode)),
            );
            onRewoundRef.current?.();
            return;
          }
          setStatus(outcome.status);
          setMessage(outcome.message);
        })
        .catch((error: unknown) => {
          if (runRef.current !== run) return;
          setStatus("failed");
          setMessage(error instanceof Error ? error.message : "Failed to rewind agent");
        });
    },
    [controller, sessionId],
  );

  const close = useCallback(() => {
    runRef.current += 1;
    setOpen(false);
    setStatus("idle");
    setMessage(null);
    setTarget(null);
  }, []);

  const selectMode = useCallback((nextMode: RewindMode) => {
    setMode(nextMode);
    setStatus("idle");
    setMessage(null);
  }, []);

  const submit = useCallback(() => {
    if (!target || !controller || turnRunning || status === "submitting") return;
    performRewind(target, mode, false);
  }, [controller, mode, performRewind, status, target, turnRunning]);

  const restoreAnyway = useCallback(() => {
    if (!target || !controller || status === "submitting") return;
    performRewind(target, mode, true);
  }, [controller, mode, performRewind, status, target]);

  const returnToTurn = useCallback(
    (turn: UndoneTurn) => {
      const nextTarget: RewindTarget = { messageId: turn.messageId, snippet: turn.snippet };
      setTarget(nextTarget);
      setMode("conversation");
      setStatus("idle");
      setMessage(null);
      setOpen(true);
      performRewind(nextTarget, "conversation", false);
    },
    [performRewind],
  );

  const dialog = useMemo<RewindDialogState>(
    () => ({
      open,
      target,
      mode,
      status,
      message,
      turnRunning,
      connected: controller !== null,
      undoneTurns,
    }),
    [controller, message, mode, open, status, target, turnRunning, undoneTurns],
  );

  return {
    requestRewind,
    close,
    selectMode,
    submit,
    restoreAnyway,
    returnToTurn,
    dialog,
    enabled: controller !== null,
  };
}
