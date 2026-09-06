/**
 * Placeholder `FileReadClient` (T30B2), mirroring
 * `pending-connection-file-browser-client.ts`'s placeholder
 * `FileBrowserClient` for the same reason: `apps/web`'s daemon
 * connection is not yet wired end to end. Until a task wires a real,
 * session-scoped `FileReadClient` — a thin adapter over
 * `DaemonClient.readFile`, which already matches this feature's
 * `FileReadClient` shape — this placeholder is what `FileBrowserScreen`
 * uses by default. It always rejects with `FILE_READ_NOT_CONNECTED`,
 * which `explainFileReadError` turns into a clear, non-crashing "not
 * connected" explanation instead of ever touching a filesystem directly
 * (plan.md §12.4).
 */
import { FILE_READ_NOT_CONNECTED, type FileReadClient } from "./file-read-client.js";

export function createPendingConnectionFileReadClient(): FileReadClient {
  return {
    readFile() {
      return Promise.reject(new Error(FILE_READ_NOT_CONNECTED));
    },
  };
}
