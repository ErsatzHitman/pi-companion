/**
 * File mutation ops client contract (remote file explorer).
 *
 * Sibling to `file-write-client.ts`'s `FileWriteClient`: shaped to
 * match `@picompanion/client`'s `DaemonClient.mkdir`/`createFile`/
 * `renameEntry`/`deleteEntry` (see `packages/client/src/
 * daemon-client.ts`) and the `fs.file.mkdir`/`fs.file.create`/
 * `fs.file.rename`/`fs.file.delete` wire messages (see
 * `packages/protocol/src/messages.ts`). A real `DaemonClient`
 * satisfies `FileOpsClient` structurally; nothing here imports
 * `@picompanion/client` to stay in sync with it.
 *
 * Unlike `writeFile` (which resolves business-level failures as a
 * `FileWriteResult`), these four RPCs reject with the daemon's raw
 * error string for business-level failures (missing path, occupied
 * destination, non-empty directory, root guards) as well as
 * transport-level ones — there is no result union to resolve into.
 * `explainFileOpsError` covers both.
 *
 * T41A1a path-authorization door: this interface does NOT authorize.
 * Every caller must pass each path through `authorizeWorkspacePath`
 * (`path-authorization.ts`) immediately before calling one of these
 * methods — the same way `use-file-browser.ts` does for
 * `listDirectory` — with nothing between that call and the request.
 */

export interface FileOpsClient {
  /**
   * Creates a directory (and any missing parents). `cwd` is the
   * daemon-side root (protocol `cwd`); `path` is relative to it.
   * Rejects with the daemon's raw explanation on failure.
   */
  mkdir(cwd: string, path: string): Promise<{ path: string | null }>;

  /**
   * Creates a new file with optional initial content. Never clobbers:
   * rejects when the path already exists.
   */
  createFile(cwd: string, path: string, content?: string): Promise<{ path: string | null }>;

  /**
   * Renames (or moves) an entry within `cwd`. Rejects when the
   * destination already exists.
   */
  renameEntry(
    cwd: string,
    oldPath: string,
    newPath: string,
  ): Promise<{ oldPath: string | null; newPath: string | null }>;

  /**
   * Deletes a file or directory. Directories need `recursive: true`
   * unless already empty.
   */
  deleteEntry(cwd: string, path: string, recursive?: boolean): Promise<{ path: string | null }>;
}

export interface FileOpsErrorExplanation {
  readonly title: string;
  readonly description: string;
}

/**
 * Sentinel error message used by `createPendingConnectionFileOpsClient`
 * so `explainFileOpsError` can give it a dedicated explanation instead
 * of falling through to the generic "couldn't change this file"
 * message. Mirrors `FILE_UPLOAD_NOT_CONNECTED` et al.
 */
export const FILE_OPS_NOT_CONNECTED = "FILE_OPS_NOT_CONNECTED";

/**
 * Maps a raw daemon `mkdir`/`createFile`/`renameEntry`/`deleteEntry`
 * rejection (an `Error.message`) to a title and description a user can
 * act on. Covers the shared `fs` errors and workspace guards
 * `explainFileBrowserError` knows, plus this surface's own guards
 * (`packages/server/src/server/file-explorer/service.ts`):
 * the three root guards, "Destination already exists",
 * "Directory is not empty", and "Requested path does not exist".
 */
export function explainFileOpsError(rawMessage: string): FileOpsErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_OPS_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to change files in this session.",
    };
  }
  if (/^(eacces|eperm)\b/i.test(message) || /permission denied/i.test(message)) {
    return {
      title: "Permission denied",
      description: "The daemon does not have permission to change this file or folder.",
    };
  }
  if (/access outside of workspace/i.test(message)) {
    return {
      title: "Outside the workspace",
      description: "This path is outside the folders the daemon shares with this session.",
    };
  }
  if (/cannot (create|delete|rename) the root directory/i.test(message)) {
    return {
      title: "The root folder is protected",
      description: "The shared folder itself can't be created, renamed, or deleted.",
    };
  }
  if (/destination already exists/i.test(message)) {
    return {
      title: "Something is already there",
      description: "Another file or folder already uses that name. Pick a different one.",
    };
  }
  if (/directory is not empty/i.test(message)) {
    return {
      title: "This folder isn't empty",
      description: "Only empty folders can be deleted without confirming the whole contents.",
    };
  }
  if (
    /^enoent\b/i.test(message) ||
    /no such file or directory/i.test(message) ||
    /requested path does not exist/i.test(message)
  ) {
    return {
      title: "This no longer exists",
      description:
        "It may have been moved, renamed, or deleted since it was last listed. Go back and try again.",
    };
  }
  if (/cwd is required/i.test(message)) {
    return {
      title: "No workspace selected",
      description: "This session does not have a workspace folder to change yet.",
    };
  }
  return {
    title: "Couldn't change this file",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}
