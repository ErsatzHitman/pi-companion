/**
 * File browser wire shapes and client contract (T35A1, plan.md §6/§7/§12.4).
 *
 * Android never touches a filesystem directly — no `fs`, no
 * `expo-file-system`, no local path API. Every listing is one daemon
 * `file_explorer_request` (`mode: "list"`) round-trip, matching
 * `packages/protocol/src/messages.ts`'s `FileExplorerRequestSchema`/
 * `FileExplorerResponseSchema` and `packages/client/src/daemon-client.ts`'s
 * `DaemonClient.listDirectory(cwd, path)`. This file is a near-verbatim
 * port of `apps/web/src/features/files/file-browser-client.ts`'s already
 * -proven `FileBrowserClient` shape and error taxonomy, not an
 * independently invented one — the same raw daemon error strings must
 * explain the same way on both platforms. It is a port rather than a
 * shared import because `apps/web/src` is not a package either app's
 * `Owns` grant may import source-relative-across-workspace paths from
 * (see this repo's `CLAUDE.md`, "Cross-workspace imports use package
 * exports ... never source-relative paths"); this file imports neither
 * `@picompanion/client` nor anything under `D:/paseo` — a real
 * `DaemonClient` satisfies `FileBrowserClient` structurally as-is.
 *
 * `FILE_BROWSER_TIMEOUT` and its explanation are new here, not present
 * on web: `files-model.ts`'s `listDirectoryWithTimeout` races every
 * listing against an injected `Clock` so "the daemon never responded"
 * renders its own named state instead of hanging the screen on
 * `status: "loading"` forever (T35A1's "a request that times out"
 * acceptance criterion).
 *
 * T35A2 extends this same `FileBrowserClient` with the read half of the
 * wire message (`mode: "file"`) rather than inventing a second client —
 * see `readFile`'s doc below — and adds the matching `FileReadResult`
 * shape, error taxonomy, and refusal rules (binary/image content, and
 * content over `MAX_PREVIEWABLE_FILE_BYTES`). `file-view-model.ts` is
 * the read-side sibling of this file's `files-model.ts`.
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

  /**
   * Reads a file's bytes (T35A2's `mode: "file"` half of the same
   * `file_explorer_request`/`file_explorer_response` wire message —
   * `packages/protocol/src/messages.ts`'s `FileExplorerRequestSchema`/
   * `FileExplorerResponseSchema` and `DaemonClient.readFile(cwd, path)` in
   * `packages/client/src/daemon-client.ts`). `cwd`/`path` match
   * `listDirectory`'s. Rejects with an `Error` whose `message` is the
   * daemon's raw explanation on failure (e.g. the path pointing at a
   * directory instead of a file).
   *
   * Optional, not a second client interface: every existing
   * `FileBrowserClient` test double built for T35A1's listing-only
   * scenarios (`files-model.test.ts`, `files-screen.test.ts`) keeps
   * compiling unchanged with no `readFile`, and `createFileViewController`
   * (`file-view-model.ts`) treats a missing `readFile` the same as a
   * daemon that refused the request: `FILE_READ_NOT_CONNECTED`.
   */
  readFile?(cwd: string, path: string): Promise<FileReadResult>;

  /**
   * Writes a file's full content (T35A3's `fs.file.write.request`/
   * `fs.file.write.response` half of the wire protocol — see
   * `packages/protocol/src/messages.ts`'s `FileWriteRequestSchema`/
   * `FileWriteResultSchema` and `DaemonClient.writeFile(input)` in
   * `packages/client/src/daemon-client.ts`, whose method shape this
   * matches exactly so a real `DaemonClient` satisfies this optional
   * member structurally with no adapter). Resolves with the outcome —
   * including a lost optimistic-concurrency race (`"conflict"`) or a
   * server-side guard failure (`"error"`) — rather than rejecting for
   * those; only rejects for a transport-level failure (not connected,
   * timed out, a dropped socket).
   *
   * Optional for the same reason `readFile` is: every existing
   * `FileBrowserClient` test double built before this task keeps
   * compiling unchanged with no `writeFile`, and
   * `createFileEditController` (`file-edit-model.ts`) treats a missing
   * `writeFile` the same as a daemon that refused the request:
   * `FILE_WRITE_NOT_CONNECTED`.
   */
  writeFile?(input: FileWriteInput): Promise<FileWriteResult>;

  /**
   * Uploads a file's full bytes as a staged daemon attachment (T35A4's
   * `file.upload.request`/`file.upload.response` wire message — see
   * `packages/protocol/src/messages.ts`'s `FileUploadRequestSchema`/
   * `FileUploadResponseSchema` and `DaemonClient.uploadFile(input)` in
   * `packages/client/src/daemon-client.ts`, whose method shape this
   * matches exactly so a real `DaemonClient` satisfies this optional
   * member structurally). Resolves with the outcome — including a
   * server-side guard failure (`{ file: null, error }`, e.g. a declared
   * size mismatch) — rather than rejecting for that; only rejects for a
   * transport-level failure (not connected, timed out, a dropped
   * socket mid-transfer).
   *
   * Important asymmetry from `writeFile`, ported as-is from web's own
   * `FileUploadClient` (`apps/web/src/features/files/
   * file-upload-client.ts`), not independently invented: the daemon's
   * upload RPC takes no `cwd`/`path` — it stages the file under the
   * daemon's own upload directory as a generic `uploaded_file`
   * attachment, not by writing it into the currently browsed workspace
   * folder. There is no daemon RPC that uploads a file into an
   * arbitrary workspace path; `file-upload-model.ts`'s controller and
   * this feature's screen wording make that plain rather than implying
   * the file lands in the folder being browsed.
   *
   * Optional for the same reason `readFile`/`writeFile` are: every
   * existing `FileBrowserClient` test double built before T35A4 keeps
   * compiling unchanged with no `uploadFile`, and
   * `createFileUploadController` (`file-upload-model.ts`) treats a
   * missing `uploadFile` the same as a daemon that refused the request:
   * `FILE_UPLOAD_NOT_CONNECTED`.
   */
  uploadFile?(input: FileUploadInput): Promise<FileUploadResult>;

  /**
   * Requests a single-use, short-TTL download token for a file (T35A4's
   * `file_download_token_request`/`file_download_token_response` wire
   * message — see `packages/protocol/src/messages.ts`'s
   * `FileDownloadTokenRequestSchema`/`FileDownloadTokenResponseSchema`
   * and `DaemonClient.requestDownloadToken(cwd, path)` in
   * `packages/client/src/daemon-client.ts`, whose method shape this
   * matches exactly). `cwd`/`path` match `listDirectory`'s. Rejects
   * with an `Error` whose `message` is the daemon's raw explanation on
   * a transport-level failure; resolves with `token: null` and `error`
   * set for a business-level failure (missing file, path outside the
   * workspace) rather than rejecting for that — ported from web's
   * `FileDownloadClient` (`apps/web/src/features/files/
   * file-download-client.ts`), not independently invented.
   *
   * Unlike upload, the daemon does not stream the file's bytes back
   * over this RPC (or over the WebSocket at all): the actual transfer
   * is a plain HTTP GET to `/api/files/download?token=...`
   * (`buildFileDownloadUrl` below), which `file-download-model.ts`
   * fetches with real byte-level progress. That HTTP fetch is
   * deliberately not part of this interface — it is a separate
   * injected `DownloadFetch` in `file-download-model.ts`, exactly like
   * web's `MinimalFetch` in `use-file-download.ts` — because this
   * screen's only live transport is the daemon RPC client
   * (`FileBrowserClient`), and resolving the daemon's reachable HTTP
   * origin to actually issue that GET is not this task's grant (see
   * this file's module doc and this task's report for the filed seam).
   *
   * Optional for the same reason every other transfer member on this
   * interface is: every existing `FileBrowserClient` test double keeps
   * compiling unchanged with no `requestDownloadToken`, and
   * `createFileDownloadController` (`file-download-model.ts`) treats a
   * missing `requestDownloadToken` the same as a daemon that refused
   * the request: `FILE_DOWNLOAD_NOT_CONNECTED`.
   */
  requestDownloadToken?(cwd: string, path: string): Promise<FileDownloadTokenResult>;

  /**
   * Creates a directory (and any missing parents) inside `cwd`
   * (the `fs.file.mkdir.request`/`fs.file.mkdir.response` wire
   * message — see `packages/protocol/src/messages.ts`'s
   * `FsFileMkdirRequestSchema`/`FsFileMkdirResponseSchema` and
   * `DaemonClient.mkdir(cwd, path)` in
   * `packages/client/src/daemon-client.ts`, whose method shape this
   * matches exactly so a real `DaemonClient` satisfies this optional
   * member structurally with no adapter). Rejects with an `Error`
   * whose `message` is the daemon's raw explanation on failure.
   *
   * Optional for the same reason every other member on this
   * interface is: every existing `FileBrowserClient` test double
   * keeps compiling unchanged with no `mkdir`.
   */
  mkdir?(cwd: string, path: string): Promise<{ path: string | null }>;

  /**
   * Creates a new file with optional initial content inside `cwd`
   * (the `fs.file.create.request`/`fs.file.create.response` wire
   * message — `FsFileCreateRequestSchema`/`FsFileCreateResponseSchema`
   * and `DaemonClient.createFile(cwd, path, content?)`, matched
   * exactly for the same structural reason as `mkdir`). Never
   * clobbers: rejects when the path already exists.
   *
   * Optional for the same reason as `mkdir`.
   */
  createFile?(cwd: string, path: string, content?: string): Promise<{ path: string | null }>;

  /**
   * Renames (or moves) an entry within `cwd` (the
   * `fs.file.rename.request`/`fs.file.rename.response` wire message —
   * `FsFileRenameRequestSchema`/`FsFileRenameResponseSchema` and
   * `DaemonClient.renameEntry(cwd, oldPath, newPath)`, matched exactly
   * for the same structural reason as `mkdir`). Rejects when the
   * destination already exists.
   *
   * Optional for the same reason as `mkdir`.
   */
  renameEntry?(
    cwd: string,
    oldPath: string,
    newPath: string,
  ): Promise<{ oldPath: string | null; newPath: string | null }>;

  /**
   * Deletes a file or directory inside `cwd` (the
   * `fs.file.delete.request`/`fs.file.delete.response` wire message —
   * `FsFileDeleteRequestSchema`/`FsFileDeleteResponseSchema` and
   * `DaemonClient.deleteEntry(cwd, path, recursive?)`, matched exactly
   * for the same structural reason as `mkdir`). Directories need
   * `recursive: true` unless already empty.
   *
   * Optional for the same reason as `mkdir`.
   */
  deleteEntry?(cwd: string, path: string, recursive?: boolean): Promise<{ path: string | null }>;
}

