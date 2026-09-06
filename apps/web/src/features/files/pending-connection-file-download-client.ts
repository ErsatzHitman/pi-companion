/**
 * Placeholder `FileDownloadClient` (T30B4), mirroring
 * `pending-connection-file-read-client.ts`'s placeholder for the same
 * reason: `apps/web`'s daemon connection is not yet wired end to end.
 * Until a task wires a real, session-scoped `FileDownloadClient` — a
 * thin adapter over `DaemonClient.requestDownloadToken`, which already
 * matches this feature's `FileDownloadClient` shape — this placeholder
 * is what `FileBrowserScreen` uses by default. It always rejects with
 * `FILE_DOWNLOAD_NOT_CONNECTED`, which `explainFileDownloadError` turns
 * into a clear, non-crashing "not connected" explanation instead of ever
 * touching the daemon directly (plan.md §12.4).
 */
import { FILE_DOWNLOAD_NOT_CONNECTED, type FileDownloadClient } from "./file-download-client.js";

export function createPendingConnectionFileDownloadClient(): FileDownloadClient {
  return {
    requestDownloadToken() {
      return Promise.reject(new Error(FILE_DOWNLOAD_NOT_CONNECTED));
    },
  };
}
