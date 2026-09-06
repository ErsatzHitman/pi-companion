import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoreProvider } from "../../app/core-context.js";
import { FileBrowserScreen } from "./file-browser-screen.js";
import type { FileReadClient, FileReadResult } from "./file-read-client.js";
import type { FileWriteClient, FileWriteResult } from "./file-write-client.js";

/**
 * The same fake `@codemirror/*` module set `file-code-editor.test.tsx`
 * uses — see that file's docstring for why the real library isn't
 * exercised in a jsdom unit test.
 */
const { FakeEditorView } = vi.hoisted(() => {
  class FakeEditorViewImpl {
    static updateListener = { of: (fn: unknown) => ({ kind: "updateListener", fn }) };
    static editable = { of: (value: boolean) => ({ kind: "editable", value }) };
    static contentAttributes = { of: (attrs: unknown) => ({ kind: "contentAttributes", attrs }) };
    static lineWrapping = { kind: "lineWrapping" };
    destroy(): void {}
  }
  return { FakeEditorView: FakeEditorViewImpl };
});

vi.mock("@codemirror/state", () => ({
  EditorState: { create: (config: { doc: string; extensions: unknown[] }) => config },
}));
vi.mock("@codemirror/view", () => ({
  EditorView: FakeEditorView,
  keymap: { of: (bindings: unknown[]) => ({ kind: "keymap", bindings }) },
  lineNumbers: () => ({ kind: "lineNumbers" }),
  highlightActiveLine: () => ({ kind: "highlightActiveLine" }),
}));
vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  history: () => ({ kind: "history" }),
  historyKeymap: [],
  indentWithTab: { key: "Tab" },
}));
// `@codemirror/language` is intentionally left unmocked — see
// `file-code-editor.test.tsx`'s matching comment.

afterEach(cleanup);

function textReadResult(overrides: Partial<FileReadResult> = {}): FileReadResult {
  return {
    path: "README.md",
    kind: "text",
    bytes: new TextEncoder().encode("export const answer = 42;\n"),
    mime: "text/plain",
    size: 27,
    modifiedAt: "2026-02-01T12:00:00.000Z",
    revision: "rev-1",
    ...overrides,
  };
}

function fileNotADirectoryClient() {
  return {
    listDirectory: async () => {
      throw new Error("Requested path is not a directory");
    },
  };
}

function renderFileScreenAt(
  initialPath: string,
  readClient: FileReadClient,
  writeClient?: FileWriteClient,
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
          client={fileNotADirectoryClient()}
          readClient={readClient}
          writeClient={writeClient}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([filesRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return render(
    <CoreProvider>
      <RouterProvider router={router} />
    </CoreProvider>,
  );
}

describe("FileBrowserScreen editing and saving a file (T30B3)", () => {
  it("edits a file, saves it, and reloads it showing the daemon's persisted content", async () => {
    let reads = 0;
    const readFile = vi.fn(async (): Promise<FileReadResult> => {
      reads += 1;
      return reads === 1
        ? textReadResult()
        : textReadResult({
            bytes: new TextEncoder().encode("export const answer = 43;\n"),
            modifiedAt: "2026-02-02T00:00:00.000Z",
            revision: "rev-2",
          });
    });
    const writeFile = vi.fn(
      async (): Promise<FileWriteResult> => ({
        status: "written",
        modifiedAt: "2026-02-02T00:00:00.000Z",
        size: 28,
      }),
    );
    renderFileScreenAt("/h/host-1/session/agent-1/files/README.md", { readFile }, { writeFile });
    const user = userEvent.setup();

    expect(await screen.findByTestId("file-content-code")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(reads).toBe(2));
    expect(writeFile).toHaveBeenCalledWith({
      cwd: "",
      path: "README.md",
      content: "export const answer = 42;\n",
      expectedModifiedAt: "2026-02-01T12:00:00.000Z",
      expectedRevision: "rev-1",
    });
    await waitFor(() =>
      expect(screen.getByTestId("file-content-code").textContent).toContain(
        "export const answer = 43;",
      ),
    );
    expect(screen.queryByTestId("file-editor-code")).toBeNull();
  });

  it("keeps the buffer and explains a failed save instead of silently discarding the edit", async () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => textReadResult());
    const writeFile = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    renderFileScreenAt("/h/host-1/session/agent-1/files/README.md", { readFile }, { writeFile });
    const user = userEvent.setup();

    expect(await screen.findByTestId("file-content-code")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/permission denied/i);
    expect(screen.getByTestId("file-editor-code")).toBeTruthy();
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("explains the not-connected placeholder when no writeClient is wired in", async () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => textReadResult());
    renderFileScreenAt("/h/host-1/session/agent-1/files/README.md", { readFile });
    const user = userEvent.setup();

    expect(await screen.findByTestId("file-content-code")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not connected/i);
  });
});
