import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FileEditorPanel } from "./file-editor-panel.js";
import type { FileDownloadController } from "./use-file-download.js";
import type { FileReadClient, FileReadResult } from "./file-read-client.js";
import type { FileWriteClient, FileWriteResult } from "./file-write-client.js";

/**
 * The same fake `@codemirror/*` module set `file-code-editor.test.tsx`
 * uses, kept minimal here: this file exercises `FileEditorPanel`'s
 * Edit/Save/Cancel wiring and error handling, not CodeMirror's own
 * rendering (see that file's docstring).
 */
const { FakeEditorView, editorInstances } = vi.hoisted(() => {
  type Extension = { kind: string; fn?: (update: unknown) => void };
  class FakeEditorViewImpl {
    static updateListener = {
      of: (fn: (update: unknown) => void) => ({ kind: "updateListener", fn }),
    };
    static editable = { of: (value: boolean) => ({ kind: "editable", value }) };
    static contentAttributes = { of: (attrs: unknown) => ({ kind: "contentAttributes", attrs }) };
    static lineWrapping = { kind: "lineWrapping" };
    config: { state: { extensions: Extension[] } };
    constructor(config: FakeEditorViewImpl["config"]) {
      this.config = config;
      instances.push(this);
    }
    destroy(): void {}
  }
  const instances: FakeEditorViewImpl[] = [];
  return { FakeEditorView: FakeEditorViewImpl, editorInstances: instances };
});

/** Simulates typing a new document into the most recently mounted fake editor. */
function changeEditorBuffer(next: string): void {
  const instance = editorInstances.at(-1);
  const listener = instance?.config.state.extensions.find((ext) => ext.kind === "updateListener");
  listener?.fn?.({ docChanged: true, state: { doc: { toString: () => next } } });
}

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

/**
 * Warm the lazily imported chunks BEFORE any assertion is timed, the same
 * way the route tests do (`routes/route-tree.test.tsx`,
 * `app/App.test.tsx`): `FileCodeEditor` and `FileDiffView` each resolve a
 * dynamic `import()` on mount, and vitest transforms that graph on demand,
 * per worker. Cold, under full-suite contention, that transform has
 * exceeded even this file's explicit 15s `waitFor` ceiling; moving it
 * outside the timed window keeps the ceiling meaningful rather than
 * raising it to hide the cost. The components still lazily import at
 * runtime, so what this file asserts is unchanged.
 */
beforeAll(async () => {
  await Promise.all([import("./file-diff.js"), import("@picompanion/highlight")]);
}, 180_000);

afterEach(() => {
  cleanup();
  editorInstances.length = 0;
});

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

/**
 * A `readFile` that never resolves by default, exercised directly by
 * `use-file-conflict-resolution.test.ts` and
 * `file-conflict-resolution-panel.test.tsx` (T41A2). Most tests here
 * never trigger a conflict, so this default is never called; tests that
 * do trigger one pass their own.
 */
function fakeReadClient(): FileReadClient {
  return { readFile: vi.fn(async () => textFile()) };
}

function fakeDownloadController(): FileDownloadController {
  return {
    state: { status: "idle", path: null, fileName: null, progress: null, error: null },
    download: () => {},
    retry: () => {},
    cancel: () => {},
  };
}

const WRITTEN: FileWriteResult = {
  status: "written",
  modifiedAt: "2026-02-02T00:00:00.000Z",
  size: 30,
};

