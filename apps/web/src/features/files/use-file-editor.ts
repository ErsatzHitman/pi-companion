/**
 * Editing and save state for a single open text file (T30B3, plan.md
 * §12.4). Layers on top of `useFileExplorer`'s `state.file` — this hook
 * does not itself fetch or list anything; it owns the edit buffer, the
 * save request, and turning a failed save into an explanation without
 * ever discarding the buffer.
 *
 * The daemon is authoritative (plan.md §12.5): a successful save does
 * not locally echo the new bytes back into view. Instead `onSaved` is
 * expected to be `useFileExplorer`'s `retry()`, which re-reads the file
 * from the daemon, so what is shown afterwards is what the daemon
 * actually persisted, not just what the client believes it sent.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { FileReadResult } from "./file-read-client.js";
import type {
  FileWriteClient,
  FileWriteConflictVersion,
  FileWriteErrorExplanation,
} from "./file-write-client.js";
import { explainFileWriteError, explainFileWriteResult } from "./file-write-client.js";
import { authorizeWorkspacePath, PathAuthorizationError } from "./path-authorization.js";

export type FileEditorMode = "read" | "edit" | "saving";

export interface FileEditorState {
  mode: FileEditorMode;
  /**
   * The in-progress edit buffer. Empty and meaningless while
   * `mode === "read"`; populated from the file's decoded text on
   * `startEditing` and preserved across a failed save.
   */
  buffer: string;
  error: FileEditorErrorState | null;
  /**
   * True once the daemon-backed `file` prop this edit is based on has
   * been re-read with a different `modifiedAt`/`revision` than the one
   * `startEditing` pinned (T41A1b) — most commonly a reconnect-driven
   * reload bumping `useFileExplorer`'s `retryToken`, but any re-read of
   * the same path has the same effect. Purely informational: `save()`
   * always writes against the PINNED basis (see `startEditing`), never
   * this live value, so the buffer is never discarded and a write this
   * flag fails to warn about still lands as a `"conflict"`
   * `FileWriteResult` rather than a silent overwrite. Sticky until the
   * edit session ends (`save` succeeds or `cancelEditing` runs) so a
   * user who doesn't notice it immediately doesn't lose it to a later,
   * unrelated re-render. CORRECTED (T41A2): this used to say "building an
   * actual reload/merge flow around this is T41A2's job, not this hook's" —
   * T41A2 built that flow, and part of it (`rebase`, below) lives in this
   * hook: `FileConflictResolutionPanel` calls it to re-pin the basis onto
   * the daemon's current version before "Keep mine" or "Merge by hand"
   * proceeds.
   */
  remoteChanged: boolean;
}

export interface FileEditorErrorState extends FileWriteErrorExplanation {
  /** `true` for a lost optimistic-concurrency race or deleted file (`FileWriteResult` `"conflict"`); `false` for any other save failure. */
  isConflict: boolean;
  /**
   * The daemon's authoritative version as of the failed write, present
   * only when `isConflict` is true. This is the WHOLE payload a
   * `"conflict"` `FileWriteResult` carries (`file-write-client.ts`'s
   * `FileWriteConflictVersion`): `cwd`, `path`, `size`, `modifiedAt`, and
   * (when available) `revision` — it does NOT include the remote file's
   * bytes. T41A2's resolution flow (`file-conflict-resolution-panel.tsx`)
   * re-reads the file through `FileReadClient` to get actual content to
   * show; this field only supplies the fresh basis to rebase onto.
   */
  conflictVersion?: FileWriteConflictVersion;
}

export interface UseFileEditorOptions {
  writeClient: FileWriteClient;
  /** The daemon-side workspace root (protocol `cwd`) this file belongs to. */
  workspaceRoot: string;
  /** The currently loaded, read-only file (`useFileExplorer`'s `state.file`). */
  file: FileReadResult;
  /** Reloads `file` from the daemon; called once a save is confirmed written. */
  onSaved: () => void;
}

export interface FileEditorController {
  state: FileEditorState;
  /** Enters edit mode, seeding the buffer from `file`'s current decoded content. */
  startEditing: () => void;
  /** Discards the buffer and returns to read mode. No-op once a save is in flight. */
  cancelEditing: () => void;
  /** Updates the buffer while editing. No-op outside edit mode. */
  updateBuffer: (next: string) => void;
  /** Saves the current buffer. No-op unless `mode === "edit"`. */
  save: () => void;
  /**
   * Rebases the PINNED write basis (`basisRef`) onto a fresher known
   * version — T41A2's conflict resolution flow calls this once the user
   * has decided how to proceed (e.g. onto the version a `"conflict"`
   * result carried), so the next `save()` is checked against that
   * version instead of repeating the same conflict. Never touches
   * `buffer` — only `save()`'s next optimistic-concurrency target moves
   * — and clears `error`/`remoteChanged` since both describe the STALE
   * basis being replaced. No-op outside `mode === "edit"`.
   */
  rebase: (basis: { modifiedAt: string; revision?: string }) => void;
}

/**
 * Decodes a `FileReadResult`'s raw bytes the same way this hook seeds
 * its edit buffer. Exported so `FileDiffView` (T30B6) can compare the
 * file's last-saved text against the live edit buffer without
 * duplicating the decode step or reaching into this hook's internals.
 */
export function decodeFileText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

const decodeText = decodeFileText;

const READ_STATE: FileEditorState = { mode: "read", buffer: "", error: null, remoteChanged: false };

