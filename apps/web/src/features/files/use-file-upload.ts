/**
 * Upload state for the files feature (T30B4, plan.md §12.4). Owns
 * picking a local file (via the platform `FilePicker`, plan.md §7.3),
 * reading its bytes, and driving `FileUploadClient.uploadFile` — never a
 * direct filesystem access.
 *
 * "Failures are recoverable without losing the selection" (T30B4's
 * acceptance criterion): the picked file is kept in state across a
 * failed read or upload, so `retry()` re-reads and re-sends the same
 * selection without re-prompting the picker. Only picking a new file (or
 * an explicit `reset()`) clears it.
 *
 * Progress (T41A3): `FileUploadClient.uploadFile` (see that file's header
 * comment) is a single opaque `Promise` — the real `DaemonClient` sends
 * the file as a burst of binary WebSocket frames with no per-chunk
 * acknowledgement, so there is no hook here that could turn "uploading"
 * into an accurate percentage. Rather than fabricate one (a timer, a
 * fixed-rate fill), the "reading" and "uploading" states are themselves
 * the accurate signal — `FileUploadPanel` renders them with `Progress`'s
 * indeterminate mode (`value={null}`), which is honest about what this
 * layer can and cannot observe.
 *
 * Cancellation (T41A3 built the states; T163 shipped a real opcode; T165
 * wires this hook to send it): every `upload()`/`retry()` attempt is
 * tracked by a `run` object carrying its own `requestId`, generated here
 * (`createUploadRequestId`) and passed as `FileUploadInput.requestId` so
 * a later `cancel()` can name the exact upload to the daemon. While
 * still `"reading"` (before `client.uploadFile` has been called at all),
 * `cancel()` is a genuine no-partial-file guarantee that needs no wire
 * request at all — nothing has reached the daemon yet, so nothing here
 * calls `client.cancelUpload()`. Once `"uploading"` has started, the
 * real `DaemonClient` has already dispatched every binary frame
 * synchronously inside the single `client.uploadFile()` call (there is
 * no `await` between them), so every staged byte may already be sitting
 * with the daemon by the time a person clicks Cancel.
 *
 * CORRECTED (T165): earlier revisions of this comment (through the
 * P6-W17 merge gate) said "This hook does not send it yet" and that
 * `cancel()` "still only marks the run cancelled locally" — true then,
 * false now. `cancel()` called during `"uploading"` moves the status to
 * `"cancelling"` and calls `client.cancelUpload(run.requestId)`
 * (`DaemonClient.cancelUpload`, `packages/client/src/daemon-client.ts`),
 * then waits for the daemon's own answer before claiming anything:
 *
 * - `{ cancelled: true }` — the daemon discarded every staged byte
 *   (`FileUploadStore.cancelUpload`,
 *   `packages/server/src/server/file-upload/`) — status becomes
 *   `"cancelled"`, and that word now means exactly what it says.
 * - `{ cancelled: false }` — nothing was pending (the upload had
 *   already finished, or the id was never known) or the discard itself
 *   failed — status becomes `"cancel-failed"`, a distinct state from
 *   `"cancelled"` so the UI never claims a discard that did not happen.
 * - A rejected `cancelUpload()` call is treated the same as
 *   `{ cancelled: false }`. One that never settles at all simply leaves
 *   the UI on `"cancelling"` forever rather than ever advancing to
 *   `"cancelled"` on its own — either way, "cancelled" is never claimed
 *   without the daemon's confirmation.
 *
 * The user's intent to cancel is always registered immediately (the
 * button is never a no-op once `"reading"`/`"uploading"` has started);
 * the file's actual fate is a separate fact this hook now waits on
 * instead of assuming.
 *
 * All of the above was established by reading the server and protocol
 * source, per T41A3's instruction, not by opening a socket to a daemon.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { FilePicker, PickedFile } from "@picompanion/frontend-core";

import type {
  FileUploadAttachment,
  FileUploadClient,
  FileUploadResult,
} from "./file-upload-client.js";
import {
  explainFileUploadError,
  explainFileUploadResult,
  explainUploadCancelNotConfirmed,
  type FileUploadErrorExplanation,
} from "./file-upload-client.js";

export type FileUploadStatus =
  | "idle"
  | "reading"
  | "uploading"
  | "cancelling"
  | "success"
  | "error"
  | "cancelled"
  | "cancel-failed";

export interface FileUploadState {
  status: FileUploadStatus;
  /** The currently picked file, preserved across a failed read/upload for `retry()`. */
  selection: PickedFile | null;
  result: FileUploadAttachment | null;
  error: FileUploadErrorExplanation | null;
}

