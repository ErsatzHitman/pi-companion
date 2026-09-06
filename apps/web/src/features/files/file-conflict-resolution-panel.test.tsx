import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileConflictResolutionPanel } from "./file-conflict-resolution-panel.js";
import type { FileReadResult } from "./file-read-client.js";
import type { FileWriteConflictVersion } from "./file-write-client.js";

afterEach(cleanup);

const LAZY_IMPORT_WAIT = { timeout: 15_000 } as const;

const READY_VERSION: FileWriteConflictVersion = {
  status: "ready",
  cwd: "/workspace",
  path: "src/index.ts",
  size: 27,
  modifiedAt: "2026-02-01T13:00:00.000Z",
  revision: "rev-2",
};

function remoteFile(overrides: Partial<FileReadResult> = {}): FileReadResult {
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

describe("FileConflictResolutionPanel (T41A2)", () => {
  it("shows a loading state before the other version has been re-read, with only Cancel enabled", () => {
    const readFile = vi.fn(() => new Promise<FileReadResult>(() => {}));
    render(
      <FileConflictResolutionPanel
        readClient={{ readFile }}
        workspaceRoot="/workspace"
        path="src/index.ts"
        version={READY_VERSION}
        localText="mine"
        saving={false}
        onKeepMine={vi.fn()}
        onTakeTheirs={vi.fn()}
        onMergeByHand={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("file-conflict-loading")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep mine" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("shows both versions and all three resolution actions once the re-read resolves", async () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => remoteFile());
    render(
      <FileConflictResolutionPanel
        readClient={{ readFile }}
        workspaceRoot="/workspace"
        path="src/index.ts"
        version={READY_VERSION}
        localText="export const answer = 43;\n"
        saving={false}
        onKeepMine={vi.fn()}
        onTakeTheirs={vi.fn()}
        onMergeByHand={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(
      () => expect(screen.getByTestId("file-conflict-diff-body")).toBeTruthy(),
      LAZY_IMPORT_WAIT,
    );
    const diffText = screen.getByTestId("file-conflict-diff").textContent ?? "";
    expect(diffText).toContain("99");
    expect(diffText).toContain("43");
    expect(screen.getByRole("button", { name: "Keep mine" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use their version" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Merge by hand" })).toBeTruthy();
  }, 20_000);

  it("Keep mine and Merge by hand pass the FRESHLY-READ version as the new basis, not the stale conflict payload", async () => {
    const readFile = vi.fn(
      async (): Promise<FileReadResult> =>
        remoteFile({ modifiedAt: "2026-02-01T14:30:00.000Z", revision: "rev-5" }),
    );
    const onKeepMine = vi.fn();
    const onMergeByHand = vi.fn();
    render(
      <FileConflictResolutionPanel
        readClient={{ readFile }}
        workspaceRoot="/workspace"
        path="src/index.ts"
        version={READY_VERSION}
        localText="export const answer = 43;\n"
        saving={false}
        onKeepMine={onKeepMine}
        onTakeTheirs={vi.fn()}
        onMergeByHand={onMergeByHand}
        onCancel={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await waitFor(
      () => expect(screen.getByTestId("file-conflict-diff-body")).toBeTruthy(),
      LAZY_IMPORT_WAIT,
    );

    await user.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(onKeepMine).toHaveBeenCalledWith({
      modifiedAt: "2026-02-01T14:30:00.000Z",
      revision: "rev-5",
    });

    await user.click(screen.getByRole("button", { name: "Merge by hand" }));
    expect(onMergeByHand).toHaveBeenCalledWith({
      modifiedAt: "2026-02-01T14:30:00.000Z",
      revision: "rev-5",
    });
  }, 20_000);

  it("Use their version and Cancel call their handlers directly", async () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => remoteFile());
    const onTakeTheirs = vi.fn();
    const onCancel = vi.fn();
    render(
      <FileConflictResolutionPanel
        readClient={{ readFile }}
        workspaceRoot="/workspace"
        path="src/index.ts"
        version={READY_VERSION}
        localText="export const answer = 43;\n"
        saving={false}
        onKeepMine={vi.fn()}
        onTakeTheirs={onTakeTheirs}
        onMergeByHand={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const user = userEvent.setup();
    await waitFor(
      () => expect(screen.getByTestId("file-conflict-diff-body")).toBeTruthy(),
      LAZY_IMPORT_WAIT,
    );

    await user.click(screen.getByRole("button", { name: "Use their version" }));
    expect(onTakeTheirs).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("disables every action while a save is in flight", async () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => remoteFile());
    render(
      <FileConflictResolutionPanel
        readClient={{ readFile }}
        workspaceRoot="/workspace"
        path="src/index.ts"
        version={READY_VERSION}
        localText="export const answer = 43;\n"
        saving={true}
        onKeepMine={vi.fn()}
        onTakeTheirs={vi.fn()}
        onMergeByHand={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(
      () => expect(screen.getByTestId("file-conflict-diff-body")).toBeTruthy(),
      LAZY_IMPORT_WAIT,
    );
    expect(screen.getByRole("button", { name: "Keep mine" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Use their version" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Merge by hand" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
  }, 20_000);

  it("offers only a discard action, with no diff, when the file was deleted", () => {
    const readFile = vi.fn(async (): Promise<FileReadResult> => remoteFile());
    render(
      <FileConflictResolutionPanel
        readClient={{ readFile }}
        workspaceRoot="/workspace"
        path="src/index.ts"
        version={{ status: "missing", cwd: "/workspace", path: "src/index.ts" }}
        localText="export const answer = 43;\n"
        saving={false}
        onKeepMine={vi.fn()}
        onTakeTheirs={vi.fn()}
        onMergeByHand={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("file-conflict-missing")).toBeTruthy();
    expect(screen.queryByTestId("file-conflict-diff")).toBeNull();
    expect(screen.getByRole("button", { name: "Discard my edit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep mine" })).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("shows the read error, with a discard action but no diff, when the re-read fails", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    render(
      <FileConflictResolutionPanel
        readClient={{ readFile }}
        workspaceRoot="/workspace"
        path="src/index.ts"
        version={READY_VERSION}
        localText="export const answer = 43;\n"
        saving={false}
        onKeepMine={vi.fn()}
        onTakeTheirs={vi.fn()}
        onMergeByHand={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("file-conflict-unavailable")).toBeTruthy());
    expect(screen.queryByTestId("file-conflict-diff")).toBeNull();
    expect(screen.getByRole("button", { name: "Discard my edit" })).toBeTruthy();
  });

  // Watches the bounded-diff path (plan.md §14.5's chunking bound):
  // a conflicting file larger than `MAX_DIFF_INPUT_LINES` must degrade
  // honestly — a visible truncation notice — rather than silently
  // presenting a cut-down comparison as if it were the whole file.
  it("shows FileDiffView's truncation banner rather than silently truncating a large conflicting file", async () => {
    const count = 1050;
    const localText = Array.from({ length: count }, (_, i) => `mine-${i}`).join("\n");
    const readFile = vi.fn(
      async (): Promise<FileReadResult> =>
        remoteFile({
          bytes: new TextEncoder().encode(
            Array.from({ length: count }, (_, i) => `theirs-${i}`).join("\n"),
          ),
        }),
    );
    render(
      <FileConflictResolutionPanel
        readClient={{ readFile }}
        workspaceRoot="/workspace"
        path="src/index.ts"
        version={READY_VERSION}
        localText={localText}
        saving={false}
        onKeepMine={vi.fn()}
        onTakeTheirs={vi.fn()}
        onMergeByHand={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(
      () => expect(screen.getByTestId("file-conflict-diff-body")).toBeTruthy(),
      LAZY_IMPORT_WAIT,
    );
    expect(screen.getByTestId("file-conflict-diff-truncated")).toBeTruthy();
  }, 20_000);
});