// ---------------------------------------------------------------------------
// File read (T35A2)
// ---------------------------------------------------------------------------

/**
 * Mirrors the daemon's three-way file classification
 * (`FileExplorerFileSchema.kind` in `packages/protocol/src/messages.ts`):
 * `"text"` files are safe to decode and preview; `"image"` and `"binary"`
 * are not previewed by this read-only view (see `explainRefusedFileKind`).
 */
export type FileReadKind = "text" | "image" | "binary";

export interface FileReadResult {
  readonly path: string;
  readonly kind: FileReadKind;
  /** The file's raw bytes. Decode with `decodeUtf8Bytes` (`file-syntax-highlight.ts`) for `kind === "text"` — Hermes does not guarantee a global `TextDecoder` (see that module's doc). */
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly revision?: string;
}

/** Sentinel error message a `FileBrowserClient` with no `readFile` (or an explicit not-yet-connected placeholder) rejects a read with. */
export const FILE_READ_NOT_CONNECTED = "FILE_READ_NOT_CONNECTED";

/** Sentinel `readFileWithTimeout` (`file-view-model.ts`) rejects with once its timer fires first. */
export const FILE_READ_TIMEOUT = "FILE_READ_TIMEOUT";

/**
 * Upper bound on the byte size this read-only view will decode and
 * render. Matches web's `MAX_PREVIEWABLE_FILE_BYTES`
 * (`apps/web/src/features/files/file-read-client.ts`) so a file either
 * platform refuses is refused on both — deliberately not a smaller,
 * mobile-specific cap: `decodeUtf8Bytes` and `tokenizeFileContent`
 * (`file-syntax-highlight.ts`) are the same order of cost per byte as
 * web's `TextDecoder` + Lezer tokenizer, and a mobile device has less
 * headroom than a desktop browser tab, not more, so a *higher* ceiling
 * here would be the wrong direction. The daemon does not itself refuse
 * an oversized read; this view enforces its own cap so one very large
 * file cannot stall rendering or balloon memory on a phone.
 */
