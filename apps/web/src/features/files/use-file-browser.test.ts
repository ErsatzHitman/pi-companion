import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileBrowserClient, FileBrowserDirectory } from "./file-browser-client.js";
import { PATH_OUTSIDE_WORKSPACE_MESSAGE } from "./path-authorization.js";
import { useFileBrowser } from "./use-file-browser.js";

function directory(path: string): FileBrowserDirectory {
  return {
    path,
    entries: [
      {
        name: "src",
        path: path ? `${path}/src` : "src",
        kind: "directory",
        size: 0,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        name: "README.md",
        path: path ? `${path}/README.md` : "README.md",
        kind: "file",
        size: 128,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function fakeClient(
  impl: (cwd: string, path: string) => Promise<FileBrowserDirectory>,
): FileBrowserClient {
  return { listDirectory: impl };
}

describe("useFileBrowser (T30B1)", () => {
  it("loads the given path and transitions loading -> ready", async () => {
    const client = fakeClient(async (_cwd, path) => directory(path));
    const { result } = renderHook(() =>
      useFileBrowser({ client, workspaceRoot: "/workspace", path: "" }),
    );

    expect(result.current.state.status).toBe("loading");

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.directory?.path).toBe("");
    expect(result.current.state.directory?.entries).toHaveLength(2);
  });

  it("re-lists when the path prop changes (route navigation)", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => directory(path));
    const client = fakeClient(listDirectory);
    const { result, rerender } = renderHook(
      ({ path }) => useFileBrowser({ client, workspaceRoot: "/workspace", path }),
      { initialProps: { path: "" } },
    );

    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    rerender({ path: "src" });

    expect(result.current.state.status).toBe("loading");
    expect(result.current.state.path).toBe("src");
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.directory?.path).toBe("src");
    expect(listDirectory).toHaveBeenCalledWith("/workspace", "src");
  });

  it("normalizes a path with leading/trailing/duplicate slashes", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => directory(path));
    const client = fakeClient(listDirectory);
    renderHook(() => useFileBrowser({ client, workspaceRoot: "/workspace", path: "/a//b/" }));

    await waitFor(() => expect(listDirectory).toHaveBeenCalledWith("/workspace", "a/b"));
  });

  it("explains a daemon error and clears it on retry success", async () => {
    let attempt = 0;
    const client = fakeClient(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("EACCES: permission denied, scandir '/workspace/secret'");
      }
      return directory("");
    });
    const { result } = renderHook(() =>
      useFileBrowser({ client, workspaceRoot: "/workspace", path: "" }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.title).toMatch(/permission denied/i);
    expect(result.current.state.error?.raw).toMatch(/EACCES/);

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.error).toBeNull();
  });

  it("ignores a stale response after the path changes before it resolves", async () => {
    // resolvers[0] is the initial ("") load; [1] is "first"; [2] is "second".
    const resolvers: Array<() => void> = [];
    const client = fakeClient(
      (_cwd, path) =>
        new Promise<FileBrowserDirectory>((resolve) => {
          resolvers.push(() => resolve(directory(path)));
        }),
    );
    const { result, rerender } = renderHook(
      ({ path }) => useFileBrowser({ client, workspaceRoot: "/workspace", path }),
      { initialProps: { path: "" } },
    );

    rerender({ path: "first" });
    rerender({ path: "second" });
    expect(resolvers).toHaveLength(3);

    // Resolve the current ("second") request first.
    act(() => {
      resolvers[2]?.();
    });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.path).toBe("second");

    // The stale "first" request resolving afterwards must not clobber it.
    act(() => {
      resolvers[1]?.();
    });
    expect(result.current.state.path).toBe("second");
    expect(result.current.state.status).toBe("ready");
  });

  // T144: deliberately redundant with `path-authorization.test.ts`'s own
  // "every file-access entry point" coverage — this suite's job is to fail
  // HERE, in this file's own `npx vitest run`, if `useFileBrowser` ever
  // stops calling `authorizeWorkspacePath` before `listDirectory`, without
  // relying on the sibling suite to notice. Do not delete as "already
  // tested elsewhere".
  it("T144: denies an escaping path and never calls listDirectory", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => directory(path));
    const client = fakeClient(listDirectory);

    const { result } = renderHook(() =>
      useFileBrowser({ client, workspaceRoot: "/workspace", path: "../outside" }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.raw).toBe(PATH_OUTSIDE_WORKSPACE_MESSAGE);
    expect(listDirectory).not.toHaveBeenCalled();
  });
});
