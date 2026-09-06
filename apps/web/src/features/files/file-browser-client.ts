/**
 * File browser wire shapes and client contract (T30B1, plan.md §12.4).
 *
 * `apps/web` never touches a filesystem directly; every listing goes
 * through this narrow `FileBrowserClient` interface, which is shaped to
 * match `@picompanion/client`'s `DaemonClient.listDirectory(cwd, path)`
 * (see `packages/client/src/daemon-client.ts`) and the
 * `file_explorer_request`/`file_explorer_response` wire messages (see
 * `packages/protocol/src/messages.ts`, `FileExplorerDirectorySchema`).
 * A real `DaemonClient` already satisfies this interface structurally;
 * nothing here needs to import `@picompanion/client` to stay in sync
 * with it.
 *
 * `explainFileBrowserError` turns the raw error string the daemon (or
 * this feature's not-yet-connected placeholder client, see
 * `pending-connection-file-browser-client.ts`) returns into a title and
 * description a user can act on, per T30B1's "permission and
 * missing-path errors are explained" acceptance criterion.
 */

export type FileBrowserEntryKind = "file" | "directory";

export interface FileBrowserEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: FileBrowserEntryKind;
  readonly size: number;
  readonly modifiedAt: string;
}

export interface FileBrowserDirectory {
  readonly path: string;
  readonly entries: readonly FileBrowserEntry[];
}

export interface FileBrowserClient {
  /**
   * Lists a directory. `cwd` is the daemon-side workspace root (protocol
   * `cwd`); `path` is the directory's path relative to it (`""` is the
   * workspace root itself). Rejects with an `Error` whose `message` is
   * the daemon's raw explanation on failure.
   */
  listDirectory(cwd: string, path: string): Promise<FileBrowserDirectory>;
}

/**
 * Sentinel error message used by `createPendingConnectionFileBrowserClient`
 * (this feature's stand-in client) so `explainFileBrowserError` can give
 * it a dedicated explanation instead of falling through to the generic
 * "couldn't list this folder" message.
 */
export const FILE_BROWSER_NOT_CONNECTED = "FILE_BROWSER_NOT_CONNECTED";

export interface FileBrowserErrorExplanation {
  readonly title: string;
  readonly description: string;
}

/**
 * Maps a raw daemon (or placeholder-client) error message to a title and
 * description a user can act on. Matches the raw strings the reference
 * `file-explorer` service can throw (`packages/server/src/server/file-explorer/service.ts`
 * and `workspace-files-session.ts`): Node `fs` errors (`ENOENT`, `EACCES`/
 * `EPERM`), the service's own guard messages ("Access outside of
 * workspace is not allowed", "Requested path is not a directory", "cwd
 * is required"), and anything else falls back to a generic explanation
 * that still shows the daemon's raw text.
 */
/**
 * Whether `rawMessage` is the file-explorer service's "a directory was
 * expected here" guard (`packages/server/src/server/file-explorer/service.ts`).
 * `use-file-explorer.ts` (T30B2) checks this to decide whether a failed
 * `listDirectory` call means the path is actually a file to read instead.
 */
export function isNotADirectoryError(rawMessage: string): boolean {
  return /requested path is not a directory/i.test(rawMessage.trim());
}

export function explainFileBrowserError(rawMessage: string): FileBrowserErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_BROWSER_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to browse files for this session.",
    };
  }
  if (/^enoent\b/i.test(message) || /no such file or directory/i.test(message)) {
    return {
      title: "This folder no longer exists",
      description:
        "It may have been moved, renamed, or deleted since it was last listed. Go back and try again.",
    };
  }
  if (/^(eacces|eperm)\b/i.test(message) || /permission denied/i.test(message)) {
    return {
      title: "Permission denied",
      description: "The daemon does not have permission to read this folder.",
    };
  }
  if (/access outside of workspace/i.test(message)) {
    return {
      title: "Outside the workspace",
      description: "This path is outside the folders the daemon shares with this session.",
    };
  }
  if (isNotADirectoryError(message)) {
    return {
      title: "Not a folder",
      description: "The requested path points to a file, not a folder.",
    };
  }
  if (/cwd is required/i.test(message)) {
    return {
      title: "No workspace selected",
      description: "This session does not have a workspace folder to browse yet.",
    };
  }
  return {
    title: "Couldn't list this folder",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}