export const MAX_PREVIEWABLE_FILE_BYTES = 1024 * 1024;

/**
 * Explains why a byte size over `MAX_PREVIEWABLE_FILE_BYTES` is refused.
 * Shared by `explainRefusedFileKind` (post-read, from the read result's
 * own `size`) and `file-view-model.ts`'s pre-read check (from the
 * directory listing's `FileBrowserEntry.size`, before any read RPC is
 * even issued) so the two refusals read identically.
 */
export function explainOversizedFile(sizeBytes: number): FileBrowserErrorExplanation {
  return {
    title: "This file is too large to preview",
    description: `Files over ${Math.round(MAX_PREVIEWABLE_FILE_BYTES / 1024)} KB aren't previewed here. This one is ${Math.round(sizeBytes / 1024)} KB.`,
  };
}

/**
 * Explains why a successfully read file is refused rather than
 * previewed: non-text `kind` (binary or image content), or text content
 * over `MAX_PREVIEWABLE_FILE_BYTES`. Returns `null` when the file should
 * be previewed instead. Matches web's `explainRefusedFileKind`
 * (`apps/web/src/features/files/file-read-client.ts`) vocabulary.
 */
export function explainRefusedFileKind(file: FileReadResult): FileBrowserErrorExplanation | null {
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
    return explainOversizedFile(file.size);
  }
  return null;
}