describe("FileEditorPanel (T30B3)", () => {
  it("shows the read-only content with an Edit affordance for a previewable text file", async () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByTestId("file-content-code").textContent).toContain(
      "export const answer = 42;",
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("does not offer Edit for a binary file", () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    render(
      <FileEditorPanel
        file={textFile({ kind: "binary" })}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("does not offer Edit for an oversized text file", () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    render(
      <FileEditorPanel
        file={textFile({ size: 2 * 1024 * 1024 })}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("switches to the editor with Save/Cancel controls once Edit is clicked", async () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(await screen.findByTestId("file-editor-code")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByTestId("file-content-code")).toBeNull();
  });

  it("returns to read mode and calls onSaved once a save is confirmed written, and Cancel discards without saving", async () => {
    const writeFile = vi.fn(async (): Promise<FileWriteResult> => WRITTEN);
    const writeClient: FileWriteClient = { writeFile };
    const onSaved = vi.fn();
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={onSaved}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByTestId("file-editor-code")).toBeNull());
    expect(screen.getByTestId("file-content-code")).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith({
      cwd: "/workspace",
      path: "src/index.ts",
      content: "export const answer = 42;\n",
      expectedModifiedAt: "2026-02-01T12:00:00.000Z",
      expectedRevision: "rev-1",
    });
  });

  it("cancels an edit without ever calling writeFile", async () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByTestId("file-editor-code")).toBeNull());
    expect(writeClient.writeFile).not.toHaveBeenCalled();
  });

  it("explains a failed save as an alert, keeps the buffer visible, and never calls onSaved", async () => {
    const writeClient: FileWriteClient = {
      writeFile: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    };
    const onSaved = vi.fn();
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={onSaved}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't save this file/i);
    expect(screen.getByTestId("file-editor-code")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows a diff of the buffer against the saved file once 'Show changes' is toggled on", async () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    changeEditorBuffer("export const answer = 43;\n");
    expect(screen.queryByTestId("file-editor-diff")).toBeNull();

    await user.click(screen.getByRole("switch", { name: "Show changes" }));

    expect(screen.queryByTestId("file-editor-code")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("file-editor-diff-body")).toBeTruthy(), {
      timeout: 15_000,
    });
    expect(screen.queryByTestId("file-editor-diff-empty")).toBeNull();
  }, 20_000);

  it("resets the diff toggle when Cancel discards the edit", async () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    changeEditorBuffer("export const answer = 43;\n");
    await user.click(screen.getByRole("switch", { name: "Show changes" }));
    await waitFor(() => expect(screen.getByTestId("file-editor-diff")).toBeTruthy(), {
      timeout: 15_000,
    });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("file-editor-code")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    expect(screen.queryByTestId("file-editor-diff")).toBeNull();
  }, 20_000);

  it("has no axe violations in read mode", async () => {
    const writeClient: FileWriteClient = { writeFile: vi.fn() };
    const { container } = render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("has no axe violations while editing with a save error shown", async () => {
    const writeClient: FileWriteClient = {
      writeFile: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    };
    const { container } = render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={writeClient}
        readClient={fakeReadClient()}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("FileEditorPanel conflict resolution (T41A2)", () => {
  const CONFLICT_VERSION = {
    status: "ready" as const,
    cwd: "/workspace",
    path: "src/index.ts",
    size: 31,
    modifiedAt: "2026-02-01T13:00:00.000Z",
    revision: "rev-2",
  };
  const CONFLICT: FileWriteResult = { status: "conflict", version: CONFLICT_VERSION };

  async function editAndSaveIntoConflict(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByTestId("file-editor-code");
    changeEditorBuffer("export const answer = 43;\n");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByTestId("file-conflict-resolution");
  }

  it("surfaces a resolution flow with both versions viewable, not just an error string", async () => {
    const writeFile = vi.fn(async (): Promise<FileWriteResult> => CONFLICT);
    const readFile = vi.fn(
      async (): Promise<FileReadResult> =>
        textFile({
          bytes: new TextEncoder().encode("export const answer = 99;\n"),
          modifiedAt: CONFLICT_VERSION.modifiedAt,
          revision: CONFLICT_VERSION.revision,
        }),
    );
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={{ writeFile }}
        readClient={{ readFile }}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await editAndSaveIntoConflict(user);

    // Not just an error string: real actions are offered.
    expect(screen.getByRole("button", { name: "Keep mine" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use their version" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Merge by hand" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

    // Both versions are viewable: the daemon's current content ("99")
    // came from a fresh readClient.readFile, not the conflict payload
    // (which carries no bytes at all) or the stale `file` prop ("42").
    expect(readFile).toHaveBeenCalledWith("/workspace", "src/index.ts");
    await waitFor(() => expect(screen.getByTestId("file-conflict-diff-body")).toBeTruthy(), {
      timeout: 15_000,
    });
    const diffText = screen.getByTestId("file-conflict-diff").textContent ?? "";
    expect(diffText).toContain("99");
    expect(diffText).toContain("43");
  }, 20_000);

  it("Keep mine overwrites with the local buffer, rebased onto the daemon's current version", async () => {
    const WRITTEN_AFTER_REBASE: FileWriteResult = {
      status: "written",
      modifiedAt: "2026-02-01T14:00:00.000Z",
      size: 27,
    };
    const writeFile = vi
      .fn<() => Promise<FileWriteResult>>()
      .mockResolvedValueOnce(CONFLICT)
      .mockResolvedValueOnce(WRITTEN_AFTER_REBASE);
    const readFile = vi.fn(
      async (): Promise<FileReadResult> =>
        textFile({
          bytes: new TextEncoder().encode("export const answer = 99;\n"),
          modifiedAt: CONFLICT_VERSION.modifiedAt,
          revision: CONFLICT_VERSION.revision,
        }),
    );
    const onSaved = vi.fn();
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={{ writeFile }}
        readClient={{ readFile }}
        downloadController={fakeDownloadController()}
        onSaved={onSaved}
      />,
    );
    const user = userEvent.setup();

    await editAndSaveIntoConflict(user);
    await waitFor(() => expect(screen.getByTestId("file-conflict-diff-body")).toBeTruthy(), {
      timeout: 15_000,
    });
    await user.click(screen.getByRole("button", { name: "Keep mine" }));

    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2));
    expect(writeFile).toHaveBeenNthCalledWith(2, {
      cwd: "/workspace",
      path: "src/index.ts",
      content: "export const answer = 43;\n",
      expectedModifiedAt: CONFLICT_VERSION.modifiedAt,
      expectedRevision: CONFLICT_VERSION.revision,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  }, 20_000);

  it("Use their version discards the local buffer and reloads, without writing anything", async () => {
    const writeFile = vi.fn(async (): Promise<FileWriteResult> => CONFLICT);
    const readFile = vi.fn(
      async (): Promise<FileReadResult> =>
        textFile({
          bytes: new TextEncoder().encode("export const answer = 99;\n"),
          modifiedAt: CONFLICT_VERSION.modifiedAt,
          revision: CONFLICT_VERSION.revision,
        }),
    );
    const onSaved = vi.fn();
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={{ writeFile }}
        readClient={{ readFile }}
        downloadController={fakeDownloadController()}
        onSaved={onSaved}
      />,
    );
    const user = userEvent.setup();

    await editAndSaveIntoConflict(user);
    await waitFor(() => expect(screen.getByTestId("file-conflict-diff-body")).toBeTruthy(), {
      timeout: 15_000,
    });
    await user.click(screen.getByRole("button", { name: "Use their version" }));

    await waitFor(() => expect(screen.queryByTestId("file-conflict-resolution")).toBeNull());
    expect(screen.queryByTestId("file-editor-code")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
    // Only the ORIGINAL save landed the conflict; discarding never writes.
    expect(writeFile).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("Merge by hand keeps the buffer and returns to the ordinary editor without writing", async () => {
    const writeFile = vi.fn(async (): Promise<FileWriteResult> => CONFLICT);
    const readFile = vi.fn(
      async (): Promise<FileReadResult> =>
        textFile({
          bytes: new TextEncoder().encode("export const answer = 99;\n"),
          modifiedAt: CONFLICT_VERSION.modifiedAt,
          revision: CONFLICT_VERSION.revision,
        }),
    );
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={{ writeFile }}
        readClient={{ readFile }}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await editAndSaveIntoConflict(user);
    await waitFor(() => expect(screen.getByTestId("file-conflict-diff-body")).toBeTruthy(), {
      timeout: 15_000,
    });
    await user.click(screen.getByRole("button", { name: "Merge by hand" }));

    await waitFor(() => expect(screen.getByTestId("file-editor-code")).toBeTruthy());
    expect(screen.queryByTestId("file-conflict-resolution")).toBeNull();
    // The buffer survived the rebase untouched.
    expect(writeFile).toHaveBeenCalledTimes(1);
  }, 20_000);

  // The decisive test for "cancelling leaves the file untouched" from
  // WITHIN the resolution flow specifically (not the ordinary Cancel
  // path already covered above): mutating this action to also call
  // `save()` must fail this test.
  it("Cancel from the resolution flow discards the buffer without ever writing", async () => {
    const writeFile = vi.fn(async (): Promise<FileWriteResult> => CONFLICT);
    const readFile = vi.fn(
      async (): Promise<FileReadResult> =>
        textFile({
          bytes: new TextEncoder().encode("export const answer = 99;\n"),
          modifiedAt: CONFLICT_VERSION.modifiedAt,
          revision: CONFLICT_VERSION.revision,
        }),
    );
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={{ writeFile }}
        readClient={{ readFile }}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await editAndSaveIntoConflict(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByTestId("file-editor-code")).toBeNull());
    expect(screen.getByTestId("file-content-code")).toBeTruthy();
    expect(writeFile).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("offers only a discard action, with no diff, when the conflicting file was deleted", async () => {
    const writeFile = vi.fn(
      async (): Promise<FileWriteResult> => ({
        status: "conflict",
        version: { status: "missing", cwd: "/workspace", path: "src/index.ts" },
      }),
    );
    const readFile = vi.fn(async (): Promise<FileReadResult> => textFile());
    render(
      <FileEditorPanel
        file={textFile()}
        workspaceRoot="/workspace"
        writeClient={{ writeFile }}
        readClient={{ readFile }}
        downloadController={fakeDownloadController()}
        onSaved={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await editAndSaveIntoConflict(user);

    expect(screen.getByTestId("file-conflict-missing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep mine" })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard my edit" })).toBeTruthy();
    // The daemon can't tell us content that doesn't exist — no re-read fired.
    expect(readFile).not.toHaveBeenCalled();
  });
});
