import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileOpsClient } from "./file-ops-client.js";
import { FileOpsPanel } from "./file-ops-panel.js";
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

/** Renders a real `useFileOps` controller behind `FileOpsPanel`, mirroring how `FileBrowserView` wires it. */
function TestHarness({ client }: { client: FileOpsClient }) {
  const controller = useFileOps({ client, workspaceRoot: "/work" });
  return <FileOpsPanel controller={controller} />;
}

describe("FileOpsPanel", () => {
  it("renders a labelled field and a submit button for every operation", () => {
    render(<TestHarness client={fakeClient()} />);

    expect(screen.getByTestId("file-ops-panel")).toBeTruthy();
    expect(screen.getByLabelText("New folder path")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create folder" })).toBeTruthy();
    expect(screen.getByLabelText("New file path")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create file" })).toBeTruthy();
    expect(screen.getByLabelText("Rename from")).toBeTruthy();
    expect(screen.getByLabelText("Rename to")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();
    expect(screen.getByLabelText("Delete path")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("creates a folder through the daemon and shows a success banner", async () => {
    const mkdir = vi.fn(async () => ({ path: "src" }));
    render(<TestHarness client={fakeClient({ mkdir })} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("New folder path"), "src");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    await waitFor(() => expect(mkdir).toHaveBeenCalledWith("/work", "src"));
    const success = await screen.findByTestId("file-ops-success");
    expect(success.textContent).toMatch(/Created folder src/);
  });

  it("shows an explained error banner when the daemon rejects the operation", async () => {
    const createFile = vi.fn(async () => {
      throw new Error("Destination already exists");
    });
    render(<TestHarness client={fakeClient({ createFile })} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("New file path"), "notes.md");
    await user.click(screen.getByRole("button", { name: "Create file" }));

    const error = await screen.findByTestId("file-ops-error");
    expect(error.textContent).toMatch(/already uses that name/i);
  });

  it("requires confirmation before deleting, and sends no delete when cancelled", async () => {
    const deleteEntry = vi.fn(async () => ({ path: "notes.md" }));
    render(<TestHarness client={fakeClient({ deleteEntry })} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Delete path"), "notes.md");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("deletes after the confirmation is accepted", async () => {
    const deleteEntry = vi.fn(async () => ({ path: "notes.md" }));
    render(<TestHarness client={fakeClient({ deleteEntry })} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Delete path"), "notes.md");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith("/work", "notes.md", false));
    expect(await screen.findByTestId("file-ops-success")).toBeTruthy();
  });

  it("passes the recursive flag when the toggle is on", async () => {
    const deleteEntry = vi.fn(async () => ({ path: "src" }));
    render(<TestHarness client={fakeClient({ deleteEntry })} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Delete path"), "src");
    await user.click(screen.getByRole("switch", { name: "Delete folders and their contents" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith("/work", "src", true));
  });

  it("has no axe violations idle and with an error shown", async () => {
    const createFile = vi.fn(async () => {
      throw new Error("Destination already exists");
    });
    const { container } = render(<TestHarness client={fakeClient({ createFile })} />);
    expect(await axe(container)).toHaveNoViolations();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New file path"), "notes.md");
    await user.click(screen.getByRole("button", { name: "Create file" }));
    await screen.findByTestId("file-ops-error");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