/**
 * Maps a raw daemon (or placeholder-client) read error message to a
 * title and description a user can act on. Covers the same Node `fs`
 * errors and file-explorer service guards `explainFileBrowserError`
 * does for listing (this function reuses `isPathNotFoundError`, so the
 * two never drift on what counts as "vanished"), plus the read-specific
 * "not a file" guard (`packages/server/src/server/file-explorer/
 * service.ts`'s `"Requested path is not a file"`).
 */
export function explainFileReadError(rawMessage: string): FileBrowserErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_READ_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to read files for this session.",
    };
  }
  if (message === FILE_READ_TIMEOUT) {
    return {
      title: "Request timed out",
      description: "The daemon didn't respond in time. Check the connection and try again.",
    };
  }
  if (isPathNotFoundError(message)) {
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

// ---------------------------------------------------------------------------
// File write (T35A3)
// ---------------------------------------------------------------------------

/**
 * Mirrors the daemon's `FileVersionSchema`
 * (`packages/protocol/src/messages.ts`): the authoritative version of a
 * file as of the moment a `"conflict"` write result was produced, so a
 * caller can show what actually changed. Near-verbatim port of web's
 * `FileWriteConflictVersion` (`apps/web/src/features/files/
 * file-write-client.ts`).
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
   * `"conflict"` instead of writing if it has moved since — this is
   * what makes "the file changed on disk since the read" a real, named
   * outcome instead of a silent overwrite.
   */
  readonly expectedModifiedAt: string;
  readonly expectedRevision?: string;
}

/**
 * Sentinel error message a `FileBrowserClient` with no `writeFile` (or
 * an explicit not-yet-connected placeholder) rejects a write with.
 * `writeFile` is optional on `FileBrowserClient` for the same reason
 * `readFile` is (see that field's doc): every existing test double
 * built before T35A3 keeps compiling unchanged with no `writeFile`, and
 * `createFileEditController` (`file-edit-model.ts`) treats a missing
 * `writeFile` the same as a daemon that refused the request.
 */
export const FILE_WRITE_NOT_CONNECTED = "FILE_WRITE_NOT_CONNECTED";

/** Sentinel `writeFileWithTimeout` (`file-edit-model.ts`) rejects with once its timer fires first — covers "the connection dropped mid-save" without hanging the save UI forever. */
export const FILE_WRITE_TIMEOUT = "FILE_WRITE_TIMEOUT";

/**
 * Maps a raw transport-level `writeFile` rejection (an `Error.message`
 * — not connected, timed out, a dropped socket) to a title and
 * description a user can act on. The edited buffer is always preserved
 * by the caller (`file-edit-model.ts`) when this fires — nothing here
 * discards it. Matches web's `explainFileWriteError`
 * (`apps/web/src/features/files/file-write-client.ts`) vocabulary.
 */
export function explainFileWriteError(rawMessage: string): FileBrowserErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_WRITE_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to save changes for this session. Your edit is still here.",
    };
  }
  if (message === FILE_WRITE_TIMEOUT) {
    return {
      title: "Save timed out",
      description:
        "The daemon didn't respond in time. Your edit is still here — check the connection and try again.",
    };
  }
  if (/^(eacces|eperm)\b/i.test(message) || /permission denied/i.test(message)) {
    return {
      title: "Permission denied",
      description:
        "The daemon does not have permission to save this file. Your edit is still here.",
    };
  }
  if (/access outside of workspace/i.test(message)) {
    return {
      title: "Outside the workspace",
      description:
        "This path is outside the folders the daemon shares with this session. Your edit is still here.",
    };
  }
  return {
    title: "Couldn't save this file",
    description:
      message.length > 0
        ? `${message} Your edit is still here — try saving again.`
        : "The daemon returned an unknown error. Your edit is still here — try saving again.",
  };
}

/**
 * Explains a resolved, not-written `FileWriteResult` (`"conflict"` or
 * `"error"` — the daemon's write RPC does not reject for a
 * business-level failure, it resolves with one of these instead, see
 * `packages/server/src/server/file-explorer/service.ts#writeExplorerFile`).
 * Returns `null` for `"written"` — nothing to explain, the save
 * succeeded. Matches web's `explainFileWriteResult` vocabulary.
 */
export function explainFileWriteResult(
  result: FileWriteResult,
): FileBrowserErrorExplanation | null {
  if (result.status === "written") return null;

  if (result.status === "conflict") {
    if (result.version.status === "missing") {
      return {
        title: "This file was deleted",
        description:
          "It no longer exists on the daemon's machine. Your edit is still here — reload to see the latest state before saving again.",
      };
    }
    return {
      title: "Someone else changed this file",
      description:
        "This file changed since you opened it. Your edit is still here — reload it, then make your edit again to avoid overwriting the newer version.",
    };
  }

  const message = result.error.trim();
  if (/too large to edit/i.test(message)) {
    return {
      title: "This file is too large to save",
      description:
        "The daemon refuses to write a file over its editable size limit. Your edit is still here.",
    };
  }
  if (/binary files cannot be edited/i.test(message)) {
    return {
      title: "This is a binary file",
      description: "Binary files can't be saved as text. Your edit is still here.",
    };
  }
  if (/requested path is not a file/i.test(message)) {
    return {
      title: "Not a file",
      description: "The requested path points to a folder, not a file. Your edit is still here.",
    };
  }
  if (/^(eacces|eperm)\b/i.test(message) || /permission denied/i.test(message)) {
    return {
      title: "Permission denied",
      description:
        "The daemon does not have permission to save this file. Your edit is still here.",
    };
  }
  return {
    title: "Couldn't save this file",
    description:
      message.length > 0
        ? `${message} Your edit is still here.`
        : "The daemon returned an unknown error. Your edit is still here.",
  };
}