/** The optimistic-concurrency basis `save()` writes against — pinned once, at `startEditing`. */
interface EditBasis {
  readonly modifiedAt: string;
  readonly revision: string | undefined;
}

export function useFileEditor(options: UseFileEditorOptions): FileEditorController {
  const { writeClient, workspaceRoot, file, onSaved } = options;
  const [state, setState] = useState<FileEditorState>(READ_STATE);

  // Navigating to a different path (or a fresh read of the same path
  // after a reload) always returns to read mode: an in-progress edit of
  // one file's bytes should never be silently carried over as another
  // file's buffer.
  const filePathRef = useRef(file.path);
  useEffect(() => {
    if (filePathRef.current !== file.path) {
      filePathRef.current = file.path;
      setState(READ_STATE);
    }
  }, [file.path]);

  // T41A1b: the version this edit session is based on, pinned the moment
  // editing starts rather than read live off `file` at save time. `file`
  // comes from `useFileExplorer`, which re-reads from the daemon whenever
  // its `retryToken` bumps (a reconnect-driven reload, a manual retry) —
  // with no basis pin, a save issued after such a re-read would silently
  // adopt whatever the daemon returned as its "expected" version, walking
  // straight past the conflict check instead of tripping it.
  const basisRef = useRef<EditBasis | null>(null);

  const startEditing = useCallback(() => {
    basisRef.current = { modifiedAt: file.modifiedAt, revision: file.revision };
    setState({ mode: "edit", buffer: decodeText(file.bytes), error: null, remoteChanged: false });
  }, [file]);

  // Detects the daemon re-reading this same path with a version other
  // than the one pinned above — the "conflict token read live" gap this
  // task closes. Fires for ANY re-read while an edit is in flight, a
  // reconnect-driven one included: `useFileExplorer` has exactly one path
  // that updates `file` (its effect re-running, whatever bumped it), so
  // there is nothing reconnect-specific to special-case here. Purely
  // informational — `save()` below never reads this, it always uses
  // `basisRef.current` — so a missed or ignored notice still cannot
  // produce a silent overwrite; the daemon's own conflict check is the
  // backstop.
  useEffect(() => {
    const basis = basisRef.current;
    if (!basis) return;
    if (basis.modifiedAt === file.modifiedAt && basis.revision === file.revision) return;
    setState((prev) => (prev.mode === "read" ? prev : { ...prev, remoteChanged: true }));
  }, [file.modifiedAt, file.revision]);

  const cancelEditing = useCallback(() => {
    setState((prev) => (prev.mode === "saving" ? prev : READ_STATE));
  }, []);

  const updateBuffer = useCallback((next: string) => {
    setState((prev) => (prev.mode !== "edit" ? prev : { ...prev, buffer: next, error: null }));
  }, []);

  const save = useCallback(() => {
    if (state.mode !== "edit") return;
    const buffer = state.buffer;
    const remoteChanged = state.remoteChanged;
    setState({ mode: "saving", buffer, error: null, remoteChanged });

    // T41A1a: the single path-authorization door. `file.path` is
    // canonicalized and rejected here — before `writeClient.writeFile`
    // is ever called — even though it is normally already the
    // authorized path `useFileExplorer` produced; this hook does not
    // rely on that upstream guarantee holding for every future caller.
    let authorizedPath: string;
    try {
      authorizedPath = authorizeWorkspacePath(file.path).path;
    } catch (error) {
      const raw = error instanceof PathAuthorizationError ? error.message : String(error);
      setState({
        mode: "edit",
        buffer,
        error: { ...explainFileWriteError(raw), isConflict: false },
        remoteChanged,
      });
      return;
    }

    // T41A1b: the version this write is "expected" to be based on is the
    // PINNED basis from `startEditing`, never a live read of `file` here
    // — see `basisRef`'s docstring above for why.
    const basis = basisRef.current;
    writeClient
      .writeFile({
        cwd: workspaceRoot,
        path: authorizedPath,
        content: buffer,
        expectedModifiedAt: basis ? basis.modifiedAt : file.modifiedAt,
        expectedRevision: basis ? basis.revision : file.revision,
      })
      .then((result) => {
        const explanation = explainFileWriteResult(result);
        if (explanation) {
          setState({
            mode: "edit",
            buffer,
            error: {
              ...explanation,
              isConflict: result.status === "conflict",
              conflictVersion: result.status === "conflict" ? result.version : undefined,
            },
            remoteChanged,
          });
          return;
        }
        setState(READ_STATE);
        onSaved();
      })
      .catch((error: unknown) => {
        const raw = error instanceof Error ? error.message : String(error);
        setState({
          mode: "edit",
          buffer,
          error: { ...explainFileWriteError(raw), isConflict: false },
          remoteChanged,
        });
      });
    // `state` is intentionally a dependency: `save` must always close
    // over the buffer the user last typed, not one captured at mount.
  }, [state, writeClient, workspaceRoot, file, onSaved]);

  // T41A2: rebases the pinned basis without discarding the buffer. Only
  // meaningful while an edit (and, typically, its conflict error) is on
  // screen — a no-op in "read"/"saving" keeps this safe to wire directly
  // to a resolution action's click handler without its own mode guard.
  const rebase = useCallback((basis: { modifiedAt: string; revision?: string }) => {
    setState((prev) => {
      if (prev.mode !== "edit") return prev;
      basisRef.current = { modifiedAt: basis.modifiedAt, revision: basis.revision };
      return { ...prev, error: null, remoteChanged: false };
    });
  }, []);

  return { state, startEditing, cancelEditing, updateBuffer, save, rebase };
}
