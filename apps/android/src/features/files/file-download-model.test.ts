import { describe, expect, it } from "vitest";

import type { Clock, TimerHandle } from "@picompanion/frontend-core";

import { MAX_DOWNLOAD_BYTES, type FileDownloadTokenResult } from "./file-browser-client";
import type { FileBrowserClient } from "./file-browser-client";
import {
  createFileDownloadController,
  type DownloadFetch,
  type DownloadFetchResponse,
  type DownloadStreamReader,
} from "./file-download-model";

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

/** A `FileBrowserClient` whose `requestDownloadToken` never settles until the test resolves/rejects it. */
function createControllableTokenClient() {
  const calls: Array<{ cwd: string; path: string }> = [];
  let resolve!: (result: FileDownloadTokenResult) => void;
  let reject!: (error: Error) => void;
  const client: FileBrowserClient = {
    listDirectory: () => Promise.reject(new Error("not used")),
    requestDownloadToken(cwd, path) {
      calls.push({ cwd, path });
      return new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
    },
  };
  return {
    client,
    calls,
    resolve: (r: FileDownloadTokenResult) => resolve(r),
    reject: (e: Error) => reject(e),
  };
}

/** A `DownloadStreamReader` whose `read()` calls are resolved one at a time, under the test's explicit control — this is what makes the cancel-mid-chunk interleaving provable. */
function createManualReader() {
  const pending: Array<(step: { done: boolean; value?: Uint8Array }) => void> = [];
  let cancelCalled = false;
  const reader: DownloadStreamReader = {
    read: () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
    cancel: async () => {
      cancelCalled = true;
    },
  };
  return {
    reader,
    resolveNext: (step: { done: boolean; value?: Uint8Array }) => {
      const next = pending.shift();
      if (!next) throw new Error("no pending read() to resolve");
      next(step);
    },
    get pendingCount() {
      return pending.length;
    },
    get cancelCalled() {
      return cancelCalled;
    },
  };
}

function okResponse(reader: DownloadStreamReader): DownloadFetchResponse {
  return { ok: true, status: 200, body: { getReader: () => reader } };
}

function fixedToken(overrides: Partial<FileDownloadTokenResult> = {}): FileDownloadTokenResult {
  return {
    cwd: "/ws",
    path: "a.txt",
    token: "tok-1",
    fileName: "a.txt",
    mimeType: "text/plain",
    size: 8,
    error: null,
    ...overrides,
  };
}

