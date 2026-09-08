/**
 * File upload state and orchestration (T35A4, plan.md §6/§7/§9/§12.4,
 * depends on T35A3).
 *
 * Sibling of `file-edit-model.ts`'s save controller: same shape
 * (`getState`/`subscribe`, a `Clock`-raced timeout, one named state per
 * distinct failure) but for picking and sending a local file rather
 * than editing one already open. This module imports neither React,
 * React Native, Expo, DOM types, nor browser globals — plain, RN-free
 * orchestration over the injected `FileBrowserClient.uploadFile`
 * (`file-browser-client.ts`) and `@picompanion/frontend-core`'s
 * platform-neutral `FilePicker`, testable directly in this workspace's
 * plain `vitest`.
 *
 * No wire shape is invented here: `uploadFile` matches
 * `DaemonClient.uploadFile(input)` (`packages/client/src/
 * daemon-client.ts`) exactly, and this controller's state machine,
 * sentinels, and error vocabulary are the RN-free port of web's
 * `use-file-upload.ts` (`apps/web/src/features/files/
 * use-file-upload.ts`) — see `file-browser-client.ts`'s "File upload
 * (T35A4)" section for why the daemon's upload RPC stages a generic
 * attachment rather than writing into the browsed workspace folder.
 *
 * ---------------------------------------------------------------------
 * Progress (this task's real content, upload half)
 * ---------------------------------------------------------------------
 * `DaemonClient.uploadFile` sends a file's bytes as a fixed sequence of
 * binary WebSocket frames in one synchronous loop and returns a single
 * promise that settles only once the daemon's final `file.upload.
 * response` arrives — there is no per-chunk acknowledgement, event, or
 * callback anywhere on that method or the wire messages it uses
 * (`packages/protocol/src/messages.ts`'s `FileUploadRequestSchema`/
 * `FileUploadResponseSchema` carry no partial-progress variant). Web's
 * own `use-file-upload.ts` reflects exactly this: no percentage, just
 * `"reading"`/`"uploading"`/`"success"`/`"error"`. This controller keeps
 * that honesty rather than inventing a signal the protocol doesn't
 * have: `state.progress` stays `null` (indeterminate) for the entire
 * `"uploading"` status and is set to exactly `1` only once `"success"`
 * is reached — never a synthetic percentage climbing in between, and
 * never `1` on any failure, cancellation, or refusal path (see this
 * file's tests for the assertion that proves that).
 *
 * ---------------------------------------------------------------------
 * Bound and cancellation (this task's real content, the rest of it)
 * ---------------------------------------------------------------------
 * `MAX_UPLOAD_BYTES` is checked *before* any transfer begins: first
 * against `PickedFile.size` the instant a file is picked, if the picker
 * already knows it (no `readAsBytes()` call, no RPC); otherwise against
 * the actually-read byte length once `readAsBytes()` resolves, but
 * still strictly before `client.uploadFile` is ever called. Either path
 * lands in the same named `"refused"` state.
 *
 * `cancel()` is a real interleaving, not just a before/after guard: it
 * bumps this controller's internal generation counter and immediately
 * moves to `"cancelled"`, so a `client.uploadFile` promise that later
 * resolves (successfully or not) against the *previous* generation is
 * silently dropped — the state never flips back to `"success"` out from
 * under a cancellation, which is what "a partially-transferred file is
 * never presented as complete" means for upload (see
 * `file-upload-model.test.ts`'s in-flight-cancel case, which resolves
 * the underlying promise *after* calling `cancel()` to prove exactly
 * that ordering). `retry()` re-runs the same preserved selection from
 * scratch — it never appends to or resumes a prior attempt, so a retry
 * after a cancelled or failed upload cannot duplicate.
 */
import type { Clock, FilePicker, PickedFile } from "@picompanion/frontend-core";

import {
  FILE_PICKER_PERMISSION_DENIED,
  FILE_PICKER_PERMISSION_DENIED_PERMANENTLY,
  FILE_PICKER_UNAVAILABLE,
  FILE_PICKER_UNSUPPORTED_TYPE,
} from "../../platform/file-picker.js";
import {
  FILE_UPLOAD_CANCELLED,
  FILE_UPLOAD_NOT_CONNECTED,
  FILE_UPLOAD_TIMEOUT,
  MAX_UPLOAD_BYTES,
  explainFileUploadError,
  explainFileUploadResult,
  explainOversizedUpload,
  type FileBrowserClient,
  type FileBrowserErrorExplanation,
  type FileUploadAttachment,
  type FileUploadResult,
} from "./file-browser-client.js";
import { createFilesClock } from "./files-model.js";

export type {
  FileUploadAttachment,
  FileUploadInput,
  FileUploadResult,
} from "./file-browser-client.js";

export type FileUploadStatus =
  | "idle"
  | "reading"
  | "uploading"
  | "success"
  | "error"
  | "cancelled"
  | "refused";

