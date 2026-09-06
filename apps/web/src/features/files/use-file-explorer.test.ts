import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileBrowserClient, FileBrowserDirectory } from "./file-browser-client.js";
import type { FileReadClient, FileReadResult } from "./file-read-client.js";
import { PATH_OUTSIDE_WORKSPACE_MESSAGE } from "./path-authorization.js";
import { useFileExplorer } from "./use-file-explorer.js";

// Every `client`/`readClient` below is constructed *outside* the
// `renderHook` factory and passed in by stable reference. Building
// either inline inside the factory would hand the hook a new object
// identity on every render, which — since both are effect
// dependencies, matching `useFileBrowser`'s same pattern — refires the
// request forever (this bit a first draft of this file).

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
    ],
  };
}

function textResult(path: string): FileReadResult {
  return {
    path,
    kind: "text",
    bytes: new TextEncoder().encode("hello\n"),
    mime: "text/plain",
    size: 6,
    modifiedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("useFileExplorer (T30B2)", () => {
  it("loads a directory listing and transitions loading -> directory", async () => {
    const client: FileBrowserClient = { listDirectory: async (_cwd, path) => directory(path) };
    const readClient: FileReadClient = { readFile: vi.fn() };
    const { result } = renderHook(() =>
      useFileExplorer({ client, readClient, workspaceRoot: "/workspace", path: "" }),
    );

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("directory"));
    expect(result.current.state.directory?.entries).toHaveLength(1);
    expect(result.current.state.file).toBeNull();
    expect(readClient.readFile).not.toHaveBeenCalled();
  });

  it("falls back to reading a file when listDirectory reports 'not a directory'", async () => {
    const client: FileBrowserClient = {
      listDirectory: vi.fn(async () => {
        throw new Error("Requested path is not a directory");
      }),
    };
    const readClient: FileReadClient = {
      readFile: vi.fn(async (_cwd: string, path: string) => textResult(path)),
    };
    const { result } = renderHook(() =>
      useFileExplorer({ client, readClient, workspaceRoot: "/workspace", path: "README.md" }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("file"));
    expect(result.current.state.file?.path).toBe("README.md");
    expect(result.current.state.directory).toBeNull();
    expect(readClient.readFile).toHaveBeenCalledWith("/workspace", "README.md");
  });

  it("reports a non-'not a directory' listing error without calling readFile", async () => {
    const client: FileBrowserClient = {
      listDirectory: async () => {
        throw new Error("EACCES: permission denied, scandir '/workspace/secret'");
      },
    };
    const readClient: FileReadClient = { readFile: vi.fn() };
    const { result } = renderHook(() =>
      useFileExplorer({ client, readClient, workspaceRoot: "/workspace", path: "secret" }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.title).toBe("Permission denied");
    expect(readClient.readFile).not.toHaveBeenCalled();
  });

  it("reports a read error once the not-a-directory fallback fires", async () => {
    const client: FileBrowserClient = {
      listDirectory: async () => {
        throw new Error("Requested path is not a directory");
      },
    };
    const readClient: FileReadClient = {
      readFile: async () => {
        throw new Error("ENOENT: no such file or directory, open '/workspace/gone.ts'");
      },
    };
    const { result } = renderHook(() =>
      useFileExplorer({ client, readClient, workspaceRoot: "/workspace", path: "gone.ts" }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.title).toMatch(/no longer exists/i);
  });

  it("retries the current path and can recover from error to file", async () => {
    let attempt = 0;
    const client: FileBrowserClient = {
      listDirectory: async () => {
        throw new Error("Requested path is not a directory");
      },
    };
    const readClient: FileReadClient = {
      readFile: async (_cwd, path) => {
        attempt += 1;
        if (attempt === 1) throw new Error("EACCES: permission denied");
        return textResult(path);
      },
    };
    const { result } = renderHook(() =>
      useFileExplorer({ client, readClient, workspaceRoot: "/workspace", path: "notes.md" }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.state.status).toBe("file"));
    expect(result.current.state.file?.path).toBe("notes.md");
  });

  it("ignores a stale response after the path changes before it resolves", async () => {
    const resolvers: Array<() => void> = [];
    const client: FileBrowserClient = {
      listDirectory: (_cwd, path) =>
        new Promise<FileBrowserDirectory>((resolve) => {
          resolvers.push(() => resolve(directory(path)));
        }),
    };
    const readClient: FileReadClient = { readFile: vi.fn() };
    const { result, rerender } = renderHook(
      ({ path }) => useFileExplorer({ client, readClient, workspaceRoot: "/workspace", path }),
      { initialProps: { path: "" } },
    );

    rerender({ path: "first" });
    rerender({ path: "second" });
    expect(resolvers).toHaveLength(3);

    act(() => {
      resolvers[2]?.();
    });
    await waitFor(() => expect(result.current.state.status).toBe("directory"));
    expect(result.current.state.path).toBe("second");

    act(() => {
      resolvers[1]?.();
    });
    expect(result.current.state.path).toBe("second");
    expect(result.current.state.status).toBe("directory");
  });

  // T144: deliberately redundant with `path-authorization.test.ts`'s own
  // "every file-access entry point" coverage — this suite's job is to fail
  // HERE, in this file's own `npx vitest run`, if `useFileExplorer` ever
  // stops calling `authorizeWorkspacePath` before EITHER `listDirectory` or
  // its `readFile` fallback, without relying on the sibling suite to
  // notice. Do not delete as "already tested elsewhere".
  it("T144: denies an escaping path and never calls listDirectory or readFile", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => directory(path));
    const client: FileBrowserClient = { listDirectory };
    const readFile = vi.fn(async (): Promise<FileReadResult> => {
      throw new Error("should never be called");
    });
    const readClient: FileReadClient = { readFile };

    const { result } = renderHook(() =>
      useFileExplorer({
        client,
        readClient,
        workspaceRoot: "/workspace",
        path: "..\\..\\Windows\\System32\\config\\SAM",
      }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.raw).toBe(PATH_OUTSIDE_WORKSPACE_MESSAGE);
    expect(listDirectory).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });
});
