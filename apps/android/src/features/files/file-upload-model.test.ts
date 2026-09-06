import { describe, expect, it, vi } from "vitest";

import type { Clock, FilePicker, PickedFile, TimerHandle } from "@picompanion/frontend-core";

import {
  FILE_PICKER_PERMISSION_DENIED,
  FILE_PICKER_PERMISSION_DENIED_PERMANENTLY,
  FILE_PICKER_UNAVAILABLE,
} from "../../platform/file-picker";
import { MAX_UPLOAD_BYTES, type FileUploadResult } from "./file-browser-client";
import type { FileBrowserClient } from "./file-browser-client";
import { createFileUploadController, explainFilePickerRefusal } from "./file-upload-model";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Deterministic, manually-advanced `Clock` test double — same shape as `files-model.test.ts`'s `FakeClock`. */
class FakeClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { dueAt: number; callback: () => void }>();

  now(): number {
    return this.currentTime;
  }
  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.currentTime + delayMs, callback });
    return id as unknown as TimerHandle;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }
  setInterval(): TimerHandle {
    throw new Error("not used");
  }
  clearInterval(): void {
    throw new Error("not used");
  }
  advance(ms: number): void {
    this.currentTime += ms;
    const due = [...this.timers.entries()].filter(([, t]) => t.dueAt <= this.currentTime);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}

function fakePickedFile(overrides: Partial<PickedFile> & { name: string }): PickedFile {
  return {
    mimeType: "text/plain",
    readAsBytes: async () => new Uint8Array([1, 2, 3, 4]),
    ...overrides,
  };
}

function fakeFilePicker(files: PickedFile[]): FilePicker {
  return {
    pickFiles: async () => files,
  };
}

/** A `FileBrowserClient` whose `uploadFile` never settles until the test resolves/rejects it. Records every call's exact bytes so the round trip can be proven byte-for-byte. */
function createControllableUploadClient() {
  const calls: Array<{ fileName: string; mimeType: string; bytes: Uint8Array }> = [];
  let resolve!: (result: FileUploadResult) => void;
  let reject!: (error: Error) => void;
  const client: FileBrowserClient = {
    listDirectory: () => Promise.reject(new Error("not used")),
    uploadFile(input) {
      calls.push({ fileName: input.fileName, mimeType: input.mimeType, bytes: input.bytes });
      return new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
    },
  };
  return {
    client,
    calls,
    resolve: (r: FileUploadResult) => resolve(r),
    reject: (e: Error) => reject(e),
  };
}

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