/** Flushes enough microtask ticks for a chain of `.then()`s spanning the token request, the injected `fetchImpl`, and the read loop to fully settle before the next assertion or `resolveNext()` call. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const ORIGIN = "http://127.0.0.1:6768";

// ---------------------------------------------------------------------------
// Round trip + real progress
// ---------------------------------------------------------------------------

describe("createFileDownloadController — round trip and progress", () => {
  it("requests a token, streams two chunks with real byte progress, and what comes back out equals what went in", async () => {
    const { client, calls, resolve: resolveToken } = createControllableTokenClient();
    const manual = createManualReader();
    const fetchImpl: DownloadFetch = async () => okResponse(manual.reader);
    const controller = createFileDownloadController({ client, downloadOrigin: ORIGIN, fetchImpl });
    const progressSeen: Array<number | null> = [];
    controller.subscribe((s) => progressSeen.push(s.progress));

    controller.download("/ws", "a.txt", "a.txt");
    await flush();
    expect(calls).toEqual([{ cwd: "/ws", path: "a.txt" }]);
    expect(controller.getState().status).toBe("requesting-token");

    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); // non-trivial payload, split across chunks below
    resolveToken(fixedToken({ size: original.length }));
    await flush();
    await flush();
    expect(controller.getState().status).toBe("downloading");
    expect(controller.getState().progress).toBe(0);

    manual.resolveNext({ done: false, value: original.slice(0, 4) });
    await flush();
    await flush();
    expect(controller.getState().progress).toBeCloseTo(0.5, 5);

    manual.resolveNext({ done: false, value: original.slice(4, 8) });
    await flush();
    await flush();
    // All 8 bytes are in, but the transfer isn't confirmed done yet —
    // never shows 1 before the stream actually says so.
    expect(controller.getState().status).toBe("downloading");
    expect(controller.getState().progress).toBeLessThan(1);
    expect(controller.getState().progress).toBeGreaterThan(0.99);

    manual.resolveNext({ done: true });
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("success");
    expect(state.progress).toBe(1);
    expect(state.file?.bytes).toEqual(original); // byte-for-byte round trip
    expect(state.file?.size).toBe(8);

    // Monotonic non-decreasing across the whole run.
    const numeric = progressSeen.filter((p): p is number => p !== null);
    for (let i = 1; i < numeric.length; i++) {
      expect(numeric[i]).toBeGreaterThanOrEqual(numeric[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Pre-flight bound — tested exactly at the boundary
// ---------------------------------------------------------------------------

describe("createFileDownloadController — MAX_DOWNLOAD_BYTES bound", () => {
  it("allows a token exactly at the ceiling through to the fetch", async () => {
    const { client, resolve: resolveToken } = createControllableTokenClient();
    let fetchCalls = 0;
    const fetchImpl: DownloadFetch = async () => {
      fetchCalls += 1;
      return okResponse(createManualReader().reader);
    };
    const controller = createFileDownloadController({ client, downloadOrigin: ORIGIN, fetchImpl });

    controller.download("/ws", "big.bin", "big.bin");
    await flush();
    resolveToken(fixedToken({ size: MAX_DOWNLOAD_BYTES }));
    await flush();
    await flush();

    expect(controller.getState().status).toBe("downloading");
    expect(fetchCalls).toBe(1);
  });

  it("refuses one byte over the ceiling before ever calling fetch", async () => {
    const { client, resolve: resolveToken } = createControllableTokenClient();
    let fetchCalls = 0;
    const fetchImpl: DownloadFetch = async () => {
      fetchCalls += 1;
      throw new Error("should never be called");
    };
    const controller = createFileDownloadController({ client, downloadOrigin: ORIGIN, fetchImpl });

    controller.download("/ws", "huge.bin", "huge.bin");
    await flush();
    resolveToken(fixedToken({ size: MAX_DOWNLOAD_BYTES + 1 }));
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("refused");
    expect(state.refusal?.title).toBe("This file is too large to download");
    expect(fetchCalls).toBe(0); // refused before the transfer starts
  });
});

// ---------------------------------------------------------------------------
// Recoverable failures
// ---------------------------------------------------------------------------

describe("createFileDownloadController — recoverable failures", () => {
  it("not connected: names the state and never calls fetch", async () => {
    const client: FileBrowserClient = { listDirectory: () => Promise.reject(new Error("n/a")) }; // no requestDownloadToken
    let fetchCalls = 0;
    const fetchImpl: DownloadFetch = async () => {
      fetchCalls += 1;
      throw new Error("should never be called");
    };
    const controller = createFileDownloadController({ client, downloadOrigin: ORIGIN, fetchImpl });

    controller.download("/ws", "a.txt", "a.txt");
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("Not connected");
    expect(fetchCalls).toBe(0);
  });

  it("token request times out", async () => {
    const { client } = createControllableTokenClient();
    const clock = new FakeClock();
    const fetchImpl: DownloadFetch = async () => okResponse(createManualReader().reader);
    const controller = createFileDownloadController({
      client,
      downloadOrigin: ORIGIN,
      fetchImpl,
      clock,
      tokenTimeoutMs: 5000,
    });

    controller.download("/ws", "a.txt", "a.txt");
    await flush();
    clock.advance(5000);
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("Request timed out");
  });

  it("a business-level token failure (vanished file) never calls fetch", async () => {
    const { client, resolve: resolveToken } = createControllableTokenClient();
    let fetchCalls = 0;
    const fetchImpl: DownloadFetch = async () => {
      fetchCalls += 1;
      throw new Error("should never be called");
    };
    const controller = createFileDownloadController({ client, downloadOrigin: ORIGIN, fetchImpl });

    controller.download("/ws", "gone.txt", "gone.txt");
    await flush();
    resolveToken(
      fixedToken({ token: null, size: null, error: "ENOENT: no such file or directory" }),
    );
    await flush();
    await flush();

    expect(controller.getState().status).toBe("error");
    expect(controller.getState().error?.title).toBe("This file no longer exists");
    expect(fetchCalls).toBe(0);
  });

  it("no reachable origin: never calls fetch even though a token was issued", async () => {
    const { client, resolve: resolveToken } = createControllableTokenClient();
    let fetchCalls = 0;
    const fetchImpl: DownloadFetch = async () => {
      fetchCalls += 1;
      throw new Error("should never be called");
    };
    const controller = createFileDownloadController({ client, downloadOrigin: null, fetchImpl });

    controller.download("/ws", "a.txt", "a.txt");
    await flush();
    resolveToken(fixedToken());
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("Downloads aren't available yet");
    expect(fetchCalls).toBe(0);
  });

  it("T66: no origin over a relay connection names a distinct, permanent refusal — never the generic 'not available yet' message", async () => {
    const { client, resolve: resolveToken } = createControllableTokenClient();
    let fetchCalls = 0;
    const fetchImpl: DownloadFetch = async () => {
      fetchCalls += 1;
      throw new Error("should never be called");
    };
    const controller = createFileDownloadController({
      client,
      downloadOrigin: null,
      connectionPath: "relay",
      fetchImpl,
    });

    controller.download("/ws", "a.txt", "a.txt");
    await flush();
    resolveToken(fixedToken());
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("Downloads aren't available over a relay connection");
    expect(state.error?.title).not.toBe("Downloads aren't available yet");
    expect(fetchCalls).toBe(0);
  });

  it("a non-ok HTTP response is a recoverable error, never presented as success", async () => {
    const { client, resolve: resolveToken } = createControllableTokenClient();
    const fetchImpl: DownloadFetch = async () => ({ ok: false, status: 404, body: null });
    const controller = createFileDownloadController({ client, downloadOrigin: ORIGIN, fetchImpl });

    controller.download("/ws", "a.txt", "a.txt");
    await flush();
    resolveToken(fixedToken());
    await flush();
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.progress).not.toBe(1);
    expect(state.file).toBeNull();
  });

  it("a stream that ends before the declared size is reached is a transfer failure, never a truncated success", async () => {
    const { client, resolve: resolveToken } = createControllableTokenClient();
    const manual = createManualReader();
    const fetchImpl: DownloadFetch = async () => okResponse(manual.reader);
    const controller = createFileDownloadController({ client, downloadOrigin: ORIGIN, fetchImpl });

    controller.download("/ws", "a.txt", "a.txt");
    await flush();
    resolveToken(fixedToken({ size: 8 }));
    await flush();
    await flush();

    manual.resolveNext({ done: false, value: new Uint8Array([1, 2, 3, 4]) }); // only 4 of 8 declared bytes
    await flush();
    await flush();
    manual.resolveNext({ done: true }); // stream ends early — never reached 8
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.progress).not.toBe(1);
    expect(state.file).toBeNull(); // the partial 4 bytes are never presented as the file
  });

  it("cancellation interleaved with an in-flight chunk: the state moves to cancelled immediately, and a chunk that arrives after is discarded, never presented as complete", async () => {
    const { client, resolve: resolveToken } = createControllableTokenClient();
    const manual = createManualReader();
    const fetchImpl: DownloadFetch = async () => okResponse(manual.reader);
    const controller = createFileDownloadController({ client, downloadOrigin: ORIGIN, fetchImpl });

    controller.download("/ws", "a.txt", "a.txt");
    await flush();
    resolveToken(fixedToken({ size: 8 }));
    await flush();
    await flush();
    manual.resolveNext({ done: false, value: new Uint8Array([1, 2, 3, 4]) }); // first chunk lands normally
    await flush();
    await flush();
    expect(controller.getState().status).toBe("downloading");

    // A second read() is now in flight (awaiting resolveNext) when cancel() fires.
    controller.cancel();
    const progressAtCancel = controller.getState().progress;
    expect(controller.getState().status).toBe("cancelled");
    expect(progressAtCancel).not.toBe(1);
    expect(manual.cancelCalled).toBe(true); // best-effort real-reader cancel was invoked

    // The in-flight chunk arrives *after* cancel() — this is the
    // interleaving the criterion asks for, not a before/after guard. It
    // carries 4 more bytes, which — if wrongly applied — would push
    // `received` to the full declared size and `progress` up from its
    // value at the moment of cancel; asserting `progress` is *unchanged*
    // (not just "not exactly 1") proves the chunk had zero effect, not
    // merely that it didn't finish the job.
    manual.resolveNext({ done: false, value: new Uint8Array([5, 6, 7, 8]) });
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("cancelled"); // not flipped back to "downloading" or "success"
    expect(state.file).toBeNull();
    expect(state.progress).toBe(progressAtCancel); // the late chunk was discarded, not merely capped
  });

  it("retry after a cancelled attempt starts a fresh transfer, never duplicating the abandoned chunk", async () => {
    const { client, calls, resolve: resolveToken } = createControllableTokenClient();
    let attempt = 0;
    const readers: ReturnType<typeof createManualReader>[] = [];
    const fetchImpl: DownloadFetch = async () => {
      const manual = createManualReader();
      readers.push(manual);
      attempt += 1;
      return okResponse(manual.reader);
    };
    const controller = createFileDownloadController({ client, downloadOrigin: ORIGIN, fetchImpl });

    controller.download("/ws", "a.txt", "a.txt");
    await flush();
    resolveToken(fixedToken({ size: 8, token: "tok-1" }));
    await flush();
    await flush();
    readers[0]!.resolveNext({ done: false, value: new Uint8Array([1, 2, 3, 4]) }); // 4 of 8 bytes land
    await flush();
    await flush();
    controller.cancel();
    expect(controller.getState().status).toBe("cancelled");

    controller.retry();
    await flush();
    expect(calls).toHaveLength(2); // a fresh token request, not a resume
    resolveToken(fixedToken({ size: 4, token: "tok-2" })); // this attempt's file is smaller
    await flush();
    await flush();
    expect(controller.getState().progress).toBe(0); // restarted from zero, not continuing from 4/8
    readers[1]!.resolveNext({ done: false, value: new Uint8Array([9, 9, 9, 9]) });
    await flush();
    await flush();
    readers[1]!.resolveNext({ done: true });
    await flush();
    await flush();

    const state = controller.getState();
    expect(state.status).toBe("success");
    // Only the new attempt's bytes — nothing carried over from the
    // cancelled attempt's partial chunk.
    expect(state.file?.bytes).toEqual(new Uint8Array([9, 9, 9, 9]));
  });
});
