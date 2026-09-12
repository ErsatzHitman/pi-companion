/**
 * Workspace file mutation state and orchestration (T35A5, plan.md
 * §6/§7/§9/§12.4, depends on T35A3).
 *
 * Mutation-side sibling of `files-model.ts`'s listing controller and
 * `file-edit-model.ts`'s write controller: same shape (`getState`,
 * `subscribe`, one named state per outcome) but wrapping the daemon's
 * four workspace file operations — create a folder, create a file,
 * rename/move, delete — rather than listing a directory or saving one
 * file's bytes. This module imports neither React, React Native, Expo,
 * DOM types, nor browser globals — plain, RN-free orchestration over the
 * injected `FileBrowserClient` members `mkdir`/`createFile`/
 * `renameEntry`/`deleteEntry` (`file-browser-client.ts`), testable
 * directly in this workspace's plain `vitest`.
 *
 * No wire shape is invented here: each member matches its
 * `DaemonClient` counterpart exactly (see that interface's own docs for
 * the `fs.file.mkdir`/`fs.file.create`/`fs.file.rename`/`fs.file.delete`
 * message names), and every failure — a rejected RPC for a missing path,
 * an occupied destination, a non-empty directory, one of the root guards,
 * or a transport/not-connected sentinel — is mapped through
 * `explainFileOpsError` rather than rendered raw.
 *
 * ---------------------------------------------------------------------
 * Deleting is two-step on this platform (this task's real content)
 * ---------------------------------------------------------------------
 * `apps/web`'s `use-file-ops.ts` never prompts: its panel owns a modal
 * `Dialog` and only the dialog's confirm reaches `deleteEntry`
 * (`apps/web/src/features/files/file-ops-panel.tsx`). This controller
 * moves that gate into the model instead, so the confirm is part of the
 * state machine rather than local component state a re-render could
 * drop:
 *
 *   - `armDelete(path, recursive?)` is purely local. It records the
 *     pending target (and whether the caller meant a recursive delete)
 *     and issues NO daemon request.
 *   - `confirmDelete()` is the only path that ever calls
 *     `deleteEntry`. It consumes the armed target and passes the armed
 *     `recursive` flag — so `recursive: true` can only ever reach the
 *     daemon after an explicit confirm, never speculatively.
 *   - `cancelDelete()` disarms without touching the daemon.
 *
 * A confirm with nothing armed is a no-op, matching this file family's
 * "guard, don't guess" shape (`file-edit-model.ts`'s `save()` no-ops
 * outside `"edit"` mode). A failed delete clears the armed state along
 * with every other outcome, so a stale confirmation can never be
 * re-confirmed against a target the user has since moved on from — the
 * panel's error banner is the feedback, and re-arming is one press.
 *
 * A successful operation calls `onChanged()` so the caller can reload
 * whatever listing it is showing: the daemon is authoritative, so the
 * new directory entry has to be read back rather than optimistically
 * invented. A failed one never calls it — there is nothing new to read.
 */
import {
  FILE_OPS_NOT_CONNECTED,
  explainFileOpsError,
  type FileBrowserClient,
  type FileBrowserErrorExplanation,
} from "./file-browser-client.js";

/** Re-exported so a caller or test can name the sentinel `createFileOpsController` rejects a missing client member with without reaching into `file-browser-client.ts` directly. Mirrors `file-download-model.ts`'s own `FILE_DOWNLOAD_CANCELLED` re-export. */
export { FILE_OPS_NOT_CONNECTED };

export type FileOpsOperation = "mkdir" | "create-file" | "rename" | "delete";

export type FileOpsStatus = "idle" | "running" | "success" | "error";

/**
 * A delete target recorded by `armDelete` and consumed by
 * `confirmDelete`. `recursive` is captured at arm time so the eventual
 * `deleteEntry(cwd, path, recursive)` call reflects exactly the
 * confirmation the user was shown, never a value re-read later.
 */
export interface PendingFileDelete {
  readonly path: string;
  readonly recursive: boolean;
}

export interface FileOpsState {
  readonly status: FileOpsStatus;
  /** Which of the four operations the current state belongs to, or `null` when idle. */
  readonly operation: FileOpsOperation | null;
  /** Plain-language summary of the last successful operation, or `null`. */
  readonly message: string | null;
  readonly error: FileBrowserErrorExplanation | null;
  /** The armed, not-yet-confirmed delete — `null` whenever no confirm dialog should be visible. */
  readonly pendingDelete: PendingFileDelete | null;
}

const IDLE_STATE: FileOpsState = {
  status: "idle",
  operation: null,
  message: null,
  error: null,
  pendingDelete: null,
};