describe("createFileUploadController — round trip", () => {
  it("selects, reads, and uploads a file, and what comes back out equals what went in", async () => {
    const payload = new Uint8Array(2048);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256; // non-trivial payload
    const picker = fakeFilePicker([
      fakePickedFile({
        name: "photo.bin",
        mimeType: "application/octet-stream",
        size: payload.length,
        readAsBytes: async () => payload,
      }),
    ]);
    const { client, calls, resolve } = createControllableUploadClient();
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    expect(controller.getState().selection?.name).toBe("photo.bin");

    controller.upload();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().status).toBe("uploading");
    expect(calls).toHaveLength(1);
    // Byte-for-byte round trip: the exact bytes read from the picker are
    // the exact bytes the client was asked to send.
    expect(calls[0].bytes).toEqual(payload);
    expect(calls[0].fileName).toBe("photo.bin");

    resolve({
      file: {
        id: "up1",
        fileName: "photo.bin",
        mimeType: "application/octet-stream",
        size: payload.length,
        path: "/staged/up1",
      },
      error: null,
    });
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("success");
    expect(state.result?.size).toBe(payload.length);
    expect(state.progress).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

describe("createFileUploadController — progress", () => {
  it("is indeterminate (null) throughout uploading and exactly 1 only on success — never a fake percentage", async () => {
    const picker = fakeFilePicker([fakePickedFile({ name: "a.txt" })]);
    const { client, resolve } = createControllableUploadClient();
    const controller = createFileUploadController({ client, filePicker: picker });
    const seen: Array<number | null> = [];
    controller.subscribe((s) => seen.push(s.progress));

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().status).toBe("uploading");
    expect(controller.getState().progress).toBeNull();

    resolve({
      file: { id: "u1", fileName: "a.txt", mimeType: "text/plain", size: 4, path: "/staged/u1" },
      error: null,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().progress).toBe(1);
    // Monotonic: every emitted value before the final 1 was null, never a
    // fractional number the protocol has no way to actually know.
    const withoutFinal = seen.slice(0, -1);
    expect(withoutFinal.every((p) => p === null)).toBe(true);
  });

  it("never reaches 1 on a failed upload", async () => {
    const picker = fakeFilePicker([fakePickedFile({ name: "a.txt" })]);
    const { client, reject } = createControllableUploadClient();
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();
    await Promise.resolve();
    reject(new Error("socket closed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().status).toBe("error");
    expect(controller.getState().progress).not.toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Pre-flight bound — tested exactly at the boundary
// ---------------------------------------------------------------------------

describe("createFileUploadController — MAX_UPLOAD_BYTES bound", () => {
  it("allows a selection exactly at the ceiling (known size) through to the RPC", async () => {
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES);
    const picker = fakeFilePicker([
      fakePickedFile({ name: "max.bin", size: MAX_UPLOAD_BYTES, readAsBytes: async () => bytes }),
    ]);
    const { client, calls } = createControllableUploadClient();
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().status).toBe("uploading");
    expect(calls).toHaveLength(1);
  });

  it("refuses a selection one byte over the ceiling before ever calling the RPC (known size)", async () => {
    const picker = fakeFilePicker([
      fakePickedFile({ name: "toobig.bin", size: MAX_UPLOAD_BYTES + 1 }),
    ]);
    const { client, calls } = createControllableUploadClient();
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("refused");
    expect(state.refusal?.title).toBe("This file is too large to upload");
    expect(calls).toHaveLength(0); // never reached the RPC — refused before the transfer starts
  });

  it("refuses one byte over the ceiling even when the picker didn't know the size up front (post-read, pre-RPC)", async () => {
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const picker = fakeFilePicker([
      fakePickedFile({
        name: "unknown-size.bin",
        size: undefined,
        readAsBytes: async () => oversized,
      }),
    ]);
    const { client, calls } = createControllableUploadClient();
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("refused");
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Recoverable failures
// ---------------------------------------------------------------------------

describe("createFileUploadController — recoverable failures", () => {
  it("not connected: preserves the selection and names the state", async () => {
    const picker = fakeFilePicker([fakePickedFile({ name: "a.txt" })]);
    const client: FileBrowserClient = { listDirectory: () => Promise.reject(new Error("n/a")) }; // no uploadFile
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("Not connected");
    expect(state.selection?.name).toBe("a.txt"); // preserved for retry
  });

  it("times out without a response, preserving the selection", async () => {
    const picker = fakeFilePicker([fakePickedFile({ name: "a.txt" })]);
    const { client } = createControllableUploadClient();
    const clock = new FakeClock();
    const controller = createFileUploadController({
      client,
      filePicker: picker,
      clock,
      timeoutMs: 5000,
    });

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(5000);
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("Upload timed out");
    expect(state.selection?.name).toBe("a.txt");
  });

  it("a dropped connection mid-transfer lands in error, never success, preserving the selection", async () => {
    const picker = fakeFilePicker([fakePickedFile({ name: "a.txt" })]);
    const { client, reject } = createControllableUploadClient();
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();
    await Promise.resolve();
    reject(new Error("socket hang up"));
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.result).toBeNull();
    expect(state.selection?.name).toBe("a.txt");
  });

  it("cancellation interleaved with an in-flight upload: the state moves to cancelled immediately, and a later success response is discarded, never presented as complete", async () => {
    const picker = fakeFilePicker([fakePickedFile({ name: "a.txt" })]);
    const { client, resolve } = createControllableUploadClient();
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().status).toBe("uploading");

    controller.cancel();
    expect(controller.getState().status).toBe("cancelled");
    expect(controller.getState().progress).not.toBe(1);

    // The in-flight promise resolves *after* cancel() — this is the
    // interleaving, not a before/after guard.
    resolve({
      file: { id: "u1", fileName: "a.txt", mimeType: "text/plain", size: 4, path: "/staged/u1" },
      error: null,
    });
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("cancelled"); // not flipped to "success" by the stale response
    expect(state.result).toBeNull();
    expect(state.progress).not.toBe(1);
  });

  it("retry re-runs the same selection without duplicating (a fresh single RPC call, same bytes)", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const picker = fakeFilePicker([
      fakePickedFile({ name: "a.txt", readAsBytes: async () => bytes }),
    ]);
    const { client, calls, reject } = createControllableUploadClient();
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    controller.upload();
    await Promise.resolve();
    await Promise.resolve();
    reject(new Error("socket hang up"));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().status).toBe("error");
    expect(calls).toHaveLength(1);

    controller.retry();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(2); // a fresh call, not a resumed/duplicated one
    expect(calls[1].bytes).toEqual(bytes);
  });
});

// ---------------------------------------------------------------------------
// selectFile
// ---------------------------------------------------------------------------

describe("createFileUploadController — selectFile", () => {
  // T78: a picker rejection used to be swallowed entirely (see this
  // controller's history) — an always-unavailable production
  // `FilePicker` (`../../platform/file-picker.ts`'s
  // `createUnavailableFilePicker`, mounted for real by `AppCore` as of
  // T78) made "Choose file" look like a dead button, with nothing
  // telling the user why. It now lands in the existing named
  // `"refused"` status instead.
  it("a denied-permission picker rejection lands in a named, visible refused state — not silently swallowed", async () => {
    const client: FileBrowserClient = { listDirectory: () => Promise.reject(new Error("n/a")) };
    const picker: FilePicker = {
      pickFiles: () => Promise.reject(new Error(FILE_PICKER_PERMISSION_DENIED)),
    };
    const controller = createFileUploadController({ client, filePicker: picker });
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.selectFile();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().status).toBe("refused");
    expect(controller.getState().refusal).toEqual(
      explainFilePickerRefusal(FILE_PICKER_PERMISSION_DENIED),
    );
    expect(listener).toHaveBeenCalled();
  });

  it("an unavailable-picker rejection (createUnavailableFilePicker's real production shape) lands in the same named refused state", async () => {
    const client: FileBrowserClient = { listDirectory: () => Promise.reject(new Error("n/a")) };
    const picker: FilePicker = {
      pickFiles: () => Promise.reject(new Error(FILE_PICKER_UNAVAILABLE)),
    };
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().status).toBe("refused");
    expect(controller.getState().refusal?.title).toBe("File picking isn't available");
  });

  it("a permanently-denied permission gets its own distinct title from a merely-denied one", async () => {
    const client: FileBrowserClient = { listDirectory: () => Promise.reject(new Error("n/a")) };
    const picker: FilePicker = {
      pickFiles: () => Promise.reject(new Error(FILE_PICKER_PERMISSION_DENIED_PERMANENTLY)),
    };
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().refusal?.title).toBe("Photo and file access blocked");
  });

  it("preserves the prior selection across a picker refusal, so retry() still has something to re-run", async () => {
    const client: FileBrowserClient = { listDirectory: () => Promise.reject(new Error("n/a")) };
    let call = 0;
    const picker: FilePicker = {
      pickFiles: () =>
        call++ === 0
          ? Promise.resolve([fakePickedFile({ name: "kept.txt" })])
          : Promise.reject(new Error(FILE_PICKER_UNAVAILABLE)),
    };
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    expect(controller.getState().selection?.name).toBe("kept.txt");

    controller.selectFile();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().status).toBe("refused");
    expect(controller.getState().selection?.name).toBe("kept.txt");
  });

  it("a no-op pick (user cancelled) leaves the prior selection untouched", async () => {
    const client: FileBrowserClient = { listDirectory: () => Promise.reject(new Error("n/a")) };
    const picker: FilePicker = { pickFiles: () => Promise.resolve([]) };
    const controller = createFileUploadController({ client, filePicker: picker });

    controller.selectFile();
    await Promise.resolve();
    expect(controller.getState().selection).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// explainFilePickerRefusal (T78)
// ---------------------------------------------------------------------------

describe("explainFilePickerRefusal", () => {
  it("gives each named sentinel its own distinct, non-empty title", () => {
    const denied = explainFilePickerRefusal(FILE_PICKER_PERMISSION_DENIED);
    const deniedPermanently = explainFilePickerRefusal(FILE_PICKER_PERMISSION_DENIED_PERMANENTLY);
    const unavailable = explainFilePickerRefusal(FILE_PICKER_UNAVAILABLE);

    const titles = [denied.title, deniedPermanently.title, unavailable.title];
    expect(new Set(titles).size).toBe(titles.length); // every sentinel reads distinctly
    for (const explanation of [denied, deniedPermanently, unavailable]) {
      expect(explanation.title.length).toBeGreaterThan(0);
      expect(explanation.description.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a generic, honest explanation for an unrecognized message rather than dropping it", () => {
    const explanation = explainFilePickerRefusal("some future picker's own message");
    expect(explanation.title).toBe("Couldn't open the file picker");
    expect(explanation.description).toBe("some future picker's own message");
  });

  it("falls back to a generic description for a genuinely empty message", () => {
    const explanation = explainFilePickerRefusal("");
    expect(explanation.description.length).toBeGreaterThan(0);
  });
});
