import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FilePicker, PickedFile } from "@picompanion/frontend-core";

import type {
  FileUploadCancelResult,
  FileUploadInput,
  FileUploadResult,
} from "./file-upload-client.js";
import { useFileUpload } from "./use-file-upload.js";

function pickedFile(overrides: Partial<PickedFile> = {}): PickedFile {
  return {
    name: "notes.txt",
    mimeType: "text/plain",
    size: 5,
    readAsBytes: async () => new TextEncoder().encode("hello"),
    ...overrides,
  };
}

function pickerReturning(files: PickedFile[]): FilePicker {
  return { pickFiles: vi.fn(async () => files) };
}

/** A promise plus its externally-callable settle functions, for pausing an async chain mid-flight in a test. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

/** A `cancelUpload` fake that never resolves — used to prove "never claim success while unanswered". */
function neverAnsweringCancelUpload() {
  return vi.fn(() => new Promise<FileUploadCancelResult>(() => {}));
}

describe("useFileUpload (T30B4)", () => {
  it("starts idle with no selection", () => {
    const { result } = renderHook(() =>
      useFileUpload({
        client: { uploadFile: vi.fn(), cancelUpload: vi.fn() },
        filePicker: pickerReturning([]),
      }),
    );
    expect(result.current.state).toEqual({
      status: "idle",
      selection: null,
      result: null,
      error: null,
    });
  });

  it("selectFile stages the picked file without uploading it", async () => {
    const uploadFile = vi.fn();
    const filePicker = pickerReturning([pickedFile()]);
    const { result } = renderHook(() =>
      useFileUpload({ client: { uploadFile, cancelUpload: vi.fn() }, filePicker }),
    );

    await act(async () => result.current.selectFile());

    expect(result.current.state.selection?.name).toBe("notes.txt");
    expect(result.current.state.status).toBe("idle");
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("reads and uploads the selection, ending in success with the daemon's attachment", async () => {
    const uploadFile = vi.fn(async (): Promise<FileUploadResult> => UPLOADED);
    const filePicker = pickerReturning([pickedFile()]);
    const { result } = renderHook(() =>
      useFileUpload({ client: { uploadFile, cancelUpload: vi.fn() }, filePicker }),
    );

    await act(async () => result.current.selectFile());
    act(() => result.current.upload());

    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(result.current.state.result).toEqual(UPLOADED.file);
    // T165: every attempt now carries its own `requestId` so a later
    // `cancel()` can name it to `client.cancelUpload()` — the exact value
    // is an internal correlation id, not something callers should pin.
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "notes.txt",
        mimeType: "text/plain",
        bytes: new TextEncoder().encode("hello"),
        requestId: expect.any(String),
      }),
    );
  });

  it("keeps the selection and explains a server-side guard failure", async () => {
    const uploadFile = vi.fn(
      async (): Promise<FileUploadResult> => ({
        file: null,
        error: "File too large — max 100 MB over mobile",
      }),
    );
    const filePicker = pickerReturning([pickedFile()]);
    const { result } = renderHook(() =>
      useFileUpload({ client: { uploadFile, cancelUpload: vi.fn() }, filePicker }),
    );

    await act(async () => result.current.selectFile());
    act(() => result.current.upload());

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.selection?.name).toBe("notes.txt");
    expect(result.current.state.error?.title).toMatch(/too large/i);
  });

  it("keeps the selection and explains a transport-level rejection", async () => {
    const uploadFile = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const filePicker = pickerReturning([pickedFile()]);
    const { result } = renderHook(() =>
      useFileUpload({ client: { uploadFile, cancelUpload: vi.fn() }, filePicker }),
    );

    await act(async () => result.current.selectFile());
    act(() => result.current.upload());

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.selection?.name).toBe("notes.txt");
    expect(result.current.state.error?.description).toBe("socket hang up");
  });

  it("retry re-uploads the same selection without re-prompting the picker", async () => {
    let attempt = 0;
    const uploadFile = vi.fn(async (): Promise<FileUploadResult> => {
      attempt += 1;
      if (attempt === 1) return { file: null, error: "socket hang up" };
      return UPLOADED;
    });
    const filePicker = pickerReturning([pickedFile()]);
    const { result } = renderHook(() =>
      useFileUpload({ client: { uploadFile, cancelUpload: vi.fn() }, filePicker }),
    );

    await act(async () => result.current.selectFile());
    act(() => result.current.upload());
    await waitFor(() => expect(result.current.state.status).toBe("error"));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    expect(filePicker.pickFiles).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledTimes(2);
  });

  it("reset clears the selection back to idle", async () => {
    const uploadFile = vi.fn(async (): Promise<FileUploadResult> => UPLOADED);
    const filePicker = pickerReturning([pickedFile()]);
    const { result } = renderHook(() =>
      useFileUpload({ client: { uploadFile, cancelUpload: vi.fn() }, filePicker }),
    );

    await act(async () => result.current.selectFile());
    act(() => result.current.upload());
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    act(() => result.current.reset());
    expect(result.current.state).toEqual({
      status: "idle",
      selection: null,
      result: null,
      error: null,
    });
  });

  describe("cancellation (T41A3, wired to a real opcode by T165)", () => {
    it("cancel() while reading the file's bytes prevents uploadFile from ever being called — no partial upload, and no cancel request is sent", async () => {
      const bytes = deferred<Uint8Array>();
      const uploadFile = vi.fn(async (): Promise<FileUploadResult> => UPLOADED);
      const cancelUpload = vi.fn(async () => ({ cancelled: true, error: null }));
      const filePicker = pickerReturning([pickedFile({ readAsBytes: () => bytes.promise })]);
      const { result } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      expect(result.current.state.status).toBe("reading");

      act(() => result.current.cancel());
      expect(result.current.state.status).toBe("cancelled");
      // Nothing has reached the daemon yet — no cancel opcode is needed.
      expect(cancelUpload).not.toHaveBeenCalled();

      // The read finally resolves after cancel — this must not resurrect
      // "uploading", and, decisively, must never reach `uploadFile`.
      await act(async () => {
        bytes.resolve(new TextEncoder().encode("hello"));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.state.status).toBe("cancelled");
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it("cancel() while uploading calls client.cancelUpload with the upload's own request id", async () => {
      const uploadResult = deferred<FileUploadResult>();
      let sentRequestId: string | undefined;
      const uploadFile = vi.fn((input: FileUploadInput) => {
        sentRequestId = input.requestId;
        return uploadResult.promise;
      });
      const cancelUpload = vi.fn(async () => ({ cancelled: true, error: null }));
      const filePicker = pickerReturning([pickedFile()]);
      const { result } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      await waitFor(() => expect(result.current.state.status).toBe("uploading"));

      expect(typeof sentRequestId).toBe("string");

      act(() => result.current.cancel());

      // T165's mutation target: this is the EFFECT a fix must produce,
      // not a status string.
      //
      // CORRECTED (P6-W18 merge gate): this claimed removing the
      // `cancelUpload` call "leaves every status-string assertion in this
      // file green". The gate ran exactly that mutation and got
      // `Tests 4 failed | 14 passed (18)` — this assertion at the line
      // below, plus three that fail on `'cancelling'` never advancing to
      // `'cancelled'` or `'cancel-failed'`. The suite is STRONGER than the
      // comment claimed; only the claim was wrong. The point it was making
      // stands: this line is the one that fails on the call itself, so it
      // is the one that would still catch a regression if the status
      // machine were reworked around it.
      expect(cancelUpload).toHaveBeenCalledTimes(1);
      expect(cancelUpload).toHaveBeenCalledWith(sentRequestId);
    });

    it("cancel() while uploading shows a transient 'cancelling' status until the daemon answers, then 'cancelled' once it confirms the discard", async () => {
      const uploadResult = deferred<FileUploadResult>();
      const uploadFile = vi.fn(() => uploadResult.promise);
      const cancelResult = deferred<FileUploadCancelResult>();
      const cancelUpload = vi.fn(() => cancelResult.promise);
      const filePicker = pickerReturning([pickedFile()]);
      const { result } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      await waitFor(() => expect(result.current.state.status).toBe("uploading"));

      act(() => result.current.cancel());
      // Not claimed "cancelled" yet — the daemon hasn't answered.
      expect(result.current.state.status).toBe("cancelling");

      await act(async () => {
        cancelResult.resolve({ cancelled: true, error: null });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.state.status).toBe("cancelled");

      // The original upload's own late response must not resurrect success.
      await act(async () => {
        uploadResult.resolve(UPLOADED);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.state.status).toBe("cancelled");
      expect(result.current.state.result).toBeNull();
    });

    it("cancel() while uploading ends at 'cancel-failed' — never 'cancelled' — when the daemon reports cancelled: false", async () => {
      const uploadResult = deferred<FileUploadResult>();
      const uploadFile = vi.fn(() => uploadResult.promise);
      const cancelUpload = vi.fn(async () => ({
        cancelled: false,
        error: "nothing was pending",
      }));
      const filePicker = pickerReturning([pickedFile()]);
      const { result } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      await waitFor(() => expect(result.current.state.status).toBe("uploading"));

      act(() => result.current.cancel());
      await waitFor(() => expect(result.current.state.status).toBe("cancel-failed"));

      expect(result.current.state.error?.description).toMatch(/nothing was pending/i);
    });

    it("cancel() while uploading ends at 'cancel-failed', not a claimed success, when cancelUpload rejects", async () => {
      const uploadResult = deferred<FileUploadResult>();
      const uploadFile = vi.fn(() => uploadResult.promise);
      const cancelUpload = vi.fn(async () => {
        throw new Error("socket hang up");
      });
      const filePicker = pickerReturning([pickedFile()]);
      const { result } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      await waitFor(() => expect(result.current.state.status).toBe("uploading"));

      act(() => result.current.cancel());
      await waitFor(() => expect(result.current.state.status).toBe("cancel-failed"));

      expect(result.current.state.status).not.toBe("success");
      expect(result.current.state.status).not.toBe("cancelled");
    });

    it("cancel() while uploading never claims success while cancelUpload's response never arrives", async () => {
      const uploadResult = deferred<FileUploadResult>();
      const uploadFile = vi.fn(() => uploadResult.promise);
      const cancelUpload = neverAnsweringCancelUpload();
      const filePicker = pickerReturning([pickedFile()]);
      const { result } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      await waitFor(() => expect(result.current.state.status).toBe("uploading"));

      act(() => result.current.cancel());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.state.status).toBe("cancelling");

      // The original upload's own late success must not surface either.
      await act(async () => {
        uploadResult.resolve(UPLOADED);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.state.status).toBe("cancelling");
      expect(result.current.state.result).toBeNull();
    });

    it("cancel() is a no-op while idle, and sends no cancel request", () => {
      const uploadFile = vi.fn();
      const cancelUpload = vi.fn();
      const filePicker = pickerReturning([]);
      const { result } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload }, filePicker }),
      );

      act(() => result.current.cancel());

      expect(result.current.state.status).toBe("idle");
      expect(cancelUpload).not.toHaveBeenCalled();
    });

    it("cancel() after a completed upload does not disturb the success state, and sends no cancel request", async () => {
      const uploadFile = vi.fn(async (): Promise<FileUploadResult> => UPLOADED);
      const cancelUpload = vi.fn();
      const filePicker = pickerReturning([pickedFile()]);
      const { result } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      await waitFor(() => expect(result.current.state.status).toBe("success"));

      act(() => result.current.cancel());

      expect(result.current.state.status).toBe("success");
      expect(cancelUpload).not.toHaveBeenCalled();
    });

    it("reset() during an in-flight upload discards a late result rather than resurrecting it over the fresh idle state", async () => {
      const uploadResult = deferred<FileUploadResult>();
      const uploadFile = vi.fn(() => uploadResult.promise);
      const filePicker = pickerReturning([pickedFile()]);
      const { result } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload: vi.fn() }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      await waitFor(() => expect(result.current.state.status).toBe("uploading"));

      act(() => result.current.reset());
      expect(result.current.state.status).toBe("idle");

      await act(async () => {
        uploadResult.resolve(UPLOADED);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.state).toEqual({
        status: "idle",
        selection: null,
        result: null,
        error: null,
      });
    });

    it("unmounting mid-upload does not throw when the daemon's response arrives afterward", async () => {
      const uploadResult = deferred<FileUploadResult>();
      const uploadFile = vi.fn(() => uploadResult.promise);
      const filePicker = pickerReturning([pickedFile()]);
      const { result, unmount } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload: vi.fn() }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      await waitFor(() => expect(result.current.state.status).toBe("uploading"));

      unmount();

      await expect(
        act(async () => {
          uploadResult.resolve(UPLOADED);
          await Promise.resolve();
          await Promise.resolve();
        }),
      ).resolves.not.toThrow();
    });

    it("unmounting while a cancel confirmation is pending does not throw when it finally arrives", async () => {
      const uploadResult = deferred<FileUploadResult>();
      const uploadFile = vi.fn(() => uploadResult.promise);
      const cancelResult = deferred<FileUploadCancelResult>();
      const cancelUpload = vi.fn(() => cancelResult.promise);
      const filePicker = pickerReturning([pickedFile()]);
      const { result, unmount } = renderHook(() =>
        useFileUpload({ client: { uploadFile, cancelUpload }, filePicker }),
      );

      await act(async () => result.current.selectFile());
      act(() => result.current.upload());
      await waitFor(() => expect(result.current.state.status).toBe("uploading"));

      act(() => result.current.cancel());
      unmount();

      await expect(
        act(async () => {
          cancelResult.resolve({ cancelled: true, error: null });
          await Promise.resolve();
          await Promise.resolve();
        }),
      ).resolves.not.toThrow();
    });
  });
});
