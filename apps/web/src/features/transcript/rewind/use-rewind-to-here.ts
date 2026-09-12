/**
 * The web "Rewind to here" call site — T395, `plan.md` §4.2 ("Workspace
 * checkpoint snapshots").
 *
 * `packages/frontend-core/src/rewind/` was shipped as the platform-neutral
 * half: `RewindController` drives `DaemonClient.rewindAgent` and folds the
 * daemon's answer into the typed `RewindOutcome` (`success` /
 * `unsupported` / `conflict` / `failed`). This hook is the web call site —
 * the one place `apps/web` actually invokes it — and owns the state a
 * dialog needs: which message is being rewound, which of the three scopes
 * is selected, the outcome currently being shown, and the local
 * undone-turns record (`undone-turns.ts`).
 *
 * ## The conflict answer is explicit, never automatic
 *
 * A `conflict` outcome means the work tree moved under the snapshot and the
 * daemon refused to overwrite it (`plan.md` §4.2, "A conflict refuses
 * unless `force` is set"). This hook never re-issues on its own: it parks
 * the outcome and exposes `restoreAnyway()`, which the dialog wires to a
 * distinct "Restore anyway" button so the user makes that choice. The
 * `force: true` re-issue is a second, explicit request through the same
 * `RewindController`.
 *
 * ## Running turns are gated, not failed
 *
 * The daemon cancels an in-flight run before a rewind, but `agent-manager`'s
 * rewind path is still documented to refuse a restore mid-turn. The caller
 * supplies `turnRunning`; while it is `true`, `canSubmit` is `false` and
 * the dialog says so instead of sending a request the daemon would reject.
 *
 * ## The undone list is local, and says so
 *
 * `undoneTurns` records each successful rewind's target (`messageId`,
 * snippet, mode) in memory for `sessionId`. It is not daemon state, is not
 * persisted across a reload, and is reset when the session changes; the
 * dialog renders it under that exact label. `returnToTurn` re-issues a
 * `"conversation"` rewind through the same controller, because a files
 * restore is a restore to an earlier snapshot and cannot be replayed
 * forward.
 *
 * Repository invariant: this module lives under `apps/web` and may use
 * React, but it must not import DOM APIs directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rewind, timeline } from "@picompanion/frontend-core";

import type { RewindMode } from "./rewind-scopes.js";
import { addUndoneTurn, buildUndoneTurn, snippetFor } from "./undone-turns.js";
import type { UndoneTurn } from "./undone-turns.js";

/** The dialog's current phase. `idle` is "nothing sent yet". */
export type RewindStatus =
  | "idle"
  | "submitting"
  | "conflict"
  | "unsupported"
  | "failed"
  | "success";

/** The message a rewind is aimed at, with its list/heading snippet. */
export interface RewindTarget {
  /** The id sent on the wire (`entry.messageId ?? entry.clientMessageId`). */
  readonly messageId: string;
  readonly snippet: string;
}

export interface RewindToHereOptions {
  /** The open session; changing it resets the local record and the dialog. */
  sessionId: string;
  /** The live transcript entries the target is resolved from. */
  entries: readonly timeline.TranscriptEntry[];
  /** The `DaemonClient` (structurally a `rewind.RewindClientPort`), or `null` while disconnected. */
  client?: rewind.RewindClientPort | null;
  /** `true` while a turn is in flight; disables submit and is explained in the dialog. */
  turnRunning?: boolean;
  /** Called after a successful rewind, for the caller to refresh the transcript. */
  onRewound?: () => void;
}

export interface RewindDialogModel {
  readonly open: boolean;
  readonly target: RewindTarget | null;
  readonly mode: RewindMode;
  readonly status: RewindStatus;
  /** The daemon's sentence for `conflict`/`unsupported`/`failed`, marker already stripped. */
  readonly message: string | null;
  readonly turnRunning: boolean;
  readonly connected: boolean;
  readonly canSubmit: boolean;
  /** Local record of this browser session's rewinds — never daemon state. */
  readonly undoneTurns: readonly UndoneTurn[];
}

export interface RewindToHereController {
  /** Opens the dialog for the user-message entry `entryId`, if it has a daemon id to target. */
  readonly requestRewind: (entryId: string) => void;
  readonly close: () => void;
  readonly selectMode: (mode: RewindMode) => void;
  /** Sends the selected scope. No-op while submitting, mid-turn, or not connected. */
  readonly submit: () => void;
  /** Re-issues the same request with `force: true` after a conflict. */
  readonly restoreAnyway: () => void;
  /** Re-rewinds the conversation to a recorded turn through the same controller. */
  readonly returnToTurn: (turn: UndoneTurn) => void;
  readonly dialog: RewindDialogModel;
  /** Whether a daemon connection is available to rewind at all. */
  readonly enabled: boolean;
}

export function useRewindToHere(options: RewindToHereOptions): RewindToHereController {
  const { sessionId, entries, client, turnRunning = false, onRewound } = options;

  const controller = useMemo(() => (client ? new rewind.RewindController(client) : null), [client]);

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<RewindTarget | null>(null);
  const [mode, setMode] = useState<RewindMode>("conversation");
  const [status, setStatus] = useState<RewindStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [undoneTurns, setUndoneTurns] = useState<readonly UndoneTurn[]>([]);
  // Guards a response that resolves after the dialog closed, the session
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

  const dialog = useMemo<RewindDialogModel>(
    () => ({
      open,
      target,
      mode,
      status,
      message,
      turnRunning,
      connected: controller !== null,
      canSubmit: controller !== null && !turnRunning && status !== "submitting",
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