export interface UseFileUploadOptions {
  client: FileUploadClient;
  filePicker: FilePicker;
}

export interface FileUploadController {
  state: FileUploadState;
  /** Opens the platform file picker and stages the chosen file (does not upload it yet). */
  selectFile: () => void;
  /** Reads and uploads the current selection. No-op without one, or while already in flight. */
  upload: () => void;
  /** Re-runs `upload()` against the same selection after a failure. */
  retry: () => void;
  /** Clears the selection/result/error back to `"idle"`. */
  reset: () => void;
  /**
   * Cancels the current read/upload. No-op unless `state.status` is
   * `"reading"` or `"uploading"`. See the module doc comment for what
   * this can and cannot actually stop, and for the `"cancelling"` /
   * `"cancelled"` / `"cancel-failed"` states it can lead to.
   */
  cancel: () => void;
}

const IDLE_STATE: FileUploadState = { status: "idle", selection: null, result: null, error: null };

/** One in-flight `upload()`/`retry()` attempt. */
interface UploadRun {
  cancelled: boolean;
  /** Passed as `FileUploadInput.requestId` so `cancel()` can name this exact upload (T165). */
  requestId: string;
}

let uploadRequestSequence = 0;

/**
 * Generates a per-attempt id passed as `FileUploadInput.requestId` so a
 * later `cancel()` can tell `client.cancelUpload()` exactly which
 * in-flight upload to discard (T165). Purely a local correlation id —
 * the real `DaemonClient` only echoes it back and pairs it with the
 * binary frames sent alongside `uploadFile()`
 * (`packages/client/src/daemon-client.ts`); nothing here needs it to be
 * globally unique, only unique per hook instance across its own attempts.
 */
