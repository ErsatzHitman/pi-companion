/**
 * Placeholder `FileUploadClient` (T30B4), mirroring
 * `pending-connection-file-write-client.ts`'s placeholder for the same
 * reason: `apps/web`'s daemon connection is not yet wired end to end.
 * Until a task wires a real, session-scoped `FileUploadClient` — a thin
 * adapter over `DaemonClient.uploadFile`, which already matches this
 * feature's `FileUploadClient` shape — this placeholder is what
 * `FileBrowserScreen` uses by default. It always rejects with
 * `FILE_UPLOAD_NOT_CONNECTED`, which `explainFileUploadError` turns into
 * a clear, non-crashing "not connected" explanation instead of ever
 * touching the daemon's upload storage directly (plan.md §12.4).
 *
 * `cancelUpload` (T165) never has anything to cancel through this
 * placeholder — `uploadFile` above never reaches `"uploading"` for real,
 * since it rejects before any byte would be sent — so it resolves
 * `cancelled: false` with the same sentinel `error`, which
 * `explainUploadCancelNotConfirmed` renders like any other unconfirmed
 * cancel rather than a special case.
 */
import { FILE_UPLOAD_NOT_CONNECTED, type FileUploadClient } from "./file-upload-client.js";

export function createPendingConnectionFileUploadClient(): FileUploadClient {
  return {
    uploadFile() {
      return Promise.reject(new Error(FILE_UPLOAD_NOT_CONNECTED));
    },
    cancelUpload() {
      return Promise.resolve({ cancelled: false, error: FILE_UPLOAD_NOT_CONNECTED });
    },
  };
}
