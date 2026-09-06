import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FakeAgentTurnClient, FakeFilePicker, makeFakePickedFile } from "./test-doubles.js";
import { formatAttachmentSize, useAttachments } from "./use-attachments.js";

/** Guards a `waitFor` that depends on this hook's own upload promise chains settling. */
const UPLOAD_SETTLE_WAIT = { timeout: 5_000 } as const;

describe("useAttachments", () => {
  it("starts with no staged attachments and no pending uploads", () => {
    const { result } = renderHook(() =>
      useAttachments({ filePicker: new FakeFilePicker(), client: new FakeAgentTurnClient() }),
    );
    expect(result.current.attachments).toEqual([]);
    expect(result.current.hasPendingUploads).toBe(false);
    expect(result.current.uploadedAttachments).toEqual([]);
  });

  it("stages then uploads a picked file, landing in 'uploaded' with the daemon's reference", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([makeFakePickedFile({ name: "notes.txt", mimeType: "text/plain" })]);
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    await act(async () => {
      await result.current.pickAndAddFiles();
    });

    // Immediately after staging, the upload may still be in flight —
    // FakeAgentTurnClient's default `uploadFileImpl` resolves on a real
    // microtask, so it can already be "uploaded" by the time this
    // assertion runs; either way `hasPendingUploads` must clear promptly.
    await waitFor(() => expect(result.current.hasPendingUploads).toBe(false), UPLOAD_SETTLE_WAIT);

    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]).toMatchObject({
      name: "notes.txt",
      mimeType: "text/plain",
      status: "uploaded",
    });
    expect(result.current.uploadedAttachments).toEqual([
      expect.objectContaining({ type: "uploaded_file", fileName: "notes.txt" }),
    ]);
    expect(client.uploadFileCalls).toEqual([
      expect.objectContaining({ fileName: "notes.txt", mimeType: "text/plain" }),
    ]);
  });

  it("rejects an oversized file locally, with a clear error, before any upload attempt", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([makeFakePickedFile({ name: "huge.bin", size: 200 * 1024 * 1024 })]);
    const { result } = renderHook(() =>
      useAttachments({ filePicker, client, maxBytes: 100 * 1024 * 1024 }),
    );

    await act(async () => {
      await result.current.pickAndAddFiles();
    });

    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].status).toBe("error");
    expect(result.current.attachments[0].error).toContain("huge.bin");
    expect(result.current.attachments[0].error).toMatch(/limit/i);
    expect(result.current.hasPendingUploads).toBe(false);
    expect(client.uploadFileCalls).toEqual([]);
  });

  it("surfaces a daemon upload rejection as a clear, retryable error", async () => {
    const client = new FakeAgentTurnClient();
    client.uploadFileImpl = async () => {
      throw new Error("Upload rejected: unsupported file type");
    };
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([makeFakePickedFile({ name: "script.exe" })]);
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    await act(async () => {
      await result.current.pickAndAddFiles();
    });

    await waitFor(
      () => expect(result.current.attachments[0]?.status).toBe("error"),
      UPLOAD_SETTLE_WAIT,
    );
    expect(result.current.attachments[0].error).toBe("Upload rejected: unsupported file type");
    expect(result.current.uploadedAttachments).toEqual([]);
  });

  it("retries an errored attachment, reusing the same picked file", async () => {
    const client = new FakeAgentTurnClient();
    let attempt = 0;
    client.uploadFileImpl = async (input) => {
      attempt += 1;
      if (attempt === 1) throw new Error("Connection dropped mid-upload");
      return {
        type: "uploaded_file",
        id: "upload-retry",
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.bytes.byteLength,
        path: "/uploads/upload-retry",
      };
    };
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([makeFakePickedFile({ name: "diagram.png", text: "pretend-bytes" })]);
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    await act(async () => {
      await result.current.pickAndAddFiles();
    });
    await waitFor(
      () => expect(result.current.attachments[0]?.status).toBe("error"),
      UPLOAD_SETTLE_WAIT,
    );
    expect(result.current.attachments[0].error).toBe("Connection dropped mid-upload");

    const id = result.current.attachments[0].id;
    act(() => result.current.retry(id));
    expect(result.current.attachments[0].status).toBe("uploading");

    await waitFor(
      () => expect(result.current.attachments[0]?.status).toBe("uploaded"),
      UPLOAD_SETTLE_WAIT,
    );
    expect(result.current.uploadedAttachments).toEqual([
      expect.objectContaining({ fileName: "diagram.png" }),
    ]);
  });

  it("leaves an attachment explicitly errored — never stuck 'uploading' forever — with no uploadFile support", async () => {
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([makeFakePickedFile({ name: "no-client.txt" })]);
    // A client wired without `uploadFile` (the "no client yet"/"unsupported
    // method" seam every other optional method in this feature already
    // uses) must not leave the attachment hanging in "uploading".
    const clientWithoutUpload = {
      sendAgentMessage: async () => {},
      cancelAgent: async () => {},
    };
    const { result } = renderHook(() =>
      useAttachments({ filePicker, client: clientWithoutUpload }),
    );

    await act(async () => {
      await result.current.pickAndAddFiles();
    });

    expect(result.current.attachments[0].status).toBe("error");
    expect(result.current.attachments[0].error).toMatch(/unavailable/i);
  });

  it("removes a staged attachment outright, regardless of its status", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([makeFakePickedFile({ name: "a.txt" })]);
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    await act(async () => {
      await result.current.pickAndAddFiles();
    });
    await waitFor(() => expect(result.current.hasPendingUploads).toBe(false), UPLOAD_SETTLE_WAIT);

    const id = result.current.attachments[0].id;
    act(() => result.current.remove(id));
    expect(result.current.attachments).toEqual([]);
  });

  it("clear() drops every staged attachment", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([
      makeFakePickedFile({ name: "a.txt" }),
      makeFakePickedFile({ name: "b.txt" }),
    ]);
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    await act(async () => {
      await result.current.pickAndAddFiles();
    });
    await waitFor(() => expect(result.current.attachments).toHaveLength(2), UPLOAD_SETTLE_WAIT);

    act(() => result.current.clear());
    expect(result.current.attachments).toEqual([]);
    expect(result.current.uploadedAttachments).toEqual([]);
  });

  it("resolves with nothing staged when the file picker returns no files (dialog dismissed)", async () => {
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([]);
    const { result } = renderHook(() =>
      useAttachments({ filePicker, client: new FakeAgentTurnClient() }),
    );

    await act(async () => {
      await result.current.pickAndAddFiles();
    });

    expect(result.current.attachments).toEqual([]);
  });
});

describe("formatAttachmentSize", () => {
  it("formats bytes, kilobytes, and megabytes for human display", () => {
    expect(formatAttachmentSize(340)).toBe("340 B");
    expect(formatAttachmentSize(9_400)).toBe("9.2 KB");
    expect(formatAttachmentSize(12 * 1024 * 1024)).toBe("12 MB");
  });
});
