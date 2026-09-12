/**
 * File mutation state for the files feature (plan.md §12.4). Wraps the
 * daemon's four workspace file operations (`FileOpsClient.mkdir`/
 * `createFile`/`renameEntry`/`deleteEntry`) in the same
 * "running/success/error, retryable" shape `use-file-upload.ts` and
 * `use-file-editor.ts` already use for their own one-op surfaces.
 *
 * Every caller-supplied path goes through `authorizeWorkspacePath`
 * (`path-authorization.ts`) immediately before the request, with nothing
 * between that call and the client method invocation — the exact T41A1a
 * "single door" pattern `use-file-browser.ts`/`use-file-explorer.ts`/
 * `use-file-search.ts` already follow. A rejected path never reaches the
 * daemon; it is reported through the same `explainFileOpsError` mapping
 * a daemon-side rejection would be.
 *
 * A successful operation calls `onChanged()` so the browser can reload
 * the listing it is showing (the daemon is authoritative, so the new
 * directory entry has to be read back rather than optimistically
 * invented).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { FileOpsClient, FileOpsErrorExplanation } from "./file-ops-client.js";
import { explainFileOpsError } from "./file-ops-client.js";
import { authorizeWorkspacePath } from "./path-authorization.js";

export type FileOpsOperation = "mkdir" | "create-file" | "rename" | "delete";

export type FileOpsStatus = "idle" | "running" | "success" | "error";

export interface FileOpsState {
  status: FileOpsStatus;
  /** Which of the four operations the current state belongs to, or `null` when idle. */
  operation: FileOpsOperation | null;
  /** Plain-language summary of the last successful operation. */
  message: string | null;
  error: FileOpsErrorExplanation | null;
}

export interface UseFileOpsOptions {
  client: FileOpsClient;
  /** The daemon-side workspace root (protocol `cwd`) every operation is scoped to. */
  workspaceRoot: string;
  /** Invoked after any operation resolves successfully, so a listing can reload. */
  onChanged?: () => void;
}

export interface FileOpsController {
  state: FileOpsState;
  /** Creates a directory (and missing parents) at a workspace-relative path. */
  mkdir: (path: string) => void;
  /** Creates a file at a workspace-relative path, with optional initial content. */
  createFile: (path: string, content?: string) => void;
  /** Renames/moves an entry within the workspace. */
  rename: (oldPath: string, newPath: string) => void;
  /** Deletes a file or directory. Never prompts; the panel owns the confirmation. */
  deleteEntry: (path: string, recursive?: boolean) => void;
  /** Clears the result/error back to `"idle"`. */
  reset: () => void;
}

const IDLE_STATE: FileOpsState = { status: "idle", operation: null, message: null, error: null };

export function useFileOps(options: UseFileOpsOptions): FileOpsController {
  const { client, workspaceRoot, onChanged } = options;
  const [state, setState] = useState<FileOpsState>(IDLE_STATE);
  const mountedRef = useRef(true);
  // Kept in a ref so the operation callbacks below stay referentially
  // stable across a caller passing a fresh inline `onChanged` each render
  // (e.g. `FileBrowserView`'s `controller.retry` is stable, but a future
  // caller's may not be).
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const applyError = useCallback((operation: FileOpsOperation, raw: string) => {
    if (!mountedRef.current) return;
    setState({
      status: "error",
      operation,
      message: null,
      error: explainFileOpsError(raw),
    });
  }, []);

  const run = useCallback(
    (operation: FileOpsOperation, action: () => Promise<string>) => {
      setState({ status: "running", operation, message: null, error: null });
      action().then(
        (message) => {
          if (!mountedRef.current) return;
          setState({ status: "success", operation, message, error: null });
          onChangedRef.current?.();
        },
        (error: unknown) => {
          applyError(operation, error instanceof Error ? error.message : String(error));
        },
      );
    },
    [applyError],
  );

  const mkdir = useCallback(
    (path: string) => {
      let authorized: string;
      try {
        authorized = authorizeWorkspacePath(path).path;
      } catch (error) {
        applyError("mkdir", error instanceof Error ? error.message : String(error));
        return;
      }
      run("mkdir", async () => {
        await client.mkdir(workspaceRoot, authorized);
        return `Created folder ${authorized}`;
      });
    },
    [client, workspaceRoot, run, applyError],
  );

  const createFile = useCallback(
    (path: string, content?: string) => {
      let authorized: string;
      try {
        authorized = authorizeWorkspacePath(path).path;
      } catch (error) {
        applyError("create-file", error instanceof Error ? error.message : String(error));
        return;
      }
      run("create-file", async () => {
        await client.createFile(workspaceRoot, authorized, content);
        return `Created file ${authorized}`;
      });
    },
    [client, workspaceRoot, run, applyError],
  );

  const rename = useCallback(
    (oldPath: string, newPath: string) => {
      let authorizedOld: string;
      let authorizedNew: string;
      try {
        authorizedOld = authorizeWorkspacePath(oldPath).path;
        authorizedNew = authorizeWorkspacePath(newPath).path;
      } catch (error) {
        applyError("rename", error instanceof Error ? error.message : String(error));
        return;
      }
      run("rename", async () => {
        await client.renameEntry(workspaceRoot, authorizedOld, authorizedNew);
        return `Renamed ${authorizedOld} to ${authorizedNew}`;
      });
    },
    [client, workspaceRoot, run, applyError],
  );

  const deleteEntry = useCallback(
    (path: string, recursive?: boolean) => {
      let authorized: string;
      try {
        authorized = authorizeWorkspacePath(path).path;
      } catch (error) {
        applyError("delete", error instanceof Error ? error.message : String(error));
        return;
      }
      run("delete", async () => {
        await client.deleteEntry(workspaceRoot, authorized, recursive);
        return `Deleted ${authorized}`;
      });
    },
    [client, workspaceRoot, run, applyError],
  );

  const reset = useCallback(() => setState(IDLE_STATE), []);

  return { state, mkdir, createFile, rename, deleteEntry, reset };
}