function createUploadRequestId(): string {
  uploadRequestSequence += 1;
  return `web-upload-${Date.now().toString(36)}-${uploadRequestSequence}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useFileUpload(options: UseFileUploadOptions): FileUploadController {
  const { client, filePicker } = options;
  const [state, setState] = useState<FileUploadState>(IDLE_STATE);
  // `upload`/`retry` always read the selection current at call time, not
  // one captured when the callback was created, without forcing every
  // caller through a stale-closure-prone `state` dependency.
  const selectionRef = useRef<PickedFile | null>(null);
  const activeRunRef = useRef<UploadRun | null>(null);
  // Mirrors `state.status` synchronously (React state updates are async),
  // so `cancel()` can gate on "is a request in flight right now" and a
  // pending `cancelUpload()` resolution can check "am I still the thing
  // the UI is waiting on" without either depending on stale closures.
  const statusRef = useRef<FileUploadStatus>(IDLE_STATE.status);
  const mountedRef = useRef(true);

  const applyState = useCallback((updater: (prev: FileUploadState) => FileUploadState) => {
    setState((prev) => {
      const next = updater(prev);
      statusRef.current = next.status;
      return next;
    });
  }, []);

  // T41A3: an upload in flight when this component unmounts must not
  // apply a late read/upload result to a tree that no longer exists.
  useEffect(
    () => () => {
      mountedRef.current = false;
      if (activeRunRef.current) activeRunRef.current.cancelled = true;
    },
    [],
  );

  const selectFile = useCallback(() => {
    filePicker
      .pickFiles({ multiple: false })
      .then((files) => {
        const picked = files[0];
        if (!picked) return;
        selectionRef.current = picked;
        applyState(() => ({ status: "idle", selection: picked, result: null, error: null }));
      })
      .catch(() => {
        // A picker rejection (permission denial, unsupported environment)
        // is not this file's fault — nothing was selected, so there is
        // nothing to explain as an upload failure.
      });
  }, [filePicker, applyState]);

  const runUpload = useCallback(() => {
    const selection = selectionRef.current;
    if (!selection) return;

    applyState((prev) =>
      prev.status === "reading" || prev.status === "uploading"
        ? prev
        : { ...prev, status: "reading", error: null },
    );

    const thisRun: UploadRun = { cancelled: false, requestId: createUploadRequestId() };
    activeRunRef.current = thisRun;

    void (async () => {
      let bytes: Uint8Array;
      try {
        bytes = await selection.readAsBytes();
      } catch (error) {
        if (thisRun.cancelled) return;
        const raw = error instanceof Error ? error.message : String(error);
        applyState((prev) => ({ ...prev, status: "error", error: explainFileUploadError(raw) }));
        return;
      }

      // T41A3: cancelled while reading — `client.uploadFile` is never
      // called, so no byte of this file reaches the daemon.
      if (thisRun.cancelled) return;

      applyState((prev) => ({ ...prev, status: "uploading" }));

      let result: FileUploadResult;
      try {
        result = await client.uploadFile({
          fileName: selection.name,
          mimeType: selection.mimeType ?? "application/octet-stream",
          bytes,
          requestId: thisRun.requestId,
        });
      } catch (error) {
        // Cancelled while awaiting the daemon's response. If `cancel()`
        // already took over (status moved to "cancelling"/"cancelled"/
        // "cancel-failed"), this must not replace that with a stale
        // error — the real client had already sent every byte before
        // this promise could even be awaited (see module doc comment).
        if (thisRun.cancelled) return;
        const raw = error instanceof Error ? error.message : String(error);
        applyState((prev) => ({ ...prev, status: "error", error: explainFileUploadError(raw) }));
        return;
      }

      // Same caveat as the catch above: cancelling here discards a
      // result the daemon may already have staged in full — `cancel()`'s
      // own confirmation flow, not this result, decides the final state.
      if (thisRun.cancelled) return;

      const explanation = explainFileUploadResult(result);
      if (explanation || !result.file) {
        applyState((prev) => ({
          ...prev,
          status: "error",
          error: explanation ?? {
            title: "Couldn't upload this file",
            description: "The daemon returned an unknown error.",
          },
        }));
        return;
      }
      applyState((prev) => ({ ...prev, status: "success", result: result.file, error: null }));
    })();
  }, [client, applyState]);

  const upload = useCallback(() => {
    runUpload();
  }, [runUpload]);

  const retry = useCallback(() => {
    runUpload();
  }, [runUpload]);

  const reset = useCallback(() => {
    if (activeRunRef.current) activeRunRef.current.cancelled = true;
    selectionRef.current = null;
    applyState(() => IDLE_STATE);
  }, [applyState]);

  const cancel = useCallback(() => {
    const status = statusRef.current;
    if (status !== "reading" && status !== "uploading") return;

    const run = activeRunRef.current;
    // Discards whatever this run's own `readAsBytes()`/`uploadFile()`
    // continuation later resolves with — from here on, only `cancel()`'s
    // own flow below (or nothing, while still "reading") decides the
    // final state.
    if (run) run.cancelled = true;

    if (status === "reading") {
      // T165: nothing has reached the daemon yet — no cancel opcode is
      // sent, and there is nothing for the daemon to confirm.
      applyState((prev) => ({ ...prev, status: "cancelled", error: null }));
      return;
    }

    // status === "uploading": every byte may already be staged with the
    // daemon. Only its own confirmation can say whether it discarded
    // them, so the UI moves to a transient state rather than claiming
    // "cancelled" on the spot.
    applyState((prev) => ({ ...prev, status: "cancelling", error: null }));
    if (!run) return;

    void client.cancelUpload(run.requestId).then(
      (result) => {
        // Ignore a stale answer: `reset()`/a new `upload()` since this
        // request was sent, or this component having unmounted.
        if (!mountedRef.current || statusRef.current !== "cancelling") return;
        if (result.cancelled) {
          applyState((prev) => ({ ...prev, status: "cancelled", error: null }));
        } else {
          applyState((prev) => ({
            ...prev,
            status: "cancel-failed",
            error: explainUploadCancelNotConfirmed(result.error),
          }));
        }
      },
      (error: unknown) => {
        if (!mountedRef.current || statusRef.current !== "cancelling") return;
        const raw = error instanceof Error ? error.message : String(error);
        applyState((prev) => ({
          ...prev,
          status: "cancel-failed",
          error: explainUploadCancelNotConfirmed(raw),
        }));
      },
    );
  }, [client, applyState]);

  return { state, selectFile, upload, retry, reset, cancel };
}
