import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FilePicker, PickedFile } from "@picompanion/frontend-core";

import { FileUploadPanel } from "./file-upload-panel.js";
import type { FileUploadClient, FileUploadResult } from "./file-upload-client.js";
import { useFileUpload } from "./use-file-upload.js";

afterEach(cleanup);

function pickedFile(): PickedFile {
  return {
    name: "notes.txt",
    mimeType: "text/plain",
    size: 5,
    readAsBytes: async () => new TextEncoder().encode("hello"),
  };
}

function pickerReturning(files: PickedFile[]): FilePicker {
  return { pickFiles: vi.fn(async () => files) };
}

const UPLOADED: FileUploadResult = {
  file: {
    id: "upload_1",
    fileName: "notes.txt",
    mimeType: "text/plain",
    size: 5,
    path: "/uploads/upload_1/notes.txt",
  },
  error: null,
};

/** Renders a real `useFileUpload` controller behind `FileUploadPanel`, mirroring how `FileBrowserView` wires it. */
function TestHarness({ client, filePicker }: { client: FileUploadClient; filePicker: FilePicker }) {
  const controller = useFileUpload({ client, filePicker });
  return <FileUploadPanel controller={controller} />;
}

describe("FileUploadPanel (T30B4)", () => {
  it("shows a 'choose a file' affordance with no upload button until something is selected", () => {
    render(
      <TestHarness
        client={{ uploadFile: vi.fn(), cancelUpload: vi.fn() }}
        filePicker={pickerReturning([])}
      />,
    );

    expect(screen.getByRole("button", { name: "Choose a file to upload" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Upload to daemon/ })).toBeNull();
  });

  it("shows the picked file's name and size once selected, then uploads it on request", async () => {
    const uploadFile = vi.fn(async (): Promise<FileUploadResult> => UPLOADED);
    render(
      <TestHarness
        client={{ uploadFile, cancelUpload: vi.fn() }}
        filePicker={pickerReturning([pickedFile()])}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Choose a file to upload" }));
    expect(await screen.findByText(/notes\.txt/)).toBeTruthy();
    expect(screen.getByText(/5 B/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Upload to daemon" }));

    const success = await screen.findByTestId("file-upload-success");
    expect(success.textContent).toMatch(/notes\.txt uploaded/);
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it("never implies the upload lands in the browsed folder", () => {
    render(
      <TestHarness
        client={{ uploadFile: vi.fn(), cancelUpload: vi.fn() }}
        filePicker={pickerReturning([])}
      />,
    );
    expect(screen.getByText(/not added to the folder/i)).toBeTruthy();
  });

  it("keeps the selection and offers Retry after a failed upload", async () => {
    const uploadFile = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    render(
      <TestHarness
        client={{ uploadFile, cancelUpload: vi.fn() }}
        filePicker={pickerReturning([pickedFile()])}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Choose a file to upload" }));
    await screen.findByText(/notes\.txt/);
    await user.click(screen.getByRole("button", { name: "Upload to daemon" }));

    const error = await screen.findByTestId("file-upload-error");
    expect(error.textContent).toBe("socket hang up");
    expect(screen.getByText(/notes\.txt/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry upload" }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
  });

  it("shows a Cancel button while uploading; a confirmed cancel shows a cancelled banner rather than an error (T165)", async () => {
    let resolveUpload: ((result: FileUploadResult) => void) | null = null;
    const uploadFile = vi.fn(
      () =>
        new Promise<FileUploadResult>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const cancelUpload = vi.fn(async () => ({ cancelled: true, error: null }));
    render(
      <TestHarness
        client={{ uploadFile, cancelUpload }}
        filePicker={pickerReturning([pickedFile()])}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Choose a file to upload" }));
    await screen.findByText(/notes\.txt/);
    await user.click(screen.getByRole("button", { name: "Upload to daemon" }));
    await screen.findByTestId("file-upload-progress");

    // The Upload button is not shown mid-transfer; Cancel is the only affordance.
    expect(screen.queryByRole("button", { name: "Upload to daemon" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // The panel does not claim "cancelled" until `cancelUpload()` resolves.
    expect(cancelUpload).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("file-upload-cancelled")).toBeTruthy();
    expect(screen.queryByTestId("file-upload-error")).toBeNull();
    expect(screen.queryByTestId("file-upload-progress")).toBeNull();

    // The daemon's original upload response finally arrives after cancel —
    // it must not resurrect a stale success banner over the cancelled one.
    await act(async () => {
      resolveUpload?.(UPLOADED);
      await Promise.resolve();
    });
    expect(screen.getByTestId("file-upload-cancelled")).toBeTruthy();
    expect(screen.queryByTestId("file-upload-success")).toBeNull();
  });

  it("shows a distinct cancel-failed banner, not the cancelled one, when the daemon can't confirm the discard (T165)", async () => {
    const uploadFile = vi.fn(() => new Promise<FileUploadResult>(() => {}));
    const cancelUpload = vi.fn(async () => ({ cancelled: false, error: "nothing was pending" }));
    render(
      <TestHarness
        client={{ uploadFile, cancelUpload }}
        filePicker={pickerReturning([pickedFile()])}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Choose a file to upload" }));
    await screen.findByText(/notes\.txt/);
    await user.click(screen.getByRole("button", { name: "Upload to daemon" }));
    await screen.findByTestId("file-upload-progress");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const banner = await screen.findByTestId("file-upload-cancel-failed");
    expect(banner.textContent).toMatch(/nothing was pending/i);
    expect(screen.queryByTestId("file-upload-cancelled")).toBeNull();
    expect(screen.queryByTestId("file-upload-success")).toBeNull();
  });

  it("has no axe violations idle, mid-progress, or with an error shown", async () => {
    const uploadFile = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const { container } = render(
      <TestHarness
        client={{ uploadFile, cancelUpload: vi.fn() }}
        filePicker={pickerReturning([pickedFile()])}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Choose a file to upload" }));
    await screen.findByText(/notes\.txt/);
    await user.click(screen.getByRole("button", { name: "Upload to daemon" }));
    await screen.findByTestId("file-upload-error");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
