import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileBrowserClient, FileBrowserDirectory } from "./file-browser-client.js";
import type { FileDownloadClient, FileDownloadTokenResult } from "./file-download-client.js";
import type { FileReadClient, FileReadResult } from "./file-read-client.js";
import type { FileWriteClient, FileWriteResult } from "./file-write-client.js";
import {
  authorizeWorkspacePath,
  PATH_OUTSIDE_WORKSPACE_MESSAGE,
  PathAuthorizationError,
} from "./path-authorization.js";
import { useFileBrowser } from "./use-file-browser.js";
import { useFileDownload } from "./use-file-download.js";
import { useFileEditor } from "./use-file-editor.js";
import { useFileExplorer } from "./use-file-explorer.js";
import { useFileSearch } from "./use-file-search.js";

// ---------------------------------------------------------------------------
// Part 1: the pure door itself, called directly — including "a path arriving
// from a source other than the door" (T41A1a's third required bypass): none
// of these strings ever flow through a route, a `Link`, or a hook below.
// They stand in for exactly the bypass review named — a value some future
// feature (a transcript-text scanner, say) might hand straight to a client
// call believing it is already authorized, without ever asking this
// question. `grep -rn "path-shaped\|pathLike\|looksLikePath\|isPathLike" \
// apps/web/src apps/android/src packages/frontend-core/src` (2026-09-05)
// confirms no such scanner exists in this repository yet.
// ---------------------------------------------------------------------------
describe("authorizeWorkspacePath (T41A1a)", () => {
  it("accepts a plain relative path unchanged", () => {
    expect(authorizeWorkspacePath("src/index.ts")).toEqual({ path: "src/index.ts" });
  });

  it("treats the empty string as the workspace root", () => {
    expect(authorizeWorkspacePath("")).toEqual({ path: "" });
  });

  it("drops '.' and empty segments (repeated/leading/trailing separators)", () => {
    expect(authorizeWorkspacePath("./src//index.ts/")).toEqual({ path: "src/index.ts" });
  });

  it("denies a '..' escape via a forward slash", () => {
    expect(() => authorizeWorkspacePath("../secrets.env")).toThrow(PathAuthorizationError);
    expect(() => authorizeWorkspacePath("src/../../secrets.env")).toThrow(
      PATH_OUTSIDE_WORKSPACE_MESSAGE,
    );
  });

  it("denies a '..' escape via a backslash (Windows-style traversal string)", () => {
    expect(() => authorizeWorkspacePath("..\\..\\Windows\\System32\\config\\SAM")).toThrow(
      PathAuthorizationError,
    );
  });

  it("denies a POSIX-absolute path — a path arriving from a source other than the door", () => {
    // Stands in for a string a transcript-text scanner might have lifted
    // verbatim from an assistant message or tool output ("cat /etc/passwd")
    // and handed straight to a client call.
    expect(() => authorizeWorkspacePath("/etc/passwd")).toThrow(PATH_OUTSIDE_WORKSPACE_MESSAGE);
  });

  it("denies a home-relative path", () => {
    expect(() => authorizeWorkspacePath("~/.ssh/id_rsa")).toThrow(PathAuthorizationError);
    expect(() => authorizeWorkspacePath("~")).toThrow(PathAuthorizationError);
  });

  it("denies a Windows drive-absolute path, forward- or back-slashed", () => {
    expect(() => authorizeWorkspacePath("C:/Windows/System32/config/SAM")).toThrow(
      PathAuthorizationError,
    );
    expect(() => authorizeWorkspacePath("C:\\Windows\\System32\\config\\SAM")).toThrow(
      PathAuthorizationError,
    );
  });

  it("denies a NUL byte", () => {
    expect(() => authorizeWorkspacePath("src/index.ts\0.png")).toThrow(PathAuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// Part 2: every real file-access entry point `features/files/` has today,
// each proven by calling the REAL hook (not a source-text assertion) with an
// escaping path and showing the underlying client method is never called.
// ---------------------------------------------------------------------------

function fakeDirectory(path: string): FileBrowserDirectory {
  return { path, entries: [] };
}

describe("every file-access entry point routes through the door (T41A1a)", () => {
  it("useFileBrowser: listDirectory is never called for an escaping path", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => fakeDirectory(path));
    const client: FileBrowserClient = { listDirectory };

    const { result } = renderHook(() =>
      useFileBrowser({ client, workspaceRoot: "/workspace", path: "../outside" }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.raw).toBe(PATH_OUTSIDE_WORKSPACE_MESSAGE);
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("useFileExplorer: neither listDirectory nor readFile is called for an escaping path", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => fakeDirectory(path));
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

  it("useFileEditor: writeFile is never called for a file whose path escapes the workspace", async () => {
    const writeFile = vi.fn(
      async (): Promise<FileWriteResult> => ({
        status: "written",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        size: 0,
      }),
    );
    const writeClient: FileWriteClient = { writeFile };
    const onSaved = vi.fn();
    const escapedFile: FileReadResult = {
      // Simulates a value that arrived from somewhere other than
      // `useFileExplorer`'s own already-authorized `path` — this hook
      // does not assume its caller already checked.
      path: "../outside/secret.txt",
      kind: "text",
      bytes: new TextEncoder().encode("hunter2\n"),
      mime: "text/plain",
      size: 8,
      modifiedAt: "2026-01-01T00:00:00.000Z",
    };

    const { result } = renderHook(() =>
      useFileEditor({ writeClient, workspaceRoot: "/workspace", file: escapedFile, onSaved }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.save());

    await waitFor(() => expect(result.current.state.error).not.toBeNull());
    expect(result.current.state.error?.description).toContain(
      "outside the folders the daemon shares",
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("useFileDownload: requestDownloadToken is never called for an escaping path", async () => {
    const requestDownloadToken = vi.fn(
      async (): Promise<FileDownloadTokenResult> => ({
        cwd: "/workspace",
        path: "x",
        token: "tok",
        fileName: "x",
        mimeType: "text/plain",
        size: 1,
        error: null,
      }),
    );
    const client: FileDownloadClient = { requestDownloadToken };

    const { result } = renderHook(() =>
      useFileDownload({ client, downloadOrigin: "http://127.0.0.1:6768" }),
    );

    act(() => result.current.download("/workspace", "~/.ssh/id_rsa", "id_rsa"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.description).toContain(
      "outside the folders the daemon shares",
    );
    expect(requestDownloadToken).not.toHaveBeenCalled();
  });

  it("useFileSearch: an escaping rootPath is denied as a real search error, listDirectory is never called", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => fakeDirectory(path));
    const client: FileBrowserClient = { listDirectory };

    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", rootPath: "../outside", debounceMs: 0 }),
    );

    act(() => result.current.setQuery("secret"));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.raw).toBe(PATH_OUTSIDE_WORKSPACE_MESSAGE);
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("useFileSearch: a listing entry shaped like a symlink resolving outside the root is never descended into", async () => {
    // The daemon's own `listDirectoryEntries` filters an entry whose
    // target escapes the workspace before it is ever returned (see
    // `packages/server/src/server/file-explorer/service.ts`'s
    // `isOutsideWorkspaceError` catch). This proves this walker does not
    // *rely* on that upstream guarantee: even a directory entry that
    // claims a path outside the root — the shape a resolved symlink
    // escaping the workspace would have — is independently re-checked
    // before this walker ever lists it, and is never descended into.
    const listDirectory = vi.fn(
      async (_cwd: string, path: string): Promise<FileBrowserDirectory> => {
        if (path === "") {
          return {
            path: "",
            entries: [
              {
                name: "escaped-link",
                path: "../outside",
                kind: "directory",
                size: 0,
                modifiedAt: "2026-01-01T00:00:00.000Z",
              },
              {
                name: "secret.txt",
                path: "secret.txt",
                kind: "file",
                size: 4,
                modifiedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          };
        }
        throw new Error(`unexpected listDirectory call for ${path}`);
      },
    );
    const client: FileBrowserClient = { listDirectory };

    const { result } = renderHook(() =>
      useFileSearch({ client, workspaceRoot: "/workspace", debounceMs: 0 }),
    );

    act(() => result.current.setQuery("secret"));

    await waitFor(() => expect(result.current.state.status).toBe("done"));
    // Only the legitimate root listing call — never one for "../outside".
    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(listDirectory).toHaveBeenCalledWith("/workspace", "");
    expect(result.current.state.results.map((entry) => entry.path)).toEqual(["secret.txt"]);
  });
});
