/**
 * Placeholder `FileWriteClient` (T30B3), mirroring
 * `pending-connection-file-read-client.ts`'s placeholder `FileReadClient`
 * for the same reason: `apps/web`'s daemon connection is not yet wired
 * end to end. Until a task wires a real, session-scoped `FileWriteClient`
 * — a thin adapter over `DaemonClient.writeFile`, which already matches
 * this feature's `FileWriteClient` shape — this placeholder is what
 * `FileBrowserScreen` uses by default. It always rejects with
 * `FILE_WRITE_NOT_CONNECTED`, which `explainFileWriteError` turns into a
 * clear, non-crashing "not connected" explanation instead of ever
 * touching a filesystem directly (plan.md §12.4).
 */
import { FILE_WRITE_NOT_CONNECTED, type FileWriteClient } from "./file-write-client.js";

export function createPendingConnectionFileWriteClient(): FileWriteClient {
  return {
    writeFile() {
      return Promise.reject(new Error(FILE_WRITE_NOT_CONNECTED));
    },
  };
}
