/**
 * File write wire shapes and client contract (T30B3, plan.md §12.4).
 *
 * Sibling to `file-read-client.ts`'s `FileReadClient`/`readFile`: shaped
 * to match `@picompanion/client`'s `DaemonClient.writeFile(input)` (see
 * `packages/client/src/daemon-client.ts`) and the
 * `fs.file.write.request`/`fs.file.write.response` wire messages (see
 * `packages/protocol/src/messages.ts`'s `FileWriteResultSchema`). A real
 * `DaemonClient` already satisfies `FileWriteClient` structurally;
 * nothing here needs to import `@picompanion/client` to stay in sync
 * with it.
 *
 * Kept as its own interface (rather than folding `writeFile` onto
 * `FileReadClient`) for the same reason `FileReadClient` is separate
 * from `FileBrowserClient`: every existing `FileReadClient` test double
 * built for T30B2's read-only scenarios keeps compiling unchanged, and a
 * real wiring later passes the same `DaemonClient` instance as `client`,
 * `readClient`, and `writeClient`.
 *
 * The daemon's write RPC does not reject for a business-level failure —
 * a stale write (someone else changed the file since it was read) or a
 * server-side guard (oversized, binary, not-a-file) all resolve as a
 * `FileWriteResult` with `status !== "written"` rather than throwing (see
 * `packages/server/src/server/file-explorer/service.ts`'s
 * `writeExplorerFile`). `writeFile` below only *rejects* for a
 * transport-level failure (not connected, socket drop); `explainFileWriteResult`
 * covers the resolved, not-written outcomes and `explainFileWriteError`
 * covers the rejected ones.
 */

/**
 * Mirrors the daemon's `FileVersionSchema` (`packages/protocol/src/messages.ts`):
 * the authoritative version of a file as of the moment a `"conflict"`
 * write result was produced, so a caller can show what actually changed.
 */
export type FileWriteConflictVersion =
  | {
      readonly status: "ready";
      readonly cwd: string;
      readonly path: string;
      readonly size: number;
      readonly modifiedAt: string;
      readonly revision?: string;
    }
  | { readonly status: "missing"; readonly cwd: string; readonly path: string }
  | {
      readonly status: "error";
      readonly cwd: string;
      readonly path: string;
      readonly error: string;
    };

/** Mirrors the daemon's `FileWriteResultSchema` discriminated union. */
export type FileWriteResult =
  | {
      readonly status: "written";
      readonly modifiedAt: string;
      readonly size: number;
      readonly revision?: string;
    }
  | { readonly status: "conflict"; readonly version: FileWriteConflictVersion }
  | { readonly status: "error"; readonly error: string };

export interface FileWriteInput {
  /** The daemon-side workspace root (protocol `cwd`) the write is scoped to. */
  readonly cwd: string;
  /** The file's path, relative to `cwd`. */
  readonly path: string;
  /** The full new content to write (whole-file replace, matching the daemon's write semantics). */
  readonly content: string;
  /**
   * The `modifiedAt` this write was based on (the value on the
   * `FileReadResult` the editor was opened from). The daemon compares
   * this against the file's current on-disk state and returns
   * `"conflict"` instead of writing if it has moved.
   */
  readonly expectedModifiedAt: string;
  readonly expectedRevision?: string;
}

export interface FileWriteClient {
  /**
   * Writes a file's full content. Resolves with the outcome — including
   * a lost optimistic-concurrency race (`"conflict"`) or a server-side
   * guard failure (`"error"`) — rather than rejecting for those; only
   * rejects for a transport-level failure.
   */
  writeFile(input: FileWriteInput): Promise<FileWriteResult>;
}

/**
 * Sentinel error message used by `createPendingConnectionFileWriteClient`
 * so `explainFileWriteError` can give it a dedicated explanation instead
 * of falling through to the generic "couldn't save this file" message.
 */
export const FILE_WRITE_NOT_CONNECTED = "FILE_WRITE_NOT_CONNECTED";

export interface FileWriteErrorExplanation {
  readonly title: string;
  readonly description: string;
}

/**
 * Maps a raw transport-level `writeFile` rejection (an `Error.message`)
 * to a title and description a user can act on. The edited buffer is
 * always preserved by the caller (`use-file-editor.ts`) when this fires
 * — nothing here discards it.
 */
export function explainFileWriteError(rawMessage: string): FileWriteErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_WRITE_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to save changes for this session.",
    };
  }
  if (/^(eacces|eperm)\b/i.test(message) || /permission denied/i.test(message)) {
    return {
      title: "Permission denied",
      description: "The daemon does not have permission to save this file.",
    };
  }
  if (/access outside of workspace/i.test(message)) {
    return {
      title: "Outside the workspace",
      description: "This path is outside the folders the daemon shares with this session.",
    };
  }
  return {
    title: "Couldn't save this file",
    description:
      message.length > 0
        ? message
        : "The daemon returned an unknown error. Your changes are still here — try saving again.",
  };
}

/**
 * Explains a resolved, not-written `FileWriteResult` (`"conflict"` or
 * `"error"`). Returns `null` for `"written"` — nothing to explain, the
 * save succeeded.
 */
export function explainFileWriteResult(result: FileWriteResult): FileWriteErrorExplanation | null {
  if (result.status === "written") return null;

  if (result.status === "conflict") {
    if (result.version.status === "missing") {
      return {
        title: "This file was deleted",
        description:
          "It no longer exists on the laptop. Reload to see the latest state before saving again.",
      };
    }
    return {
      title: "Someone else changed this file",
      description:
        "This file changed on the laptop since you opened it. Reload it, then make your edit again to avoid overwriting the newer version.",
    };
  }

  const message = result.error.trim();
  if (/too large to edit/i.test(message)) {
    return {
      title: "This file is too large to save",
      description: "The daemon refuses to write a file over its editable size limit.",
    };
  }
  if (/binary files cannot be edited/i.test(message)) {
    return {
      title: "This is a binary file",
      description: "Binary files can't be saved as text.",
    };
  }
  if (/requested path is not a file/i.test(message)) {
    return {
      title: "Not a file",
      description: "The requested path points to a folder, not a file.",
    };
  }
  return {
    title: "Couldn't save this file",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}