export interface FileOpsControllerOptions {
  /** Injected daemon RPC transport. Its four mutation members are optional — a missing one is treated as "not connected" (see `createFileOpsController`). */
  client: FileBrowserClient;
  /** The daemon-side workspace root every operation is scoped to (protocol `cwd`). */
  workspaceRoot: string;
  /** Invoked exactly once after any operation resolves successfully, so a listing can reload. Never called on a failure. */
  onChanged?: () => void;
}

export interface FileOpsController {
  getState: () => FileOpsState;
  subscribe: (listener: (state: FileOpsState) => void) => () => void;
  /** Creates a directory (and missing parents) at a workspace-relative path. */
  mkdir: (path: string) => void;
  /** Creates a file at a workspace-relative path, with optional initial content. Never clobbers. */
  createFile: (path: string, content?: string) => void;
  /** Renames/moves an entry within the workspace. */
  rename: (oldPath: string, newPath: string) => void;
  /** Records a delete target WITHOUT calling the daemon — the first of two steps. */
  armDelete: (path: string, recursive?: boolean) => void;
  /** Performs the armed delete, passing its captured `recursive` flag. No-op when nothing is armed. */
  confirmDelete: () => void;
  /** Disarms a pending delete without touching the daemon. */
  cancelDelete: () => void;
  /** Clears the result/error back to `"idle"`. */
  reset: () => void;
}

/** The single rejection a missing optional client member produces, so every op fails the same way `file-edit-model.ts`'s missing `writeFile` does. */
function notConnected(): Promise<never> {
  return Promise.reject(new Error(FILE_OPS_NOT_CONNECTED));
}

/**
 * Builds a `FileOpsController` — the injected-fake-daemon-RPC seam
 * `file-ops-model.test.ts` drives directly to prove all four operations'
 * success paths, every named error explanation, the two-step delete, and
 * the reload-on-success contract, with no emulator and no
 * `react-native` import.
 */
export function createFileOpsController(options: FileOpsControllerOptions): FileOpsController {
  const { client, workspaceRoot, onChanged } = options;

  let state: FileOpsState = IDLE_STATE;
  const listeners = new Set<(state: FileOpsState) => void>();

  const emit = () => {
    for (const listener of listeners) listener(state);
  };

  const run = (operation: FileOpsOperation, action: () => Promise<void>, message: string) => {
    // One operation at a time: a second submit while the first is in
    // flight is ignored rather than racing it (the panel also disables
    // its buttons while running, so this is the model's own backstop).
    if (state.status === "running") return;
    state = { ...IDLE_STATE, status: "running", operation };
    emit();

    action().then(
      () => {
        state = { ...IDLE_STATE, status: "success", operation, message };
        emit();
        onChanged?.();
      },
      (error: unknown) => {
        const raw = error instanceof Error ? error.message : String(error);
        state = { ...IDLE_STATE, status: "error", operation, error: explainFileOpsError(raw) };
        emit();
      },
    );
  };

  const mkdir = (path: string) => {
    const mkdirMember = client.mkdir;
    run(
      "mkdir",
      mkdirMember
        ? () => mkdirMember(workspaceRoot, path).then(() => undefined)
        : () => notConnected(),
      `Created folder ${path}`,
    );
  };

  const createFile = (path: string, content?: string) => {
    const createFileMember = client.createFile;
    run(
      "create-file",
      createFileMember
        ? () => createFileMember(workspaceRoot, path, content).then(() => undefined)
        : () => notConnected(),
      `Created file ${path}`,
    );
  };

  const rename = (oldPath: string, newPath: string) => {
    const renameMember = client.renameEntry;
    run(
      "rename",
      renameMember
        ? () => renameMember(workspaceRoot, oldPath, newPath).then(() => undefined)
        : () => notConnected(),
      `Renamed ${oldPath} to ${newPath}`,
    );
  };

  const armDelete = (path: string, recursive = false) => {
    if (state.status === "running") return;
    state = { ...IDLE_STATE, pendingDelete: { path, recursive } };
    emit();
  };

  const confirmDelete = () => {
    const pending = state.pendingDelete;
    if (!pending) return;
    const deleteMember = client.deleteEntry;
    run(
      "delete",
      deleteMember
        ? () => deleteMember(workspaceRoot, pending.path, pending.recursive).then(() => undefined)
        : () => notConnected(),
      `Deleted ${pending.path}`,
    );
  };

  const cancelDelete = () => {
    if (!state.pendingDelete) return;
    state = { ...state, pendingDelete: null };
    emit();
  };

  const reset = () => {
    state = IDLE_STATE;
    emit();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mkdir,
    createFile,
    rename,
    armDelete,
    confirmDelete,
    cancelDelete,
    reset,
  };
}