/**
 * Sentinel error message this feature's not-yet-connected placeholder
 * client (a caller with no live `FileBrowserClient` yet) rejects with,
 * so `explainFileBrowserError` gives it a dedicated explanation instead
 * of falling through to the generic "couldn't list this folder" one.
 */
export const FILE_BROWSER_NOT_CONNECTED = "FILE_BROWSER_NOT_CONNECTED";

/** Sentinel `listDirectoryWithTimeout` rejects with once its timer fires first. See module doc. */
export const FILE_BROWSER_TIMEOUT = "FILE_BROWSER_TIMEOUT";

export interface FileBrowserErrorExplanation {
  readonly title: string;
  readonly description: string;
}

/**
 * Whether `rawMessage` is the file-explorer service's "a directory was
 * expected here" guard (`packages/server/src/server/file-explorer/service.ts`).
 * Not currently consulted by this task's navigation (Android does not
 * read file content this wave — a file row is display-only, see
 * `files-model.ts`'s module doc), but kept alongside
 * `explainFileBrowserError` so a later file-reading task can reuse the
 * exact same probe web's `use-file-explorer.ts` already relies on
 * instead of re-deriving it.
 */
export function isNotADirectoryError(rawMessage: string): boolean {
  return /requested path is not a directory/i.test(rawMessage.trim());
}

/** Whether `rawMessage` looks like the path was not found (Node `ENOENT`, or its English message). */
export function isPathNotFoundError(rawMessage: string): boolean {
  const message = rawMessage.trim();
  return /^enoent\b/i.test(message) || /no such file or directory/i.test(message);
}

/**
 * Maps a raw daemon (or placeholder-client) error message to a title and
 * description a user can act on. Matches the raw strings the reference
 * `file-explorer` service can throw (`packages/server/src/server/
 * file-explorer/service.ts` and `workspace-files-session.ts`): Node `fs`
 * errors (`ENOENT`, `EACCES`/`EPERM`), the service's own guard messages
 * ("Access outside of workspace is not allowed", "Requested path is not
 * a directory", "cwd is required"), and anything else falls back to a
 * generic explanation that still shows the daemon's raw text.
 *
 * `context` distinguishes an initial directory listing (`"list"`) from
 * navigating into an entry this same screen just showed (`"open"`):
 * an `ENOENT` while listing reads as "this folder no longer exists",
 * but the identical raw error while opening a row that was on screen a
 * moment ago reads as "this item just disappeared" instead — the same
 * daemon failure, a different, more accurate story for the user
 * depending on what they just did (T35A1's "vanished between listing
 * and open" acceptance criterion).
 */
export function explainFileBrowserError(
  rawMessage: string,
  context: "list" | "open" = "list",
): FileBrowserErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_BROWSER_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to browse files for this session.",
    };
  }
  if (message === FILE_BROWSER_TIMEOUT) {
    return {
      title: "Request timed out",
      description: "The daemon didn't respond in time. Check the connection and try again.",
    };
  }
  if (isPathNotFoundError(message)) {
    if (context === "open") {
      return {
        title: "This item just disappeared",
        description:
          "It was here a moment ago, but the daemon can no longer find it. Go back and refresh the listing.",
      };
    }
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

// ---------------------------------------------------------------------------
// File upload (T35A4)
// ---------------------------------------------------------------------------

/** Mirrors `DaemonClient.uploadFile`'s `FileUploadInput` shape (`packages/client/src/daemon-client.ts`), minus `chunkSize` — chunking is internal to that method and not this client's concern. */
export interface FileUploadInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly modifiedAt?: string;
  readonly requestId?: string;
}

/** Mirrors the daemon's `UploadedFileAttachmentSchema` (`packages/protocol/src/messages.ts`). */
export interface FileUploadAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  /** The daemon-side staging path this upload was written to (not a workspace-relative path — see `uploadFile`'s doc above). */
  readonly path: string;
}

/** Mirrors the daemon's `FileUploadResponseSchema.payload` shape. */
export interface FileUploadResult {
  readonly file: FileUploadAttachment | null;
  readonly error: string | null;
}

