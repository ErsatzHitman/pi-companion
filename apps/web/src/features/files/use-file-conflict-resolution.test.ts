import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileReadClient, FileReadResult } from "./file-read-client.js";
import type { FileWriteConflictVersion } from "./file-write-client.js";
import { useFileConflictResolution } from "./use-file-conflict-resolution.js";

function textFile(overrides: Partial<FileReadResult> = {}): FileReadResult {
  return {
    path: "src/index.ts",
    kind: "text",
    bytes: new TextEncoder().encode("export const answer = 99;\n"),
    mime: "text/plain",
    size: 27,
    modifiedAt: "2026-02-01T13:00:00.000Z",
    revision: "rev-2",
    ...overrides,
  };
}

const READY_VERSION: FileWriteConflictVersion = {
  status: "ready",
  cwd: "/workspace",
  path: "src/index.ts",
  size: 27,
  modifiedAt: "2026-02-01T13:00:00.000Z",
  revision: "rev-2",
};

describe("useFileConflictResolution (T41A2)", () => {
  // `readClient` is built ONCE, outside `renderHook`'s callback, in every
  // test below (matching `use-file-editor.test.ts`'s `writeClient`
  // convention): `renderHook`'s callback re-runs on every render this hook
  // triggers, so an inline `{ readFile }` object literal there would be a
  // FRESH object each time — and since this hook's own effect depends on
  // `readClient` (a real caller's client can change), that non-stop-changing
  // identity retriggers the effect every render, which sets loading state,
  // which triggers a render, forever. Confirmed by reproducing it: an
  // earlier draft of this file inlined the client and pegged a worker's
  // heap until the process crashed.
  it("starts loading, then re-reads the daemon's current content — the conflict payload carries no bytes", async () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => textFile());
    const readClient: FileReadClient = { readFile };
    const { result } = renderHook(() =>
      useFileConflictResolution({
        readClient,
        workspaceRoot: "/workspace",
        path: "src/index.ts",
        version: READY_VERSION,
      }),
    );

    expect(result.current.status).toBe("loading");
    expect(readFile).toHaveBeenCalledWith("/workspace", "src/index.ts");

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.remoteText).toBe("export const answer = 99;\n");
    expect(result.current.remoteFile).toEqual(textFile());
  });

  it("reports 'missing' without ever calling readFile when the conflict says the file was deleted", () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => textFile());
    const readClient: FileReadClient = { readFile };
    // Hoisted for the SAME reason `readClient` is above: an inline object
    // literal here is a dependency of the hook's effect too, so recreating
    // it on every `renderHook` re-invocation retriggers the effect forever.
    const version: FileWriteConflictVersion = {
      status: "missing",
      cwd: "/workspace",
      path: "src/index.ts",
    };
    const { result } = renderHook(() =>
      useFileConflictResolution({
        readClient,
        workspaceRoot: "/workspace",
        path: "src/index.ts",
        version,
      }),
    );

    expect(result.current.status).toBe("missing");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reports 'unavailable' without calling readFile for a version-check error", () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => textFile());
    const readClient: FileReadClient = { readFile };
    const version: FileWriteConflictVersion = {
      status: "error",
      cwd: "/workspace",
      path: "src/index.ts",
      error: "boom",
    };
    const { result } = renderHook(() =>
      useFileConflictResolution({
        readClient,
        workspaceRoot: "/workspace",
        path: "src/index.ts",
        version,
      }),
    );

    expect(result.current.status).toBe("unavailable");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reports 'unavailable' with the explained error when the re-read rejects", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const readClient: FileReadClient = { readFile };
    const { result } = renderHook(() =>
      useFileConflictResolution({
        readClient,
        workspaceRoot: "/workspace",
        path: "src/index.ts",
        version: READY_VERSION,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.error?.title).toBe("Couldn't read this file");
  });

  it("reports 'unavailable' rather than attempting to diff a non-text re-read", async () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => textFile({ kind: "binary" }));
    const readClient: FileReadClient = { readFile };
    const { result } = renderHook(() =>
      useFileConflictResolution({
        readClient,
        workspaceRoot: "/workspace",
        path: "src/index.ts",
        version: READY_VERSION,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.remoteText).toBeNull();
    expect(result.current.error?.title).toBe("Can't compare this file");
  });

  it("re-fetches when a NEW conflict version replaces the one already resolved", async () => {
    const readFile = vi
      .fn<FileReadClient["readFile"]>()
      .mockResolvedValueOnce(textFile())
      .mockResolvedValueOnce(
        textFile({ bytes: new TextEncoder().encode("export const answer = 100;\n") }),
      );
    const readClient: FileReadClient = { readFile };
    const { result, rerender } = renderHook(
      ({ version }: { version: FileWriteConflictVersion }) =>
        useFileConflictResolution({
          readClient,
          workspaceRoot: "/workspace",
          path: "src/index.ts",
          version,
        }),
      { initialProps: { version: READY_VERSION } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.remoteText).toBe("export const answer = 99;\n");

    rerender({
      version: { ...READY_VERSION, modifiedAt: "2026-02-01T15:00:00.000Z", revision: "rev-3" },
    });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.remoteText).toBe("export const answer = 100;\n");
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
