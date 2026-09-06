import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileReadResult } from "./file-read-client.js";
import type { FileWriteClient, FileWriteResult } from "./file-write-client.js";
import { useFileEditor } from "./use-file-editor.js";

const OUTSIDE_WORKSPACE_DESCRIPTION = "outside the folders the daemon shares";

function textFile(overrides: Partial<FileReadResult> = {}): FileReadResult {
  return {
    path: "src/index.ts",
    kind: "text",
    bytes: new TextEncoder().encode("export const answer = 42;\n"),
    mime: "text/plain",
    size: 27,
    modifiedAt: "2026-02-01T12:00:00.000Z",
    revision: "rev-1",
    ...overrides,
  };
}

const WRITTEN: FileWriteResult = {
  status: "written",
  modifiedAt: "2026-02-02T00:00:00.000Z",
  size: 30,
};

describe("useFileEditor (T30B3)", () => {
  it("starts in read mode with an empty buffer", () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: textFile(), onSaved }),
    );

    expect(result.current.state.mode).toBe("read");
    expect(result.current.state.buffer).toBe("");
    expect(result.current.state.error).toBeNull();
  });

  it("seeds the buffer from the file's decoded bytes on startEditing", () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: textFile(), onSaved }),
    );

    act(() => result.current.startEditing());

    expect(result.current.state.mode).toBe("edit");
    expect(result.current.state.buffer).toBe("export const answer = 42;\n");
  });

  it("updateBuffer is a no-op outside edit mode", () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: textFile(), onSaved }),
    );

    act(() => result.current.updateBuffer("changed"));
    expect(result.current.state.mode).toBe("read");
    expect(result.current.state.buffer).toBe("");
  });

  it("cancelEditing discards the buffer and returns to read mode", () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: textFile(), onSaved }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.updateBuffer("export const answer = 43;\n"));
    act(() => result.current.cancelEditing());

    expect(result.current.state.mode).toBe("read");
    expect(result.current.state.buffer).toBe("");
  });

  it("saves the edited buffer and calls onSaved once the daemon confirms the write", async () => {
    const writeFile = vi.fn(async (): Promise<FileWriteResult> => WRITTEN);
    const writeClient: FileWriteClient = { writeFile };
    const onSaved = vi.fn();
    const file = textFile();
    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file, onSaved }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.updateBuffer("export const answer = 43;\n"));
    act(() => result.current.save());

    expect(result.current.state.mode).toBe("saving");
    expect(writeFile).toHaveBeenCalledWith({
      cwd: "/workspace",
      path: "src/index.ts",
      content: "export const answer = 43;\n",
      expectedModifiedAt: "2026-02-01T12:00:00.000Z",
      expectedRevision: "rev-1",
    });

    await waitFor(() => expect(result.current.state.mode).toBe("read"));
    expect(result.current.state.buffer).toBe("");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("keeps the buffer and explains a rejected save (transport failure) without calling onSaved", async () => {
    const writeClient: FileWriteClient = {
      writeFile: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    };
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: textFile(), onSaved }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.updateBuffer("export const answer = 43;\n"));
    act(() => result.current.save());

    await waitFor(() => expect(result.current.state.error).not.toBeNull());
    expect(result.current.state.mode).toBe("edit");
    expect(result.current.state.buffer).toBe("export const answer = 43;\n");
    expect(result.current.state.error?.title).toBe("Couldn't save this file");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps the buffer and explains a conflict without calling onSaved", async () => {
    const writeClient: FileWriteClient = {
      writeFile: vi.fn(
        async (): Promise<FileWriteResult> => ({
          status: "conflict",
          version: {
            status: "ready",
            cwd: "/workspace",
            path: "src/index.ts",
            size: 99,
            modifiedAt: "2026-02-01T13:00:00.000Z",
          },
        }),
      ),
    };
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: textFile(), onSaved }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.updateBuffer("export const answer = 43;\n"));
    act(() => result.current.save());

    await waitFor(() => expect(result.current.state.error).not.toBeNull());
    expect(result.current.state.mode).toBe("edit");
    expect(result.current.state.buffer).toBe("export const answer = 43;\n");
    expect(result.current.state.error?.isConflict).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("clears a previous save error once the buffer is edited again", async () => {
    const writeClient: FileWriteClient = {
      writeFile: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    };
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: textFile(), onSaved }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.save());
    await waitFor(() => expect(result.current.state.error).not.toBeNull());

    act(() => result.current.updateBuffer("export const answer = 44;\n"));
    expect(result.current.state.error).toBeNull();
  });

  it("resets to read mode when the file's path changes out from under an in-progress edit", () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    const onSaved = vi.fn();
    const { result, rerender } = renderHook(
      ({ file }) => useFileEditor({ writeClient, workspaceRoot: "/workspace", file, onSaved }),
      { initialProps: { file: textFile() } },
    );

    act(() => result.current.startEditing());
    expect(result.current.state.mode).toBe("edit");

    rerender({ file: textFile({ path: "src/other.ts" }) });

    expect(result.current.state.mode).toBe("read");
    expect(result.current.state.buffer).toBe("");
  });

  // T41A1b: the central test for this task. `use-file-editor.ts` must pin
  // `expectedModifiedAt`/`expectedRevision` at `startEditing`, not read
  // `file` live at `save()` time — otherwise a re-read that lands mid-edit
  // (a reconnect-driven reload, a manual `retry()`, anything that bumps
  // `useFileExplorer`'s `file` prop) silently adopts the newer version as
  // "expected", walking straight past the daemon's own conflict check
  // instead of tripping it.
  it("T41A1b: saves against the ORIGINAL modifiedAt/revision after the file prop is replaced mid-edit", async () => {
    const writeFile = vi.fn(async (): Promise<FileWriteResult> => WRITTEN);
    const writeClient: FileWriteClient = { writeFile };
    const onSaved = vi.fn();
    const original = textFile();
    const { result, rerender } = renderHook(
      ({ file }) => useFileEditor({ writeClient, workspaceRoot: "/workspace", file, onSaved }),
      { initialProps: { file: original } },
    );

    act(() => result.current.startEditing());
    act(() => result.current.updateBuffer("export const answer = 43;\n"));

    // Someone else wrote the file (or a reconnect re-read it) while this
    // edit was in progress: `useFileExplorer` hands down a fresher `file`
    // for the SAME path, without the edit session having ended.
    rerender({
      file: textFile({ modifiedAt: "2026-02-01T13:00:00.000Z", revision: "rev-2" }),
    });

    // The edit is untouched — the buffer is never discarded — but the
    // hook now knows the daemon's version has moved out from under it.
    expect(result.current.state.mode).toBe("edit");
    expect(result.current.state.buffer).toBe("export const answer = 43;\n");
    expect(result.current.state.remoteChanged).toBe(true);

    act(() => result.current.save());

    expect(writeFile).toHaveBeenCalledWith({
      cwd: "/workspace",
      path: "src/index.ts",
      content: "export const answer = 43;\n",
      expectedModifiedAt: "2026-02-01T12:00:00.000Z",
      expectedRevision: "rev-1",
    });
    await waitFor(() => expect(result.current.state.mode).toBe("read"));
  });

  it("does not flag remoteChanged while merely typing into an unchanged file", () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: textFile(), onSaved }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.updateBuffer("export const answer = 43;\n"));

    expect(result.current.state.remoteChanged).toBe(false);
  });

  // T144: deliberately redundant with `path-authorization.test.ts`'s own
  // "every file-access entry point" coverage — this suite's job is to fail
  // HERE, in this file's own `npx vitest run`, if `useFileEditor` ever
  // stops calling `authorizeWorkspacePath` before `writeFile`, without
  // relying on the sibling suite to notice. Do not delete as "already
  // tested elsewhere".
  it("T144: denies saving a file whose path escapes the workspace and never calls writeFile", async () => {
    const writeFile = vi.fn(
      async (): Promise<FileWriteResult> => ({
        status: "written",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        size: 0,
      }),
    );
    const writeClient: FileWriteClient = { writeFile };
    const onSaved = vi.fn();
    const escapedFile = textFile({ path: "../outside/secret.txt" });

    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: escapedFile, onSaved }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.save());

    await waitFor(() => expect(result.current.state.error).not.toBeNull());
    expect(result.current.state.error?.description).toContain(OUTSIDE_WORKSPACE_DESCRIPTION);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
