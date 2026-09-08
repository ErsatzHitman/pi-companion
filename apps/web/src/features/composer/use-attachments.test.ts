import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PickedFile } from "@picompanion/frontend-core";

import { FakeAgentTurnClient, FakeFilePicker, makeFakePickedFile } from "./test-doubles.js";
import { formatAttachmentSize, useAttachments } from "./use-attachments.js";

/** Guards a `waitFor` that depends on this hook's own upload promise chains settling. */
const UPLOAD_SETTLE_WAIT = { timeout: 5_000 } as const;

/**
 * jsdom does not implement `URL.createObjectURL`/`revokeObjectURL` (T279:
 * confirmed directly against this repo's own pinned jsdom before writing
 * these tests). Stubbed here, local to this file only, so
 * `useAttachments`'s preview code path — which itself guards for this
 * method being absent, for exactly this reason — has something to call in
 * tests that exercise it.
 */
function stubObjectUrl(): {
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
} {
  let counter = 0;
  const createObjectURL = vi.fn(() => `blob:mock-${(counter += 1)}`);
  const revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  return { createObjectURL, revokeObjectURL };
}

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

describe("useAttachments — addFiles is the same acceptance path as pickAndAddFiles (T279)", () => {
  it("stages and uploads a file passed via addFiles, exactly like a picked one", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    act(() => {
      result.current.addFiles([
        makeFakePickedFile({ name: "dropped.txt", mimeType: "text/plain" }),
      ]);
    });

    await waitFor(() => expect(result.current.hasPendingUploads).toBe(false), UPLOAD_SETTLE_WAIT);
    expect(result.current.attachments[0]).toMatchObject({
      name: "dropped.txt",
      status: "uploaded",
    });
    expect(client.uploadFileCalls).toEqual([expect.objectContaining({ fileName: "dropped.txt" })]);
  });

  it("rejects an oversized file from addFiles with the same ceiling pickAndAddFiles uses — no second acceptance path", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    const { result } = renderHook(() =>
      useAttachments({ filePicker, client, maxBytes: 100 * 1024 * 1024 }),
    );

    act(() => {
      result.current.addFiles([makeFakePickedFile({ name: "huge.bin", size: 200 * 1024 * 1024 })]);
    });

    expect(result.current.attachments[0].status).toBe("error");
    expect(result.current.attachments[0].error).toMatch(/limit/i);
    expect(client.uploadFileCalls).toEqual([]);
  });
});

describe("useAttachments — inline image previews (T279)", () => {
  let objectUrl: ReturnType<typeof stubObjectUrl>;

  beforeEach(() => {
    objectUrl = stubObjectUrl();
  });

  afterEach(() => {
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  it("gives an image attachment a previewUrl once it is ready", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    act(() => {
      result.current.addFiles([
        makeFakePickedFile({ name: "photo.png", mimeType: "image/png", text: "pixels" }),
      ]);
    });

    await waitFor(() => expect(result.current.attachments[0]?.previewUrl).toBeDefined());
    expect(result.current.attachments[0].previewUrl).toBe("blob:mock-1");
    expect(objectUrl.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("never creates a preview for a non-image attachment", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    act(() => {
      result.current.addFiles([makeFakePickedFile({ name: "notes.txt", mimeType: "text/plain" })]);
    });

    await waitFor(() => expect(result.current.hasPendingUploads).toBe(false), UPLOAD_SETTLE_WAIT);
    expect(result.current.attachments[0].previewUrl).toBeUndefined();
    expect(objectUrl.createObjectURL).not.toHaveBeenCalled();
  });

  it("revokes the object URL on remove()", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    act(() => {
      result.current.addFiles([makeFakePickedFile({ name: "photo.png", mimeType: "image/png" })]);
    });
    await waitFor(() => expect(result.current.attachments[0]?.previewUrl).toBeDefined());

    const id = result.current.attachments[0].id;
    act(() => result.current.remove(id));

    expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });

  it("revokes every staged preview's object URL on clear() (the same path submit() uses on send)", async () => {
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    act(() => {
      result.current.addFiles([
        makeFakePickedFile({ name: "one.png", mimeType: "image/png" }),
        makeFakePickedFile({ name: "two.png", mimeType: "image/png" }),
      ]);
    });
    await waitFor(() =>
      expect(result.current.attachments.every((entry) => entry.previewUrl)).toBe(true),
    );

    act(() => result.current.clear());

    expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith("blob:mock-2");
    expect(result.current.attachments).toEqual([]);
  });

  it("revokes the preview's object URL rather than attaching it, when remove() ran before the preview's own read settled", async () => {
    let resolveBytes: (bytes: Uint8Array) => void = () => {};
    const slowFile: PickedFile = {
      name: "slow.png",
      mimeType: "image/png",
      size: 3,
      readAsBytes: () =>
        new Promise<Uint8Array>((resolve) => {
          resolveBytes = resolve;
        }),
    };
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    act(() => {
      result.current.addFiles([slowFile]);
    });
    const id = result.current.attachments[0].id;

    // Removed before the preview's own `readAsBytes()` ever resolves —
    // this is the case `createPreview`'s `liveAttachmentIdsRef` check
    // exists for.
    act(() => result.current.remove(id));
    expect(result.current.attachments).toEqual([]);

    // Now let that slow read settle, driving `createPreview`'s async
    // continuation to completion.
    await act(async () => {
      resolveBytes(new Uint8Array([1, 2, 3]));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(objectUrl.createObjectURL).toHaveBeenCalledTimes(1);
    expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    // Never resurrected into state after having been removed.
    expect(result.current.attachments).toEqual([]);
  });

  it("does not throw when URL.createObjectURL is unavailable — a preview is best-effort", async () => {
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    const { result } = renderHook(() => useAttachments({ filePicker, client }));

    act(() => {
      result.current.addFiles([makeFakePickedFile({ name: "photo.png", mimeType: "image/png" })]);
    });

    await waitFor(() => expect(result.current.hasPendingUploads).toBe(false), UPLOAD_SETTLE_WAIT);
    expect(result.current.attachments[0].status).toBe("uploaded");
    expect(result.current.attachments[0].previewUrl).toBeUndefined();
  });
});

describe("formatAttachmentSize", () => {
  it("formats bytes, kilobytes, and megabytes for human display", () => {
    expect(formatAttachmentSize(340)).toBe("340 B");
    expect(formatAttachmentSize(9_400)).toBe("9.2 KB");
    expect(formatAttachmentSize(12 * 1024 * 1024)).toBe("12 MB");
  });
});