/** Sentinel error message a `FileBrowserClient` with no `uploadFile` (or an explicit not-yet-connected placeholder) rejects an upload with. */
export const FILE_UPLOAD_NOT_CONNECTED = "FILE_UPLOAD_NOT_CONNECTED";

/** Sentinel `uploadFileWithTimeout` (`file-upload-model.ts`) rejects with once its timer fires first — covers "the connection dropped mid-upload" without hanging the upload UI forever. */
export const FILE_UPLOAD_TIMEOUT = "FILE_UPLOAD_TIMEOUT";

/**
 * Sentinel `file-upload-model.ts` uses internally to mark a controller
 * result as superseded by `cancel()` — never sent to or received from
 * the daemon. Exported so its test can assert on the exact string
 * rather than a magic literal.
 */
export const FILE_UPLOAD_CANCELLED = "FILE_UPLOAD_CANCELLED";

/**
 * Upper bound this client refuses to attempt an upload past, *before*
 * ever calling `client.uploadFile` or even finishing
 * `PickedFile.readAsBytes()` when the picker already knows the size
 * (T35A4's "surface each limit before the transfer starts" acceptance
 * criterion). Matches `DaemonClient.uploadFile`'s own hardcoded
 * `MAX_UPLOAD_BYTES` (`packages/client/src/daemon-client.ts`, "File too
 * large — max 100 MB over mobile") exactly, so a file this view refuses
 * pre-flight is the same file the daemon would have refused anyway —
 * this constant is not exported by that module, so it is duplicated
 * here with this comment as the single place that must stay in sync if
 * that RPC's own ceiling ever changes.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Explains why a byte size over `MAX_UPLOAD_BYTES` is refused before any transfer begins. */
export function explainOversizedUpload(sizeBytes: number): FileBrowserErrorExplanation {
  return {
    title: "This file is too large to upload",
    description: `Files over ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB aren't supported. This one is ${Math.round(sizeBytes / (1024 * 1024))} MB.`,
  };
}

/**
 * Maps a raw transport-level `uploadFile` rejection (an `Error.message`
 * — not connected, timed out, cancelled, a dropped socket) to a title
 * and description a user can act on. The picked file selection is
 * always preserved by the caller (`file-upload-model.ts`) when this
 * fires — nothing here discards it. Matches web's
 * `explainFileUploadError` (`apps/web/src/features/files/
 * file-upload-client.ts`) vocabulary, plus the timeout/cancellation
 * cases this platform's `Clock`-raced wrapper and `cancel()` add.
 */
export function explainFileUploadError(rawMessage: string): FileBrowserErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_UPLOAD_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to upload files for this session.",
    };
  }
  if (message === FILE_UPLOAD_TIMEOUT) {
    return {
      title: "Upload timed out",
      description:
        "The daemon didn't respond in time. Your selection is still here — check the connection and try again.",
    };
  }
  if (/too large/i.test(message)) {
    return {
      title: "This file is too large to upload",
      description: message,
    };
  }
  return {
    title: "Couldn't upload this file",
    description:
      message.length > 0
        ? message
        : "The daemon returned an unknown error. Your selection is still here — try again.",
  };
}

/**
 * Explains a resolved, not-uploaded `FileUploadResult` (`error` set, no
 * `file`) — the daemon's upload RPC does not reject for a
 * business-level failure (an oversized file, a size mismatch between
 * the declared and received byte count), it resolves with this instead
 * (see `FileUploadStore` in `packages/server/src/server/file-upload/
 * index.ts`). Returns `null` when the upload succeeded. Matches web's
 * `explainFileUploadResult` vocabulary.
 */
