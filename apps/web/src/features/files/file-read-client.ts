/**
 * File read wire shapes and client contract (T30B2, plan.md §12.4).
 *
 * Sibling to `file-browser-client.ts`'s `FileBrowserClient`/
 * `listDirectory`: this is the read half of the same
 * `file_explorer_request`/`file_explorer_response` wire message (see
 * `packages/protocol/src/messages.ts`'s `FileExplorerFileSchema`), shaped
 * to match `@picompanion/client`'s `DaemonClient.readFile(cwd, path)`
 * (see `packages/client/src/daemon-client.ts`). A real `DaemonClient`
 * already satisfies `FileReadClient` structurally; nothing here needs to
 * import `@picompanion/client` to stay in sync with it.
 *
 * Kept as a separate interface (rather than folding `readFile` onto
 * `FileBrowserClient`) so every existing `FileBrowserClient` test double
 * built for T30B1's listing-only scenarios keeps compiling unchanged; a
 * real wiring later passes the same `DaemonClient` instance as both
 * `client` and `readClient` props.
 */

/**
 * Mirrors the daemon's three-way file classification
 * (`FileExplorerFileSchema.kind`): `"text"` files are safe to decode and
 * preview; `"image"` and `"binary"` are not previewed by this read-only
 * text view (T30B2's scope — see `explainRefusedFileKind`).
 */
export type FileReadKind = "text" | "image" | "binary";

export interface FileReadResult {
  readonly path: string;
  readonly kind: FileReadKind;
  /** The file's raw bytes. Decode with `TextDecoder` for `kind === "text"`. */
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly revision?: string;
}

export interface FileReadClient {
  /**
   * Reads a file's bytes. `cwd` is the daemon-side workspace root
   * (protocol `cwd`); `path` is the file's path relative to it. Rejects
   * with an `Error` whose `message` is the daemon's raw explanation on
   * failure (e.g. the path pointing at a directory instead of a file).
   */
  readFile(cwd: string, path: string): Promise<FileReadResult>;
}

/**
 * Sentinel error message used by `createPendingConnectionFileReadClient`
 * so `explainFileReadError` can give it a dedicated explanation instead
 * of falling through to the generic "couldn't read this file" message.
 */
export const FILE_READ_NOT_CONNECTED = "FILE_READ_NOT_CONNECTED";

/**
 * Upper bound on the byte size this read-only view will decode and
 * render as text. The daemon does not itself refuse oversized reads (its
 * `MAX_EDITABLE_FILE_BYTES` guard — see
 * `packages/server/src/server/file-explorer/service.ts` — only applies
 * to the write/save path T30B3 adds); this view enforces its own cap so
 * one very large file cannot stall rendering or balloon the DOM. Matches
 * the daemon's editable-file cap so a file this view can preview is also
 * one T30B3's editor can open.
 */
export const MAX_PREVIEWABLE_FILE_BYTES = 1024 * 1024;

export interface FileReadErrorExplanation {
  readonly title: string;
  readonly description: string;
}

/**
 * Maps a raw daemon (or placeholder-client) read error message to a
 * title and description a user can act on. Covers the same Node `fs`
 * errors and file-explorer service guards `explainFileBrowserError`
 * does for listing, plus the read-specific "not a file" guard.
 */
export function explainFileReadError(rawMessage: string): FileReadErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_READ_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to read files for this session.",
    };
  }
  if (/^enoent\b/i.test(message) || /no such file or directory/i.test(message)) {
    return {
      title: "This file no longer exists",
      description:
        "It may have been moved, renamed, or deleted since it was last listed. Go back and try again.",
    };
  }
  if (/^(eacces|eperm)\b/i.test(message) || /permission denied/i.test(message)) {
    return {
      title: "Permission denied",
      description: "The daemon does not have permission to read this file.",
    };
  }
  if (/access outside of workspace/i.test(message)) {
    return {
      title: "Outside the workspace",
      description: "This path is outside the folders the daemon shares with this session.",
    };
  }
  if (/requested path is not a file/i.test(message)) {
    return {
      title: "Not a file",
      description: "The requested path points to a folder, not a file.",
    };
  }
  if (/cwd is required/i.test(message)) {
    return {
      title: "No workspace selected",
      description: "This session does not have a workspace folder to browse yet.",
    };
  }
  return {
    title: "Couldn't read this file",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}

/**
 * Explains why a successfully read file is refused rather than
 * previewed: non-text `kind` (binary or image content), or text content
 * over `MAX_PREVIEWABLE_FILE_BYTES`. Returns `null` when the file should
 * be previewed instead.
 */
export function explainRefusedFileKind(file: FileReadResult): FileReadErrorExplanation | null {
  if (file.kind === "binary") {
    return {
      title: "This is a binary file",
      description: "Binary files can't be previewed as text.",
    };
  }
  if (file.kind === "image") {
    return {
      title: "This is an image file",
      description: "Image preview isn't available in this view yet.",
    };
  }
  if (file.size > MAX_PREVIEWABLE_FILE_BYTES) {
    return {
      title: "This file is too large to preview",
      description: `Files over ${formatBytesForRefusal(MAX_PREVIEWABLE_FILE_BYTES)} aren't previewed here.`,
    };
  }
  return null;
}

function formatBytesForRefusal(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}
