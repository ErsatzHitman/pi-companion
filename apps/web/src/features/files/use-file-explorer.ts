/**
 * Directory-or-file state for the `/h/:serverId/session/:agentId/files/*`
 * route (T30B2). The route's splat is shared by both directory browsing
 * (T30B1) and file reading (this task): given a path, the daemon is the
 * only thing that knows whether it names a folder or a file, so this
 * hook probes with `client.listDirectory` first (T30B1's existing call)
 * and, only when the daemon's own "Requested path is not a directory"
 * guard fires, retries as `readClient.readFile`. Any other
 * `listDirectory` failure (ENOENT, permission, etc.) is reported as
 * before — unchanged from `useFileBrowser` — without ever calling
 * `readFile`.
 *
 * This two-step probe keeps `FileBrowserEntryList`'s file rows as plain
 * links to this same route (real, deep-linkable navigation, per
 * `use-file-browser.ts`'s docstring) with no special-cased "this is a
 * file" hint required from the caller, and keeps a direct deep link to a
 * file path working identically to following a link to it.
 */
import { useEffect, useRef, useState } from "react";

import type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserErrorExplanation,
} from "./file-browser-client.js";
import { explainFileBrowserError, isNotADirectoryError } from "./file-browser-client.js";
import type { FileReadClient, FileReadResult } from "./file-read-client.js";
import { explainFileReadError } from "./file-read-client.js";
import { authorizeWorkspacePath, PathAuthorizationError } from "./path-authorization.js";
import { normalizeFileBrowserPath } from "./use-file-browser.js";

export interface UseFileExplorerOptions {
  client: FileBrowserClient;
  readClient: FileReadClient;
  /** The daemon-side workspace root this listing/read is scoped to (protocol `cwd`). */
  workspaceRoot: string;
  /** The path to explore, relative to the workspace root (`""` is the root). */
  path: string;
}

export type FileExplorerStatus = "loading" | "directory" | "file" | "error";

export interface FileExplorerError extends FileBrowserErrorExplanation {
  /** The daemon's original, untranslated error message. */
  raw: string;
}

export interface FileExplorerState {
  path: string;
  status: FileExplorerStatus;
  directory: FileBrowserDirectory | null;
  file: FileReadResult | null;
  error: FileExplorerError | null;
}

export interface FileExplorerController {
  state: FileExplorerState;
  /** Re-issues the listing/read request for the current path. */
  retry: () => void;
}

function initialState(path: string): FileExplorerState {
  return { path, status: "loading", directory: null, file: null, error: null };
}

export function useFileExplorer(options: UseFileExplorerOptions): FileExplorerController {
  const { client, readClient, workspaceRoot } = options;
  const path = normalizeFileBrowserPath(options.path);
  const [state, setState] = useState<FileExplorerState>(() => initialState(path));
  const requestIdRef = useRef(0);
  // Bumped by `retry()` to force a reload of an unchanged `path` even
  // though it is not itself a new value the effect below would react to.
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const isStale = () => requestIdRef.current !== requestId;
    setState(initialState(path));

    // T41A1a: the single path-authorization door, applied before either
    // the listing probe or the file-read fallback below can reach a
    // client — both share the same authorized path.
    let authorizedPath: string;
    try {
      authorizedPath = authorizeWorkspacePath(path).path;
    } catch (error) {
      const raw = error instanceof PathAuthorizationError ? error.message : String(error);
      setState({
        path,
        status: "error",
        directory: null,
        file: null,
        error: { ...explainFileBrowserError(raw), raw },
      });
      return;
    }

    client.listDirectory(workspaceRoot, authorizedPath).then(
      (directory) => {
        if (isStale()) return;
        setState({ path, status: "directory", directory, file: null, error: null });
      },
      (listError: unknown) => {
        const rawListError = listError instanceof Error ? listError.message : String(listError);
        if (!isNotADirectoryError(rawListError)) {
          if (isStale()) return;
          setState({
            path,
            status: "error",
            directory: null,
            file: null,
            error: { ...explainFileBrowserError(rawListError), raw: rawListError },
          });
          return;
        }

        readClient.readFile(workspaceRoot, authorizedPath).then(
          (file) => {
            if (isStale()) return;
            setState({ path, status: "file", directory: null, file, error: null });
          },
          (readError: unknown) => {
            if (isStale()) return;
            const raw = readError instanceof Error ? readError.message : String(readError);
            setState({
              path,
              status: "error",
              directory: null,
              file: null,
              error: { ...explainFileReadError(raw), raw },
            });
          },
        );
      },
    );
    // `retryToken` intentionally participates only to force a re-run;
    // its value is never read.
  }, [client, readClient, workspaceRoot, path, retryToken]);

  return {
    state,
    retry: () => setRetryToken((token) => token + 1),
  };
}
