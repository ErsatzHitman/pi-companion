import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserEntry,
} from "./file-browser-client.js";
import { PATH_OUTSIDE_WORKSPACE_MESSAGE } from "./path-authorization.js";
import {
  FILE_SEARCH_MAX_DIRECTORIES_VISITED,
  FILE_SEARCH_MAX_RESULTS,
  useFileSearch,
} from "./use-file-search.js";

function entry(path: string, kind: FileBrowserEntry["kind"] = "file"): FileBrowserEntry {
  const name = path.split("/").at(-1) as string;
  return { name, path, kind, size: 12, modifiedAt: "2026-01-01T00:00:00.000Z" };
}

/** A tiny in-memory tree keyed by directory path (`""` is the root). */
function treeClient(tree: Record<string, FileBrowserEntry[]>): FileBrowserClient {
  return {
    listDirectory: async (_cwd: string, path: string): Promise<FileBrowserDirectory> => {
      const entries = tree[path];
      if (entries === undefined) {
        throw new Error(`ENOENT: no such directory '${path}'`);
      }
      return { path, entries };
    },
  };
}

// No debounce in tests unless a test opts in, so behaviour is exercised
// without needing fake timers.
const NO_DEBOUNCE = { debounceMs: 0 };

describe("useFileSearch (T30B5)", () => {
  it("starts idle with no query", () => {
    const client = treeClient({ "": [entry("README.md")] });
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );
    expect(result.current.state).toEqual({
      query: "",
      status: "idle",
      results: [],
      truncated: false,
      error: null,
    });
  });

  it("finds a nested match by walking subdirectories", async () => {
    const client = treeClient({
      "": [entry("src", "directory"), entry("README.md")],
      src: [entry("src/notes.ts"), entry("src/lib", "directory")],
      "src/lib": [entry("src/lib/util.ts")],
    });
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );

    act(() => result.current.setQuery("util"));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.state.results.map((r) => r.path)).toEqual(["src/lib/util.ts"]);
    expect(result.current.state.truncated).toBe(false);
  });

  it("matches case-insensitively against the entry name", async () => {
    const client = treeClient({ "": [entry("README.md")] });
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );

    act(() => result.current.setQuery("readme"));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.state.results).toHaveLength(1);
  });

  it("goes back to idle (not done-with-zero-results) when the query is cleared", async () => {
    const client = treeClient({ "": [entry("README.md")] });
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );

    act(() => result.current.setQuery("readme"));
    await waitFor(() => expect(result.current.state.status).toBe("done"));

    act(() => result.current.setQuery(""));
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.results).toEqual([]);
  });

  it("bounds the result count and reports truncation", async () => {
    const many = Array.from({ length: FILE_SEARCH_MAX_RESULTS + 10 }, (_, i) =>
      entry(`match-${String(i).padStart(3, "0")}.txt`),
    );
    const client = treeClient({ "": many });
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );

    act(() => result.current.setQuery("match"));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.state.results).toHaveLength(FILE_SEARCH_MAX_RESULTS);
    expect(result.current.state.truncated).toBe(true);
  });

  it("stops after visiting the maximum number of directories and reports truncation", async () => {
    // A directory chain deeper than the visit cap, none of which match.
    const depth = FILE_SEARCH_MAX_DIRECTORIES_VISITED + 5;
    const tree: Record<string, FileBrowserEntry[]> = {};
    let path = "";
    for (let i = 0; i < depth; i += 1) {
      const childPath = path ? `${path}/d${i}` : `d${i}`;
      tree[path] = [entry(childPath, "directory")];
      path = childPath;
    }
    tree[path] = [entry(path ? `${path}/needle.txt` : "needle.txt")];
    const client = treeClient(tree);
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );

    act(() => result.current.setQuery("needle"));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.state.truncated).toBe(true);
    expect(result.current.state.results).toHaveLength(0);
  });

  it("skips a nested directory that fails to list instead of aborting the whole search", async () => {
    const client: FileBrowserClient = {
      listDirectory: async (_cwd, path) => {
        if (path === "secret") throw new Error("EACCES: permission denied");
        if (path === "") {
          return {
            path,
            entries: [entry("secret", "directory"), entry("visible.txt")],
          };
        }
        throw new Error(`unexpected path ${path}`);
      },
    };
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );

    act(() => result.current.setQuery("visible"));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.state.results.map((r) => r.path)).toEqual(["visible.txt"]);
    expect(result.current.state.error).toBeNull();
  });

  it("reports an error when the search root itself fails to list", async () => {
    const client: FileBrowserClient = {
      listDirectory: async () => {
        throw new Error("EACCES: permission denied, scandir '/workspace'");
      },
    };
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );

    act(() => result.current.setQuery("anything"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.title).toMatch(/permission denied/i);
    expect(result.current.state.error?.raw).toMatch(/EACCES/);
  });

  it("retries the current query after an error", async () => {
    let attempt = 0;
    const client: FileBrowserClient = {
      listDirectory: async (_cwd, path) => {
        attempt += 1;
        if (attempt === 1) throw new Error("EACCES: permission denied");
        return { path, entries: [entry("README.md")] };
      },
    };
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );

    act(() => result.current.setQuery("readme"));
    await waitFor(() => expect(result.current.state.status).toBe("error"));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.state.results).toHaveLength(1);
  });

  it("ignores a stale response after the query changes again before it resolves", async () => {
    const resolvers: Array<(entries: FileBrowserEntry[]) => void> = [];
    const client: FileBrowserClient = {
      listDirectory: (_cwd, path) =>
        new Promise((resolve) => {
          resolvers.push((entries) => resolve({ path, entries }));
        }),
    };
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", ...NO_DEBOUNCE }),
    );

    act(() => result.current.setQuery("first"));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    act(() => result.current.setQuery("second"));
    await waitFor(() => expect(resolvers).toHaveLength(2));

    // The stale "first" request resolves after "second" was already typed.
    act(() => resolvers[0]?.([entry("first-match.txt")]));
    expect(result.current.state.status).toBe("searching");

    act(() => resolvers[1]?.([entry("second-match.txt")]));
    await waitFor(() => expect(result.current.state.status).toBe("done"));
    expect(result.current.state.results.map((r) => r.path)).toEqual(["second-match.txt"]);
  });

  it("debounces the query before searching", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => ({
      path,
      entries: [entry("readme.txt")],
    }));
    const client: FileBrowserClient = { listDirectory };
    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", debounceMs: 20 }),
    );

    act(() => result.current.setQuery("r"));
    act(() => result.current.setQuery("re"));
    act(() => result.current.setQuery("read"));

    // Only the last keystroke should ever fire a request.
    await waitFor(() => expect(result.current.state.status).toBe("done"), { timeout: 2000 });
    expect(listDirectory).toHaveBeenCalledTimes(1);
  });

  // T144: deliberately redundant with `path-authorization.test.ts`'s own
  // "every file-access entry point" coverage — this suite's job is to fail
  // HERE, in this file's own `npx vitest run`, if `useFileSearch`'s walker
  // ever stops calling `authorizeWorkspacePath` on a dequeued path before
  // `listDirectory`, without relying on the sibling suite to notice. This
  // is exactly the case the P6-W11 gate caught only in the sibling suite —
  // do not delete as "already tested elsewhere".
  it("T144: denies an escaping rootPath and never calls listDirectory", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => ({
      path,
      entries: [] as FileBrowserEntry[],
    }));
    const client: FileBrowserClient = { listDirectory };

    const { result } = renderHook(() =>
      useFileSearch({
        client,
        workspaceRoot: "/workspace",
        rootPath: "../outside",
        ...NO_DEBOUNCE,
      }),
    );

    act(() => result.current.setQuery("secret"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.raw).toBe(PATH_OUTSIDE_WORKSPACE_MESSAGE);
    expect(listDirectory).not.toHaveBeenCalled();
  });
});
