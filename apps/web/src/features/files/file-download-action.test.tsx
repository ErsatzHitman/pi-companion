import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileDownloadAction } from "./file-download-action.js";
import type { FileDownloadClient, FileDownloadTokenResult } from "./file-download-client.js";
import type { MinimalFetch, MinimalFetchResponse } from "./use-file-download.js";
import { useFileDownload } from "./use-file-download.js";

afterEach(cleanup);

function tokenResult(overrides: Partial<FileDownloadTokenResult> = {}): FileDownloadTokenResult {
  return {
    cwd: "/workspace",
    path: "README.md",
    token: "tok_1",
    fileName: "README.md",
    mimeType: "text/markdown",
    size: 10,
    error: null,
    ...overrides,
  };
}

function fetchStreaming(chunks: Uint8Array[]): MinimalFetch {
  return async (): Promise<MinimalFetchResponse> => {
    let index = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (index >= chunks.length) return { done: true };
            const value = chunks[index];
            index += 1;
            return { done: false, value };
          },
        }),
      },
    };
  };
}

/** Streams one chunk, then stalls forever on the next `read()` — long enough for a test to click Cancel while still "downloading". */
function fetchStreamingThenStall(firstChunk: Uint8Array): MinimalFetch {
  return async (): Promise<MinimalFetchResponse> => {
    let readCount = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            readCount += 1;
            if (readCount === 1) return { done: false, value: firstChunk };
            return new Promise(() => {
              // never resolves
            });
          },
        }),
      },
    };
  };
}

/** Two `FileDownloadAction`s sharing one controller, mirroring `FileBrowserEntryList` rendering two file rows. */
function TestHarness({
  client,
  fetchImpl,
}: {
  client: FileDownloadClient;
  fetchImpl?: MinimalFetch;
}) {
  const controller = useFileDownload({
    client,
    downloadOrigin: "http://127.0.0.1:6768",
    fetchImpl,
    saveBlob: vi.fn(),
  });
  return (
    <>
      <FileDownloadAction
        controller={controller}
        cwd="/workspace"
        path="README.md"
        fileName="README.md"
      />
      <FileDownloadAction
        controller={controller}
        cwd="/workspace"
        path="NOTES.md"
        fileName="NOTES.md"
      />
    </>
  );
}

describe("FileDownloadAction (T30B4)", () => {
  it("shows a Download button for each file, both enabled while idle", () => {
    render(<TestHarness client={{ requestDownloadToken: vi.fn() }} />);

    const buttons = screen.getAllByRole("button", { name: "Download" });
    expect(buttons).toHaveLength(2);
    expect(buttons[0].hasAttribute("disabled")).toBe(false);
    expect(buttons[1].hasAttribute("disabled")).toBe(false);
  });

  it("shows progress only for the row being downloaded, and completes it", async () => {
    const client: FileDownloadClient = { requestDownloadToken: vi.fn(async () => tokenResult()) };
    const fetchImpl = fetchStreaming([new Uint8Array(10)]);
    render(<TestHarness client={client} fetchImpl={fetchImpl} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-download-button-README.md"));

    await waitFor(() => expect(screen.getByTestId("file-download-success-README.md")).toBeTruthy());
    expect(screen.queryByTestId("file-download-progress-NOTES.md")).toBeNull();
    expect(screen.queryByTestId("file-download-success-NOTES.md")).toBeNull();
  });

  it("shows a retryable error on the active row without disabling the other row", async () => {
    const client: FileDownloadClient = {
      requestDownloadToken: vi.fn(async () =>
        tokenResult({ token: null, error: "cwd is required" }),
      ),
    };
    render(<TestHarness client={client} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-download-button-README.md"));

    const error = await screen.findByTestId("file-download-error-README.md");
    expect(error.textContent).toMatch(/cwd is required/i);
    expect(screen.getByRole("button", { name: "Retry download" })).toBeTruthy();
    expect(screen.getByTestId("file-download-button-NOTES.md").hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("shows a Cancel button while downloading, and cancelling shows a cancelled banner instead of progress", async () => {
    const client: FileDownloadClient = {
      requestDownloadToken: vi.fn(async () => tokenResult({ size: 20 })),
    };
    const fetchImpl = fetchStreamingThenStall(new Uint8Array(5));
    render(<TestHarness client={client} fetchImpl={fetchImpl} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("file-download-button-README.md"));
    await screen.findByTestId("file-download-progress-README.md");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByTestId("file-download-cancelled-README.md")).toBeTruthy();
    expect(screen.queryByTestId("file-download-progress-README.md")).toBeNull();
    // The other row is untouched.
    expect(screen.getByTestId("file-download-button-NOTES.md").hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("has no axe violations idle, mid-progress, or with an error shown", async () => {
    const client: FileDownloadClient = {
      requestDownloadToken: vi.fn(async () =>
        tokenResult({ token: null, error: "cwd is required" }),
      ),
    };
    const { container } = render(<TestHarness client={client} />);
    expect(await axe(container)).toHaveNoViolations();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("file-download-button-README.md"));
    await screen.findByTestId("file-download-error-README.md");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
