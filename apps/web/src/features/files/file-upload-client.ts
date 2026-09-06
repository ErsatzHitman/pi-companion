/**
 * File upload wire shapes and client contract (T30B4, plan.md §12.4).
 *
 * Shaped to match `@picompanion/client`'s `DaemonClient.uploadFile(input)`
 * (see `packages/client/src/daemon-client.ts`) and the
 * `file.upload.request`/`file.upload.response` wire messages (see
 * `packages/protocol/src/messages.ts`'s `FileUploadResponseSchema`). A
 * real `DaemonClient` already satisfies `FileUploadClient` structurally;
 * nothing here needs to import `@picompanion/client` to stay in sync
 * with it. Kept as its own interface, mirroring why `FileWriteClient` is
 * separate from `FileReadClient`: every test double built against this
 * narrow shape keeps compiling once a real wiring task passes the same
 * `DaemonClient` instance as every file-feature client prop at once.
 *
 * Important asymmetry from `FileWriteClient`/`FileReadClient`: the
 * daemon's upload RPC (`FileUploadRequestSchema`,
 * `packages/protocol/src/messages.ts`) takes no `cwd`/`path` — it stages
 * the file under the daemon's own upload directory
 * (`packages/server/src/server/file-upload/index.ts`) as a generic
 * `uploaded_file` attachment (consumed by
 * `packages/server/src/server/agent/prompt-attachments.ts` for prompt
 * attachments), not by writing it into the currently browsed workspace
 * folder. There is no daemon RPC that uploads a file into an arbitrary
 * workspace path — `FileBrowserView`'s upload affordance is worded to
 * make that plain rather than implying the file lands in the folder
 * being browsed.
 *
 * The daemon's upload RPC does not reject for a business-level failure
 * (oversized file, a size mismatch between the declared and received
 * byte count) — it resolves with `{ file: null, error: "..." }` rather
 * than throwing (see `FileUploadStore` in
 * `packages/server/src/server/file-upload/index.ts`). `uploadFile`
 * below only *rejects* for a transport-level failure (not connected,
 * socket drop); `explainFileUploadResult` covers the resolved,
 * not-uploaded outcome and `explainFileUploadError` covers the rejected
 * ones.
 *
 * `cancelUpload` (T163, wired by T165's `use-file-upload.ts`) is the same
 * shape of asymmetry: a real `DaemonClient` already implements it
 * structurally, and `explainUploadCancelNotConfirmed` below covers the
 * one outcome that is never a confirmed discard — `cancelled: false`, a
 * rejection, or no answer at all.
 */

/** Mirrors the daemon's `UploadedFileAttachmentSchema` (`packages/protocol/src/messages.ts`). */
export interface FileUploadAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  /** The daemon-side staging path this upload was written to (not a workspace-relative path). */
  readonly path: string;
}

/** Mirrors the daemon's `FileUploadResponseSchema.payload` shape. */
export interface FileUploadResult {
  readonly file: FileUploadAttachment | null;
  readonly error: string | null;
}

export interface FileUploadInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly modifiedAt?: string;
  readonly requestId?: string;
}

/**
 * Mirrors `DaemonClient.cancelUpload`'s resolved shape
 * (`FileUploadCancelResult` in `packages/client/src/daemon-client.ts`,
 * itself `FileUploadCancelResponseSchema.payload` in
 * `packages/protocol/src/messages.ts`) — narrowed to the two fields this
 * feature actually reads. `cancelled: true` is sent only once the daemon
 * has discarded every staged byte for the named upload
 * (`FileUploadStore.cancelUpload`,
 * `packages/server/src/server/file-upload/`); `cancelled: false` covers
 * both "nothing was pending" (already finished, or the id was never
 * known) and any discard failure, with `error` explaining which.
 */
export interface FileUploadCancelResult {
  readonly cancelled: boolean;
  readonly error: string | null;
}

export interface FileUploadClient {
  /**
   * Uploads a file's full bytes as a staged daemon attachment. Resolves
   * with the outcome — including a server-side guard failure
   * (`{ file: null, error }`) — rather than rejecting for that; only
   * rejects for a transport-level failure.
   */
  uploadFile(input: FileUploadInput): Promise<FileUploadResult>;
  /**
   * T165: cancels the in-flight upload that was given `uploadRequestId`
   * as its `FileUploadInput.requestId`. A real `DaemonClient` sends
   * `file.upload.cancel.request` and resolves only once the daemon has
   * answered `file.upload.cancel.response` — never optimistically. A
   * caller must treat `cancelled: false`, a rejection, and a response
   * that never arrives all the same way: none of them is a confirmed
   * discard, so none of them may be reported to the user as one.
   */
  cancelUpload(uploadRequestId: string): Promise<FileUploadCancelResult>;
}

/**
 * Sentinel error message used by `createPendingConnectionFileUploadClient`
 * so `explainFileUploadError` can give it a dedicated explanation instead
 * of falling through to the generic "couldn't upload this file" message.
 */
export const FILE_UPLOAD_NOT_CONNECTED = "FILE_UPLOAD_NOT_CONNECTED";

export interface FileUploadErrorExplanation {
  readonly title: string;
  readonly description: string;
}

/**
 * Maps a raw transport-level `uploadFile` rejection (an `Error.message`)
 * to a title and description a user can act on. The picked file
 * selection is always preserved by the caller (`use-file-upload.ts`)
 * when this fires — nothing here discards it.
 */
export function explainFileUploadError(rawMessage: string): FileUploadErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_UPLOAD_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to upload files for this session.",
    };
  }
  if (/too large/i.test(message)) {
    return {
      title: "This file is too large to upload",
      description: message,
    };
  }
  return {
    title: "Couldn't upload this file",
    description:
      message.length > 0
        ? message
        : "The daemon returned an unknown error. Your selection is still here — try again.",
  };
}

/**
 * Explains a resolved, not-uploaded `FileUploadResult` (`error` set, no
 * `file`). Returns `null` when the upload succeeded.
 */
export function explainFileUploadResult(
  result: FileUploadResult,
): FileUploadErrorExplanation | null {
  if (!result.error) return null;

  const message = result.error.trim();
  if (/too large/i.test(message)) {
    return {
      title: "This file is too large to upload",
      description: message.length > 0 ? message : "This file is over the daemon's upload limit.",
    };
  }
  if (/size mismatch/i.test(message)) {
    return {
      title: "The upload was interrupted",
      description: "The file didn't fully arrive. Try uploading it again.",
    };
  }
  return {
    title: "Couldn't upload this file",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}

/**
 * Explains a `cancelUpload` outcome that did NOT confirm a discard —
 * `{ cancelled: false }` from the daemon, a rejected `cancelUpload()`
 * call, or (by the caller simply never calling this) one that never
 * settles. Never claims anything about the file's actual fate — only
 * that the cancellation itself could not be confirmed, since the
 * upload may already have finished successfully or failed for an
 * unrelated reason (`useFileUpload`'s `"cancel-failed"` status, T165).
 */
export function explainUploadCancelNotConfirmed(
  rawError: string | null | undefined,
): FileUploadErrorExplanation {
  const message = (rawError ?? "").trim();
  return {
    title: "Couldn't confirm the cancellation",
    description:
      message.length > 0
        ? message
        : "The daemon didn't confirm the upload was discarded — it may have already finished.",
  };
}
