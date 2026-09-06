/**
 * Placeholder `FileBrowserClient` (T30B1).
 *
 * `apps/web`'s daemon connection is not yet wired end to end (see
 * `features/connection/fake-core-adapter.ts`, which stands in for the
 * real `DaemonClientLifecycle`/`DaemonClient` for the same reason). Until
 * a task wires a real, session-scoped `FileBrowserClient` — a thin
 * adapter over `DaemonClient.listDirectory`, which already matches this
 * feature's `FileBrowserClient` shape — this placeholder is what
 * `HostSessionFilesScreen` uses by default. It always rejects with
 * `FILE_BROWSER_NOT_CONNECTED`, which `explainFileBrowserError` turns
 * into a clear, non-crashing "not connected" explanation instead of
 * ever touching a filesystem directly (plan.md §12.4).
 *
 * Swap only this file (or the call site that constructs it) when a real
 * client lands; nothing else in this feature depends on it being fake.
 */
import { FILE_BROWSER_NOT_CONNECTED, type FileBrowserClient } from "./file-browser-client.js";

export function createPendingConnectionFileBrowserClient(): FileBrowserClient {
  return {
    listDirectory() {
      return Promise.reject(new Error(FILE_BROWSER_NOT_CONNECTED));
    },
  };
}