export function explainFileUploadResult(
  result: FileUploadResult,
): FileBrowserErrorExplanation | null {
  if (!result.error) return null;

  const message = result.error.trim();
  if (/too large/i.test(message)) {
    return {
      title: "This file is too large to upload",
      description: message.length > 0 ? message : "This file is over the daemon's upload limit.",
    };
  }
  if (/size mismatch/i.test(message)) {
    return {
      title: "The upload was interrupted",
      description: "The file didn't fully arrive. Try uploading it again.",
    };
  }
  return {
    title: "Couldn't upload this file",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}

// ---------------------------------------------------------------------------
// File download (T35A4)
// ---------------------------------------------------------------------------

/** Mirrors the daemon's `FileDownloadTokenResponseSchema.payload` shape (minus `requestId`, which the caller already knows and this client's return type doesn't need to echo back — same trim web's `FileDownloadTokenResult` makes). */
export interface FileDownloadTokenResult {
  readonly cwd: string;
  readonly path: string;
  readonly token: string | null;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly size: number | null;
  readonly error: string | null;
}

/** Sentinel error message a `FileBrowserClient` with no `requestDownloadToken` (or an explicit not-yet-connected placeholder) rejects a download with. */
export const FILE_DOWNLOAD_NOT_CONNECTED = "FILE_DOWNLOAD_NOT_CONNECTED";

/** Sentinel `requestDownloadTokenWithTimeout` (`file-download-model.ts`) rejects with once its timer fires first. */
export const FILE_DOWNLOAD_TOKEN_TIMEOUT = "FILE_DOWNLOAD_TOKEN_TIMEOUT";

/**
 * Sentinel `file-download-model.ts` raises when a token was issued but
 * the actual byte fetch fails partway (the HTTP response's stream
 * rejects, or the connection drops mid-download) — distinct from a
 * `requestDownloadToken` rejection so `explainFileDownloadError` can
 * still show *something* useful even though this case has no daemon
 * `Error.message` to relay (the failure happened in the injected
 * `DownloadFetch`, not the RPC).
 */
export const FILE_DOWNLOAD_TRANSFER_FAILED = "FILE_DOWNLOAD_TRANSFER_FAILED";

/**
 * Sentinel `file-download-model.ts` uses internally to mark a
 * controller result as superseded by `cancel()` — never sent to or
 * received from the daemon.
 */
export const FILE_DOWNLOAD_CANCELLED = "FILE_DOWNLOAD_CANCELLED";

/**
 * Sentinel `file-download-model.ts` raises when a token was issued but
 * no reachable HTTP origin is available to fetch it from — either
 * because the daemon connection isn't the kind that carries one yet
 * (`FilesScreenProps.downloadOrigin` genuinely unresolved), or, since
 * T66, because it never can be: see `FILE_DOWNLOAD_NO_RELAY_ORIGIN`
 * just below, the distinct sentinel for a *relay-paired* connection,
 * which `file-download-model.ts` raises instead of this one whenever
 * its caller reports `connectionPath === "relay"`. Matches web's
 * identical `FILE_DOWNLOAD_NO_ORIGIN` (`apps/web/src/features/files/
 * file-download-client.ts`) for the shared, non-relay-specific case.
 */
export const FILE_DOWNLOAD_NO_ORIGIN = "FILE_DOWNLOAD_NO_ORIGIN";

/**
 * Sentinel `file-download-model.ts` raises in place of
 * `FILE_DOWNLOAD_NO_ORIGIN` when the *reason* there is no downloadable
 * HTTP origin is that this connection is relay-paired (T66, plan.md
 * §12.1: "Relay profiles retain the daemon public key and use the
 * existing encrypted relay transport"). `daemon-connection-store.ts`'s
 * `daemonAddress` is `null` on the relay path *by design*, not by
 * omission — a relay tunnel proxies only the encrypted WebSocket, so
 * there is no daemon-reachable HTTP origin to derive one from, and
 * bridging one would mean building an HTTP-over-relay proxy in
 * `packages/relay` (off-limits this wave; see this task's report for
 * the filed seam naming the task that should own it). Distinguishing
 * this from the generic `FILE_DOWNLOAD_NO_ORIGIN` matters because the
 * two read very differently to a user: the generic one says "not
 * available *yet*" (an app-wiring gap that resolves once fixed); this
 * one is permanent for as long as the session stays relay-paired, and
 * `explainFileDownloadError` below says so rather than implying the
 * user should simply wait or retry.
 */
export const FILE_DOWNLOAD_NO_RELAY_ORIGIN = "FILE_DOWNLOAD_NO_RELAY_ORIGIN";

/**
 * Upper bound this view refuses to fetch past, checked against the
 * token response's own `size` the moment it arrives — *before* the
 * byte-level HTTP GET ever starts (T35A4's "surface each limit before
 * the transfer starts" acceptance criterion applied to the download
 * side: the daemon's download route does not itself refuse a large
 * file, and this view buffers every received chunk in memory before
 * handing the assembled bytes to `Sharing.shareFiles`, so an unbounded
 * download could exhaust a phone's memory). Set equal to
 * `MAX_UPLOAD_BYTES` for the same reason `MAX_PREVIEWABLE_FILE_BYTES`
 * is not given its own smaller, mobile-specific number: a mobile
 * device has less memory headroom than a desktop tab, not more, so a
 * higher ceiling here would be the wrong direction, and the daemon
 * imposes the same 100 MB shape on the upload side already.
 */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

/** Explains why a byte size over `MAX_DOWNLOAD_BYTES` is refused before any HTTP fetch begins. */
export function explainOversizedDownload(sizeBytes: number): FileBrowserErrorExplanation {
  return {
    title: "This file is too large to download",
    description: `Files over ${Math.round(MAX_DOWNLOAD_BYTES / (1024 * 1024))} MB aren't supported here. This one is ${Math.round(sizeBytes / (1024 * 1024))} MB.`,
  };
}

/**
 * Maps a raw transport-level failure (an `Error.message` from a
 * rejected `requestDownloadToken`, a timeout, a cancellation, or a
 * failure while actually fetching the token's bytes) to a title and
 * description a user can act on. The requested entry is always
 * preserved by the caller (`file-download-model.ts`) when this fires —
 * nothing here discards it. Matches web's `explainFileDownloadError`
 * (`apps/web/src/features/files/file-download-client.ts`) vocabulary.
 */
export function explainFileDownloadError(rawMessage: string): FileBrowserErrorExplanation {
  const message = rawMessage.trim();

  if (message === FILE_DOWNLOAD_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to download files for this session.",
    };
  }
  if (message === FILE_DOWNLOAD_TOKEN_TIMEOUT) {
    return {
      title: "Request timed out",
      description: "The daemon didn't respond in time. Check the connection and try again.",
    };
  }
  if (message === FILE_DOWNLOAD_TRANSFER_FAILED) {
    return {
      title: "The download was interrupted",
      description: "The connection dropped partway through. Nothing was saved — try again.",
    };
  }
  if (message === FILE_DOWNLOAD_NO_ORIGIN) {
    return {
      title: "Downloads aren't available yet",
      description: "This session isn't connected to a reachable daemon address yet.",
    };
  }
  if (message === FILE_DOWNLOAD_NO_RELAY_ORIGIN) {
    return {
      title: "Downloads aren't available over a relay connection",
      description:
        "This session is connected through the relay, which only tunnels the encrypted session and can't proxy a file download. Connect directly to this daemon to download files.",
    };
  }
  return {
    title: "Couldn't download this file",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}

/**
 * Explains a resolved, no-token `FileDownloadTokenResult` (`error` set,
 * no `token`). Returns `null` when a token was issued successfully.
 * Matches web's `explainFileDownloadTokenResult` vocabulary, reusing
 * `isPathNotFoundError` so "vanished" reads identically to listing/read.
 */
export function explainFileDownloadTokenResult(
  result: FileDownloadTokenResult,
): FileBrowserErrorExplanation | null {
  if (!result.error) return null;

  const message = result.error.trim();
  if (isPathNotFoundError(message)) {
    return {
      title: "This file no longer exists",
      description:
        "It may have been moved, renamed, or deleted since it was last listed. Go back and try again.",
    };
  }
  if (/access outside of workspace/i.test(message)) {
    return {
      title: "Outside the workspace",
      description: "This path is outside the folders the daemon shares with this session.",
    };
  }
  return {
    title: "Couldn't download this file",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}

/**
 * Builds the fetchable URL for a download token, given the daemon's
 * HTTP origin (e.g. `"http://127.0.0.1:6768"`) and the token
 * `requestDownloadToken` issued. Matches
 * `packages/server/src/server/bootstrap.ts`'s `app.get("/api/files/
 * download", ...)` route exactly: a `token` query parameter, nothing
 * else — never the file's name or path (see this module's "no file
 * bytes, filename or path in a ... URL query string" invariant). Built
 * with plain string concatenation rather than the `URL` global (unlike
 * web's `buildFileDownloadUrl`) so this stays usable from the same
 * plain Node `vitest` environment as every other pure function in this
 * file, with no assumption about which JS engine's globals are present.
 */
export function buildFileDownloadUrl(origin: string, token: string): string {
  const trimmedOrigin = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${trimmedOrigin}/api/files/download?token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// File mutation ops (mkdir/create/rename/delete)
// ---------------------------------------------------------------------------

/**
 * Sentinel error message `createFileOpsController` (`file-ops-model.ts`)
 * rejects with when the injected `FileBrowserClient` has no `mkdir`/
 * `createFile`/`renameEntry`/`deleteEntry` at all — a pre-ops test double
 * or a real client not yet wired to a daemon. Mirrors web's
 * `FILE_OPS_NOT_CONNECTED` (`apps/web/src/features/files/
 * file-ops-client.ts`), so `explainFileOpsError` can give it a dedicated
 * explanation instead of falling through to the generic message.
 */
export const FILE_OPS_NOT_CONNECTED = "FILE_OPS_NOT_CONNECTED";

/**
 * Maps a raw daemon `mkdir`/`createFile`/`renameEntry`/`deleteEntry`
 * rejection (an `Error.message`) to a title and description a user can
 * act on. Covers the shared `fs` errors and workspace guards
 * `explainFileBrowserError` knows, plus this surface's own guards
 * (`packages/server/src/server/file-explorer/service.ts`): the three
 * root guards, "Destination already exists", "Directory is not
 * empty", and "Requested path does not exist". Matches web's
 * `explainFileOpsError` (`apps/web/src/features/files/
 * file-ops-client.ts`) vocabulary, including the not-connected
 * sentinel above.
 */
export function explainFileOpsError(rawMessage: string): FileBrowserErrorExplanation {
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
