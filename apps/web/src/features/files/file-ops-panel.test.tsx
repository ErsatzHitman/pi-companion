import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileOpsClient } from "./file-ops-client.js";
import {
  FileDeleteAction,
  FileNewFilePopover,
  FileNewFolderPopover,
  FileRenameAction,
} from "./file-ops-panel.js";
import { useFileOps } from "./use-file-ops.js";

afterEach(cleanup);

function fakeClient(overrides: Partial<FileOpsClient> = {}): FileOpsClient {
  return {
    mkdir: vi.fn(async () => ({ path: "src" })),
    createFile: vi.fn(async () => ({ path: "notes.md" })),
    renameEntry: vi.fn(async () => ({ oldPath: "a.txt", newPath: "b.txt" })),
    deleteEntry: vi.fn(async () => ({ path: "a.txt" })),
    ...overrides,
  };
}

/**
 * Mounts every per-action component behind one real `useFileOps`
 * controller, mirroring how `FileToolbar`/`FileBrowserEntryList` share
 * a single controller from `FileBrowserView`.
 */
function TestHarness({ client }: { client: FileOpsClient }) {
  const controller = useFileOps({ client, workspaceRoot: "/work" });
  return (
    <div>
      <FileNewFolderPopover controller={controller} />
      <FileNewFilePopover controller={controller} />
      <FileRenameAction controller={controller} path="notes.md" name="notes.md" />
      <FileDeleteAction controller={controller} path="notes.md" name="notes.md" kind="file" />
    </div>
  );
}

describe("FileNewFolderPopover", () => {
  it("opens from its icon trigger and shows a labelled field plus a submit button", async () => {
    render(<TestHarness client={fakeClient()} />);
    const user = userEvent.setup();

    expect(screen.queryByLabelText("New folder path")).toBeNull();
    await user.click(screen.getByTestId("file-ops-mkdir-trigger"));

    expect(screen.getByLabelText("New folder path")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create folder" })).toBeTruthy();
  });

  it("creates a folder through the daemon and shows a success banner", async () => {
    const mkdir = vi.fn(async () => ({ path: "src" }));
    render(<TestHarness client={fakeClient({ mkdir })} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-ops-mkdir-trigger"));
    await user.type(screen.getByLabelText("New folder path"), "src");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    await waitFor(() => expect(mkdir).toHaveBeenCalledWith("/work", "src"));
    const success = await screen.findByTestId("file-ops-success");
    expect(success.textContent).toMatch(/Created folder src/);
  });
});

describe("FileNewFilePopover", () => {
  it("shows an explained error banner when the daemon rejects the operation", async () => {
    const createFile = vi.fn(async () => {
      throw new Error("Destination already exists");
    });
    render(<TestHarness client={fakeClient({ createFile })} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-ops-create-file-trigger"));
    await user.type(screen.getByLabelText("New file path"), "notes.md");
    await user.click(screen.getByRole("button", { name: "Create file" }));

    const error = await screen.findByTestId("file-ops-error");
    expect(error.textContent).toMatch(/already uses that name/i);
  });
});

describe("FileRenameAction", () => {
  it("opens pre-filled with the row's current path", async () => {
    render(<TestHarness client={fakeClient()} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-ops-rename-trigger-notes.md"));
    expect((screen.getByLabelText("Rename to") as HTMLInputElement).value).toBe("notes.md");
  });

  it("renames through the daemon and shows a success banner", async () => {
    const renameEntry = vi.fn(async () => ({ oldPath: "notes.md", newPath: "notes2.md" }));
    render(<TestHarness client={fakeClient({ renameEntry })} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-ops-rename-trigger-notes.md"));
    const field = screen.getByLabelText("Rename to");
    await user.clear(field);
    await user.type(field, "notes2.md");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(renameEntry).toHaveBeenCalledWith("/work", "notes.md", "notes2.md"));
    expect(await screen.findByTestId("file-ops-success")).toBeTruthy();
  });
});

describe("FileDeleteAction", () => {
  it("requires confirmation before deleting, and sends no delete when cancelled", async () => {
    const deleteEntry = vi.fn(async () => ({ path: "notes.md" }));
    render(<TestHarness client={fakeClient({ deleteEntry })} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-ops-delete-trigger-notes.md"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("deletes after the confirmation is accepted", async () => {
    const deleteEntry = vi.fn(async () => ({ path: "notes.md" }));
    render(<TestHarness client={fakeClient({ deleteEntry })} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-ops-delete-trigger-notes.md"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith("/work", "notes.md", false));
    expect(await screen.findByTestId("file-ops-success")).toBeTruthy();
  });

  it("shows the recursive toggle inside the dialog for a folder, and sends the flag when it's on", async () => {
    const deleteEntry = vi.fn(async () => ({ path: "src" }));
    function FolderHarness({ client }: { client: FileOpsClient }) {
      const controller = useFileOps({ client, workspaceRoot: "/work" });
      return <FileDeleteAction controller={controller} path="src" name="src" kind="directory" />;
    }
    render(<FolderHarness client={fakeClient({ deleteEntry })} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-ops-delete-trigger-src"));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("switch", { name: "Delete folders and their contents" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith("/work", "src", true));
  });

  it("never shows the recursive toggle for a file", async () => {
    render(<TestHarness client={fakeClient()} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-ops-delete-trigger-notes.md"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByRole("switch")).toBeNull();
  });

  it("has no axe violations idle and with the confirm dialog open", async () => {
    const { container } = render(<TestHarness client={fakeClient()} />);
    expect(await axe(container)).toHaveNoViolations();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("file-ops-delete-trigger-notes.md"));
    await screen.findByRole("alertdialog");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
