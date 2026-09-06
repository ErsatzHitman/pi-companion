/**
 * File browser directory-listing state (T30B1).
 *
 * The current path is owned by the route (`/h/:serverId/session/:agentId
 * /files/*`'s `_splat`, plan.md §8.2), not by this hook: directory rows
 * and breadcrumbs are real `@tanstack/react-router` `Link`s (see
 * `file-browser-entry-list.tsx`/`file-browser-breadcrumbs.tsx`) so
 * navigation is a real URL change — deep-linkable, back/forward-able,
 * and bookmarkable — rather than component-local state the URL can get
 * out of sync with. This hook only reacts to `path` changing and issues
 * the daemon listing for it.
 *
 * This is React state-management glue, not DOM rendering; it stays in
 * `apps/web` rather than `@picompanion/frontend-core` because the
 * `files/` domain there is still T14's ownership-guarded stub (see
 * `packages/frontend-core/src/files/index.ts` and
 * `packages/frontend-core/src/index.test.ts`'s `FILES_DOMAIN_STUB`
 * assertion) — no task in this wave adds real logic there.
 */
import { useEffect, useRef, useState } from "react";

import type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserErrorExplanation,
} from "./file-browser-client.js";
import { explainFileBrowserError } from "./file-browser-client.js";
import { authorizeWorkspacePath, PathAuthorizationError } from "./path-authorization.js";

export interface UseFileBrowserOptions {
  client: FileBrowserClient;
  /** The daemon-side workspace root this listing is scoped to (protocol `cwd`). */
  workspaceRoot: string;
  /** The path to list, relative to the workspace root (`""` is the root). */
  path: string;
}

export type FileBrowserStatus = "loading" | "ready" | "error";

export interface FileBrowserError extends FileBrowserErrorExplanation {
  /** The daemon's original, untranslated error message. */
  raw: string;
}

export interface FileBrowserState {
  path: string;
  status: FileBrowserStatus;
  directory: FileBrowserDirectory | null;
  error: FileBrowserError | null;
}

export interface FileBrowserController {
  state: FileBrowserState;
  /** Re-issues the listing request for the current path. */
  retry: () => void;
}

/** Strips empty/`"."` segments so equivalent paths compare and dedupe cleanly. */
export function normalizeFileBrowserPath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

export function useFileBrowser(options: UseFileBrowserOptions): FileBrowserController {
  const { client, workspaceRoot } = options;
  const path = normalizeFileBrowserPath(options.path);
  const [state, setState] = useState<FileBrowserState>({
    path,
    status: "loading",
    directory: null,
    error: null,
  });
  const requestIdRef = useRef(0);
  // Bumped by `retry()` to force a reload of an unchanged `path` even
  // though it is not itself a new value the effect below would react to.
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState({ path, status: "loading", directory: null, error: null });

    // T41A1a: the single path-authorization door. `path` is canonicalized
    // and rejected here — before `client.listDirectory` is ever called —
    // regardless of whether it came from a route splat, a breadcrumb, or
    // any future caller of this hook.
    let authorizedPath: string;
    try {
      authorizedPath = authorizeWorkspacePath(path).path;
    } catch (error) {
      const raw = error instanceof PathAuthorizationError ? error.message : String(error);
      setState({
        path,
        status: "error",
        directory: null,
        error: { ...explainFileBrowserError(raw), raw },
      });
      return;
    }

    client.listDirectory(workspaceRoot, authorizedPath).then(
      (directory) => {
        if (requestIdRef.current !== requestId) return;
        setState({ path, status: "ready", directory, error: null });
      },
      (error: unknown) => {
        if (requestIdRef.current !== requestId) return;
        const raw = error instanceof Error ? error.message : String(error);
        setState({
          path,
          status: "error",
          directory: null,
          error: { ...explainFileBrowserError(raw), raw },
        });
      },
    );
    // `retryToken` intentionally participates only to force a re-run;
    // its value is never read.
  }, [client, workspaceRoot, path, retryToken]);

  return {
    state,
    retry: () => setRetryToken((token) => token + 1),
  };
}
