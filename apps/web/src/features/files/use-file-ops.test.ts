import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileOpsClient } from "./file-ops-client.js";
import { useFileOps } from "./use-file-ops.js";

function fakeClient(overrides: Partial<FileOpsClient> = {}): FileOpsClient {
  return {
    mkdir: vi.fn(async () => ({ path: "src" })),
    createFile: vi.fn(async () => ({ path: "src/notes.md" })),
    renameEntry: vi.fn(async () => ({ oldPath: "a.txt", newPath: "b.txt" })),
    deleteEntry: vi.fn(async () => ({ path: "a.txt" })),
    ...overrides,
  };
}

describe("useFileOps", () => {
  it("starts idle with no operation", () => {
    const { result } = renderHook(() =>
      useFileOps({ client: fakeClient(), workspaceRoot: "/work" }),
    );
    expect(result.current.state).toEqual({
      status: "idle",
      operation: null,
      message: null,
      error: null,
    });
  });

  it("mkdir authorizes the path and calls the client with the workspace root", async () => {
    const mkdir = vi.fn(async () => ({ path: "src" }));
    const onChanged = vi.fn();
    const { result } = renderHook(() =>
      useFileOps({ client: fakeClient({ mkdir }), workspaceRoot: "/work", onChanged }),
    );

    act(() => result.current.mkdir("src"));

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(mkdir).toHaveBeenCalledWith("/work", "src");
    expect(result.current.state.message).toMatch(/Created folder src/);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("createFile passes the optional initial content", async () => {
    const createFile = vi.fn(async () => ({ path: "notes.md" }));
    const { result } = renderHook(() =>
      useFileOps({ client: fakeClient({ createFile }), workspaceRoot: "/work" }),
    );

    act(() => result.current.createFile("notes.md", "hello"));

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(createFile).toHaveBeenCalledWith("/work", "notes.md", "hello");
  });

  it("rename authorizes both the old and new paths", async () => {
    const renameEntry = vi.fn(async () => ({ oldPath: "a.txt", newPath: "b.txt" }));
    const { result } = renderHook(() =>
      useFileOps({ client: fakeClient({ renameEntry }), workspaceRoot: "/work" }),
    );

    act(() => result.current.rename("a.txt", "b.txt"));

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(renameEntry).toHaveBeenCalledWith("/work", "a.txt", "b.txt");
  });

  it("deleteEntry passes the recursive flag through", async () => {
    const deleteEntry = vi.fn(async () => ({ path: "src" }));
    const { result } = renderHook(() =>
      useFileOps({ client: fakeClient({ deleteEntry }), workspaceRoot: "/work" }),
    );

    act(() => result.current.deleteEntry("src", true));

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(deleteEntry).toHaveBeenCalledWith("/work", "src", true);
  });

  it("explains a daemon rejection through explainFileOpsError", async () => {
    const deleteEntry = vi.fn(async () => {
      throw new Error("Directory is not empty");
    });
    const { result } = renderHook(() =>
      useFileOps({ client: fakeClient({ deleteEntry }), workspaceRoot: "/work" }),
    );

    act(() => result.current.deleteEntry("src"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.title).toMatch(/isn't empty/i);
  });

  it("refuses an escape-shaped path before ever calling the client", async () => {
    const mkdir = vi.fn(async () => ({ path: "x" }));
    const { result } = renderHook(() =>
      useFileOps({ client: fakeClient({ mkdir }), workspaceRoot: "/work" }),
    );

    act(() => result.current.mkdir("../escape"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(mkdir).not.toHaveBeenCalled();
    expect(result.current.state.error?.title).toMatch(/outside the workspace/i);
  });

  it("does not reload the listing when the operation fails", async () => {
    const mkdir = vi.fn(async () => {
      throw new Error("Destination already exists");
    });
    const onChanged = vi.fn();
    const { result } = renderHook(() =>
      useFileOps({ client: fakeClient({ mkdir }), workspaceRoot: "/work", onChanged }),
    );

    act(() => result.current.mkdir("src"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reset returns to idle", async () => {
    const { result } = renderHook(() =>
      useFileOps({ client: fakeClient(), workspaceRoot: "/work" }),
    );

    act(() => result.current.mkdir("src"));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    act(() => result.current.reset());
    expect(result.current.state).toEqual({
      status: "idle",
      operation: null,
      message: null,
      error: null,
    });
  });
});
