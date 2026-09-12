/**
 * Placeholder `FileOpsClient`, mirroring
 * `pending-connection-file-write-client.ts`'s placeholder for the same
 * reason: `apps/web`'s daemon connection is not yet wired end to end.
 * Until a task wires a real, session-scoped `FileOpsClient` — a thin
 * adapter over `DaemonClient.mkdir`/`createFile`/`renameEntry`/
 * `deleteEntry`, which already match this feature's `FileOpsClient`
 * shape — this placeholder is what `FileBrowserScreen` uses by default.
 * It always rejects with `FILE_OPS_NOT_CONNECTED`, which
 * `explainFileOpsError` turns into a clear, non-crashing "not connected"
 * explanation instead of ever touching a filesystem directly
 * (plan.md §12.4).
 */
import { FILE_OPS_NOT_CONNECTED, type FileOpsClient } from "./file-ops-client.js";

export function createPendingConnectionFileOpsClient(): FileOpsClient {
  return {
    mkdir() {
      return Promise.reject(new Error(FILE_OPS_NOT_CONNECTED));
    },
    createFile() {
      return Promise.reject(new Error(FILE_OPS_NOT_CONNECTED));
    },
    renameEntry() {
      return Promise.reject(new Error(FILE_OPS_NOT_CONNECTED));
    },
    deleteEntry() {
      return Promise.reject(new Error(FILE_OPS_NOT_CONNECTED));
    },
  };
}
