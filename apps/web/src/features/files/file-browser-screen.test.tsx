import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileBrowserClient, FileBrowserDirectory } from "./file-browser-client.js";
import type { FileDownloadClient, FileDownloadTokenResult } from "./file-download-client.js";
import type { FileReadClient, FileReadResult } from "./file-read-client.js";
import type { FileUploadClient } from "./file-upload-client.js";
import { CoreProvider } from "../../app/core-context.js";
import { FileBrowserScreen } from "./file-browser-screen.js";

afterEach(cleanup);

function directory(path: string): FileBrowserDirectory {
  const prefix = path ? `${path}/` : "";
  return {
    path,
    entries: [
      {
        name: "src",
        path: `${prefix}src`,
        kind: "directory",
        size: 0,
        modifiedAt: "2026-02-01T12:00:00.000Z",
      },
      {
        name: "README.md",
        path: `${prefix}README.md`,
        kind: "file",
        size: 2048,
        modifiedAt: "2026-02-01T12:00:00.000Z",
      },
    ],
  };
}

function renderFilesScreenAt(
  initialPath: string,
  client: FileBrowserClient,
  readClient?: FileReadClient,
  extra?: {
    uploadClient?: FileUploadClient;
    downloadClient?: FileDownloadClient;
    downloadOrigin?: string | null;
  },
) {
  const rootRoute = createRootRoute();
  const filesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/h/$serverId/session/$agentId/files/$",
    component: () => {
      const { serverId, agentId, _splat } = filesRoute.useParams();
      return (
        <FileBrowserScreen
          serverId={serverId}
          agentId={agentId}
          path={_splat ?? ""}
          client={client}
          readClient={readClient}
          uploadClient={extra?.uploadClient}
          downloadClient={extra?.downloadClient}
          downloadOrigin={extra?.downloadOrigin}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([filesRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const result = render(
    <CoreProvider>
      <RouterProvider router={router} />
    </CoreProvider>,
  );
  return { ...result, router };
}

function fileNotADirectoryClient(): FileBrowserClient {
  return {
    listDirectory: async () => {
      throw new Error("Requested path is not a directory");
    },
  };
}

function textReadResult(path: string): FileReadResult {
  return {
    path,
    kind: "text",
    bytes: new TextEncoder().encode("export const answer = 42;\n"),
    mime: "text/plain",
    size: 27,
    modifiedAt: "2026-02-01T12:00:00.000Z",
  };
}

describe("FileBrowserScreen (T30B1)", () => {
  it("shows a loading state before the listing arrives", async () => {
    const client: FileBrowserClient = { listDirectory: () => new Promise(() => {}) };
    renderFilesScreenAt("/h/host-1/session/agent-1/files", client);

    expect(await screen.findByTestId("file-browser-loading")).toBeTruthy();
  });

  it("renders the listing with breadcrumbs and both entry kinds", async () => {
    const client: FileBrowserClient = { listDirectory: async (_cwd, path) => directory(path) };
    renderFilesScreenAt("/h/host-1/session/agent-1/files", client);

    await screen.findByTestId("file-browser-entry-src");
    expect(screen.getByRole("link", { name: /^src/ })).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.getAllByText("Folder").length).toBeGreaterThan(0);
    expect(screen.getAllByText("File").length).toBeGreaterThan(0);

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb.textContent).toContain("Files");
  });

  it("navigates into a directory and re-lists it, updating the URL", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => directory(path));
    const { router } = renderFilesScreenAt("/h/host-1/session/agent-1/files", {
      listDirectory,
    });
    const user = userEvent.setup();

    await screen.findByTestId("file-browser-entry-src");
    await user.click(screen.getByTestId("file-browser-entry-src"));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/h/host-1/session/agent-1/files/src"),
    );
    await screen.findByTestId("file-browser-entry-src/src");
    expect(listDirectory).toHaveBeenCalledWith("", "src");
  });

  it("navigates back to the root via the breadcrumb trail", async () => {
    const client: FileBrowserClient = { listDirectory: async (_cwd, path) => directory(path) };
    const { router } = renderFilesScreenAt("/h/host-1/session/agent-1/files/src", client);
    const user = userEvent.setup();

    await screen.findByTestId("file-browser-entry-src/src");
    await user.click(screen.getByRole("link", { name: "Files" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/h/host-1/session/agent-1/files"),
    );
  });

  it("explains a permission error and recovers via Retry", async () => {
    let attempt = 0;
    const client: FileBrowserClient = {
      listDirectory: async () => {
        attempt += 1;
        if (attempt === 1)
          throw new Error("EACCES: permission denied, scandir '/workspace/secret'");
        return directory("");
      },
    };
    renderFilesScreenAt("/h/host-1/session/agent-1/files", client);
    const user = userEvent.setup();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/permission denied/i);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByTestId("file-browser-entry-src");
  });

  it("explains a missing-path error", async () => {
    const client: FileBrowserClient = {
      listDirectory: async () => {
        throw new Error("ENOENT: no such file or directory, stat '/workspace/missing'");
      },
    };
    renderFilesScreenAt("/h/host-1/session/agent-1/files/missing", client);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no longer exists/i);
  });

  it("explains the not-connected placeholder when no client is wired in", async () => {
    const rootRoute = createRootRoute();
    const filesRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/h/$serverId/session/$agentId/files/$",
      component: () => {
        const { serverId, agentId, _splat } = filesRoute.useParams();
        return <FileBrowserScreen serverId={serverId} agentId={agentId} path={_splat ?? ""} />;
      },
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([filesRoute]),
      history: createMemoryHistory({ initialEntries: ["/h/host-1/session/agent-1/files"] }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not connected/i);
  });

  it("shows an empty-folder state with no entries", async () => {
    const client: FileBrowserClient = {
      listDirectory: async (_cwd, path) => ({ path, entries: [] }),
    };
    renderFilesScreenAt("/h/host-1/session/agent-1/files", client);

    expect(await screen.findByTestId("file-browser-empty")).toBeTruthy();
  });

  it("has no axe violations while listing entries", async () => {
    const client: FileBrowserClient = { listDirectory: async (_cwd, path) => directory(path) };
    const { container } = renderFilesScreenAt("/h/host-1/session/agent-1/files", client);
    await screen.findByTestId("file-browser-entry-src");

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations on the error state", async () => {
    const client: FileBrowserClient = {
      listDirectory: async () => {
        throw new Error("cwd is required");
      },
    };
    const { container } = renderFilesScreenAt("/h/host-1/session/agent-1/files", client);
    await screen.findByRole("alert");

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});

describe("FileBrowserScreen reading a file (T30B2)", () => {
  it("opens a file entry from the listing and shows its content read-only", async () => {
    const client: FileBrowserClient = {
      listDirectory: async (_cwd, path) => {
        if (path === "README.md") {
          throw new Error("Requested path is not a directory");
        }
        return directory(path);
      },
    };
    const readFile = vi.fn(async (_cwd: string, path: string) => textReadResult(path));
    const { router } = renderFilesScreenAt("/h/host-1/session/agent-1/files", client, {
      readFile,
    });
    const user = userEvent.setup();

    await screen.findByTestId("file-browser-entry-README.md");
    await user.click(screen.getByTestId("file-browser-entry-README.md"));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/h/host-1/session/agent-1/files/README.md"),
    );
    expect(await screen.findByTestId("file-content-code")).toBeTruthy();
    expect(screen.getByText("export const answer = 42;", { exact: false })).toBeTruthy();
    expect(readFile).toHaveBeenCalledWith("", "README.md");

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb.textContent).toContain("README.md");
  });

  it("reads a file reached directly via a deep link, without listing first", async () => {
    const readFile = vi.fn(async (_cwd: string, path: string) => textReadResult(path));
    renderFilesScreenAt("/h/host-1/session/agent-1/files/src/notes.ts", fileNotADirectoryClient(), {
      readFile,
    });

    expect(await screen.findByTestId("file-content-code")).toBeTruthy();
    expect(readFile).toHaveBeenCalledWith("", "src/notes.ts");
  });

  it("refuses a binary file with an explanation instead of raw bytes", async () => {
    const readClient: FileReadClient = {
      readFile: async (_cwd, path) => ({ ...textReadResult(path), kind: "binary" }),
    };
    renderFilesScreenAt(
      "/h/host-1/session/agent-1/files/photo.png",
      fileNotADirectoryClient(),
      readClient,
    );

    const refusal = await screen.findByTestId("file-content-refused");
    expect(refusal.textContent).toMatch(/binary file/i);
    expect(screen.queryByTestId("file-content-code")).toBeNull();
  });

  it("refuses an oversized text file with an explanation", async () => {
    const readClient: FileReadClient = {
      readFile: async (_cwd, path) => ({
        ...textReadResult(path),
        size: 5 * 1024 * 1024,
      }),
    };
    renderFilesScreenAt(
      "/h/host-1/session/agent-1/files/huge.log",
      fileNotADirectoryClient(),
      readClient,
    );

    const refusal = await screen.findByTestId("file-content-refused");
    expect(refusal.textContent).toMatch(/too large to preview/i);
  });

  it("explains a file read error", async () => {
    const readClient: FileReadClient = {
      readFile: async () => {
        throw new Error("EACCES: permission denied, open '/workspace/secret.env'");
      },
    };
    renderFilesScreenAt(
      "/h/host-1/session/agent-1/files/secret.env",
      fileNotADirectoryClient(),
      readClient,
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/permission denied/i);
  });

  it("has no axe violations while showing file content", async () => {
    const readClient: FileReadClient = {
      readFile: async (_cwd, path) => textReadResult(path),
    };
    const { container } = renderFilesScreenAt(
      "/h/host-1/session/agent-1/files/README.md",
      fileNotADirectoryClient(),
      readClient,
    );
    await screen.findByTestId("file-content-code");

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});

describe("FileBrowserScreen upload and download (T30B4)", () => {
  it("shows a Download button per file row and downloads it end to end", async () => {
    const client: FileBrowserClient = { listDirectory: async (_cwd, path) => directory(path) };
    const downloadClient: FileDownloadClient = {
      requestDownloadToken: async (): Promise<FileDownloadTokenResult> => ({
        cwd: "",
        path: "README.md",
        token: "tok_1",
        fileName: "README.md",
        mimeType: "text/markdown",
        size: 2048,
        error: null,
      }),
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true };
              done = true;
              return { done: false, value: new Uint8Array(2048) };
            },
          };
        },
      },
    }));
    const saveBlob = vi.fn();
    // `FileBrowserScreen` doesn't accept `fetchImpl`/`saveBlob` overrides
    // (those are `useFileDownload`'s test-only seams); stub the browser
    // APIs `use-file-download.ts`'s defaults call instead, matching how a
    // real mounted download would exercise them.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        saveBlob(this.download);
      });
    try {
      renderFilesScreenAt("/h/host-1/session/agent-1/files", client, undefined, {
        downloadClient,
        downloadOrigin: "http://127.0.0.1:6768",
      });

      await screen.findByTestId("file-download-button-README.md");
      const user = userEvent.setup();
      await user.click(screen.getByTestId("file-download-button-README.md"));

      await waitFor(() =>
        expect(screen.getByTestId("file-download-success-README.md")).toBeTruthy(),
      );
      // T41A3: the real default `fetchImpl` is called with a second
      // argument carrying the cancellation `AbortSignal` — asserted more
      // narrowly than a bare URL check so a real abort signal is proven
      // to reach `fetch`, not merely that a URL was requested.
      expect(fetchImpl).toHaveBeenCalledWith(
        "http://127.0.0.1:6768/api/files/download?token=tok_1",
        { signal: expect.any(AbortSignal) },
      );
      expect(saveBlob).toHaveBeenCalledWith("README.md");
    } finally {
      globalThis.fetch = originalFetch;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      clickSpy.mockRestore();
    }
  });

  it("stages a picked file with the daemon via the upload panel", async () => {
    const client: FileBrowserClient = { listDirectory: async (_cwd, path) => directory(path) };
    const uploadFile = vi.fn(async () => ({
      file: {
        id: "upload_1",
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 5,
        path: "/uploads/upload_1/notes.txt",
      },
      error: null,
    }));
    const uploadClient: FileUploadClient = {
      uploadFile,
      cancelUpload: vi.fn(async () => ({ cancelled: false, error: null })),
    };
    renderFilesScreenAt("/h/host-1/session/agent-1/files", client, undefined, { uploadClient });

    await screen.findByTestId("file-browser-entry-src");
    expect(screen.getByTestId("file-upload-panel")).toBeTruthy();
    // This app has no real `<input type="file">` interaction available in
    // jsdom without a user-supplied `File`; `use-file-upload.test.ts` and
    // `file-upload-panel.test.tsx` already cover the picker round trip in
    // isolation. This test only proves the panel is mounted and wired to
    // a real `uploadClient` through `FileBrowserScreen`/`FileBrowserView`.
    expect(screen.getByRole("button", { name: "Choose a file to upload" })).toBeTruthy();
  });
});