export interface FileUploadState {
  readonly status: FileUploadStatus;
  /** The currently picked file, preserved across a failed read/upload/cancel for `retry()`. */
  readonly selection: PickedFile | null;
  /** `null` while indeterminate (the entire `"uploading"` status — see module doc), exactly `1` once `"success"`. Never set on any other status. */
  readonly progress: number | null;
  readonly result: FileUploadAttachment | null;
  readonly error: FileBrowserErrorExplanation | null;
  readonly refusal: FileBrowserErrorExplanation | null;
}

const IDLE_STATE: FileUploadState = {
  status: "idle",
  selection: null,
  progress: null,
  result: null,
  error: null,
  refusal: null,
};

export const DEFAULT_FILE_UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Maps a `FilePicker.pickFiles()` rejection's `Error.message` to a
 * title/description `UploadPanel`'s existing `"refused"` banner already
 * renders (T78, plan.md §7.3/§9). Every rejection `../../platform/
 * file-picker.ts`'s real Android `FilePicker` can produce is a named
 * sentinel — see that module's doc comment's "Refusal vocabulary"
 * section — never a plain user cancellation (cancellation there
 * resolves `[]`, matching `selectFile()`'s own `if (!picked) return;`
 * no-op path just above this function's one call site), so treating
 * every rejection as a visible refusal never misreports an ordinary
 * dismissed picker as an error.
 *
 * Before T78, `selectFile()`'s `.catch()` discarded this value entirely
 * — a denied permission or `createUnavailableFilePicker()`'s always-
 * unavailable production stub (see that factory's own doc comment; still
 * the field's real value today — `createAndroidFilePicker` needs a
 * router-root wiring T32S11 owns, not done by T290's `expo-image-picker`/
 * `expo-document-picker` install) made the "Choose file" button look
 * inert, with no explanation anywhere.
 * `explainOversizedUpload` above is this function's sibling for the
 * other `"refused"`-status trigger (a bound checked after a file *is*
 * picked, not before).
 *
 * An unrecognized message (a genuinely unexpected rejection, or a
 * platform `FilePicker` — such as web's, which never rejects at all —
 * with no sentinel vocabulary of its own) still gets a generic, honest
 * explanation from the message text itself rather than being dropped,
 * matching `explainFileUploadError`'s own unrecognized-message fallback
 * below.
 */
export function explainFilePickerRefusal(message: string): FileBrowserErrorExplanation {
  const trimmed = message.trim();
  switch (trimmed) {
    case FILE_PICKER_PERMISSION_DENIED:
      return {
        title: "Photo and file access denied",
        description: "Allow photo and file access to attach a file, then try again.",
      };
    case FILE_PICKER_PERMISSION_DENIED_PERMANENTLY:
      return {
        title: "Photo and file access blocked",
        description:
          "Photo and file access is blocked. Enable it in system settings to attach a file.",
      };
    case FILE_PICKER_UNAVAILABLE:
      return {
        title: "File picking isn't available",
        description: "This build can't open a file picker yet.",
      };
    case FILE_PICKER_UNSUPPORTED_TYPE:
      return {
        title: "Unsupported file type",
        description: "One of the selected files doesn't match what this upload accepts.",
      };
    default:
      return {
        title: "Couldn't open the file picker",
        description: trimmed.length > 0 ? trimmed : "Something went wrong opening the file picker.",
      };
  }
}

/**
 * Races `client.uploadFile(input)` against `clock`'s timer, exactly
 * like `file-edit-model.ts`'s `writeFileWithTimeout`. Rejects with
 * `FILE_UPLOAD_NOT_CONNECTED` when the client has no `uploadFile` at
 * all, or `FILE_UPLOAD_TIMEOUT` if the timer fires first.
 */
export function uploadFileWithTimeout(
  client: FileBrowserClient,
  input: { fileName: string; mimeType: string; bytes: Uint8Array; modifiedAt?: string },
  clock: Clock,
  timeoutMs: number = DEFAULT_FILE_UPLOAD_TIMEOUT_MS,
): Promise<FileUploadResult> {
  return new Promise((resolve, reject) => {
    const uploadFile = client.uploadFile;
    if (!uploadFile) {
      reject(new Error(FILE_UPLOAD_NOT_CONNECTED));
      return;
    }

    let settled = false;
    const timer = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(FILE_UPLOAD_TIMEOUT));
    }, timeoutMs);

    uploadFile(input).then(
      (result) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export interface FileUploadControllerOptions {
  client: FileBrowserClient;
  filePicker: FilePicker;
  clock?: Clock;
  timeoutMs?: number;
}

export interface FileUploadController {
  getState: () => FileUploadState;
  subscribe: (listener: (state: FileUploadState) => void) => () => void;
  /** Opens the platform file picker and stages the chosen file. Does not upload it, and does not itself check the size bound (see `upload()`). */
  selectFile: () => void;
  /** Reads and uploads the current selection. No-op without one, or while a read/upload is already in flight. */
  upload: () => void;
  /** Re-runs `upload()` against the same preserved selection after a failure, cancellation, or refusal. */
  retry: () => void;
  /** Cancels an in-flight read or upload. No-op once already settled (`"success"`/`"error"`/`"refused"`) or idle. */
  cancel: () => void;
  /** Clears the selection/result/error back to `"idle"`. */
  reset: () => void;
}

/**
 * Builds a `FileUploadController` — the injected-fake-daemon-RPC and
 * -file-picker seam `file-upload-model.test.ts` drives directly to
 * prove the read→upload round trip, monotonic/indeterminate progress,
 * every recoverable failure, the pre-flight size bound, and the
 * in-flight cancellation interleaving, with no emulator and no
 * `react-native` import.
 */
export function createFileUploadController(
  options: FileUploadControllerOptions,
): FileUploadController {
  const { client, filePicker } = options;
  const clock = options.clock ?? createFilesClock();
  const timeoutMs = options.timeoutMs ?? DEFAULT_FILE_UPLOAD_TIMEOUT_MS;

  let state: FileUploadState = IDLE_STATE;
  let generation = 0;
  const listeners = new Set<(state: FileUploadState) => void>();

  const emit = () => {
    for (const listener of listeners) listener(state);
  };

  const setState = (next: FileUploadState) => {
    state = next;
    emit();
  };

  const runUpload = () => {
    const selection = state.selection;
    if (!selection) return;
    if (state.status === "reading" || state.status === "uploading") return;

    const thisGeneration = ++generation;
    setState({ ...state, status: "reading", progress: null, error: null, refusal: null });

    // Pre-flight bound: refuse before ever reading bytes into memory
    // when the picker already told us the size.
    if (typeof selection.size === "number" && selection.size > MAX_UPLOAD_BYTES) {
      setState({
        ...state,
        status: "refused",
        progress: null,
        refusal: explainOversizedUpload(selection.size),
      });
      return;
    }

    selection
      .readAsBytes()
      .then((bytes) => {
        if (thisGeneration !== generation) return; // superseded by cancel()

        // Pre-flight bound, unknown-size path: still strictly before
        // `client.uploadFile` — the transfer itself — is ever called.
        if (bytes.byteLength > MAX_UPLOAD_BYTES) {
          setState({
            ...state,
            status: "refused",
            progress: null,
            refusal: explainOversizedUpload(bytes.byteLength),
          });
          return;
        }

        setState({ ...state, status: "uploading", progress: null });

        uploadFileWithTimeout(
          client,
          {
            fileName: selection.name,
            mimeType: selection.mimeType ?? "application/octet-stream",
            bytes,
          },
          clock,
          timeoutMs,
        ).then(
          (result) => {
            if (thisGeneration !== generation) return; // superseded by cancel()
            const explanation = explainFileUploadResult(result);
            if (explanation || !result.file) {
              setState({
                ...state,
                status: "error",
                progress: null,
                error: explanation ?? {
                  title: "Couldn't upload this file",
                  description: "The daemon returned an unknown error.",
                },
              });
              return;
            }
            setState({
              ...state,
              status: "success",
              progress: 1,
              result: result.file,
              error: null,
            });
          },
          (error: unknown) => {
            if (thisGeneration !== generation) return; // superseded by cancel()
            const raw = error instanceof Error ? error.message : String(error);
            setState({
              ...state,
              status: "error",
              progress: null,
              error: explainFileUploadError(raw),
            });
          },
        );
      })
      .catch((error: unknown) => {
        if (thisGeneration !== generation) return;
        const raw = error instanceof Error ? error.message : String(error);
        setState({ ...state, status: "error", progress: null, error: explainFileUploadError(raw) });
      });
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    selectFile: () => {
      filePicker
        .pickFiles({ multiple: false })
        .then((files) => {
          const picked = files[0];
          if (!picked) return;
          generation += 1; // any prior in-flight operation is abandoned by picking again
          setState({
            status: "idle",
            selection: picked,
            progress: null,
            result: null,
            error: null,
            refusal: null,
          });
        })
        .catch((error: unknown) => {
          // T78: a picker rejection is now a named, visible refusal —
          // see `explainFilePickerRefusal`'s doc comment for why this
          // used to be a silent no-op and why that stopped being safe
          // once a real (honestly-unavailable) production `FilePicker`
          // was actually mounted. The prior selection, if any, is kept
          // (`retry()` can still re-run it), matching every other
          // refusal path in this controller.
          const raw = error instanceof Error ? error.message : String(error);
          setState({
            ...state,
            status: "refused",
            progress: null,
            refusal: explainFilePickerRefusal(raw),
          });
        });
    },
    upload: () => runUpload(),
    retry: () => runUpload(),
    cancel: () => {
      if (state.status !== "reading" && state.status !== "uploading") return;
      generation += 1; // any settlement of the in-flight promise(s) above is now stale and ignored
      setState({
        ...state,
        status: "cancelled",
        progress: null,
        error: null,
        refusal: null,
        result: null,
      });
    },
    reset: () => {
      generation += 1;
      setState(IDLE_STATE);
    },
  };
}

/** Re-exported so a caller can name the sentinel `cancel()` conceptually maps to without reaching into `file-browser-client.ts` directly. Never actually sent to or received from the daemon — see that constant's own doc. */
export { FILE_UPLOAD_CANCELLED };
