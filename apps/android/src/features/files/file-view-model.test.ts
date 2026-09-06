import { describe, expect, it } from "vitest";

import type { Clock, TimerHandle } from "@picompanion/frontend-core";

import {
  FILE_READ_NOT_CONNECTED,
  FILE_READ_TIMEOUT,
  MAX_PREVIEWABLE_FILE_BYTES,
  type FileBrowserClient,
  type FileReadResult,
} from "./file-browser-client";
import {
  createFileViewController,
  initialFileViewState,
  readFileWithTimeout,
  refuseFileViewForSize,
} from "./file-view-model";

/** Deterministic, manually-advanced `Clock` test double — mirrors `files-model.test.ts`'s `FakeClock`. */
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
    throw new Error("not used by file-view-model");
  }

  clearInterval(): void {
    throw new Error("not used by file-view-model");
  }

  advance(ms: number): void {
    this.currentTime += ms;
    const due = [...this.timers.entries()].filter(([, t]) => t.dueAt <= this.currentTime);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }

  get pendingCount(): number {
    return this.timers.size;
  }
}

function textFile(
  path: string,
  content: string,
  overrides: Partial<FileReadResult> = {},
): FileReadResult {
  return {
    path,
    kind: "text",
    bytes: new TextEncoder().encode(content),
    mime: "text/plain",
    size: content.length,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A scripted `FileBrowserClient.readFile`: `responses` maps a path to a `FileReadResult` or `Error` to reject with. Records every call's (cwd, path). */
function createScriptedReadClient(responses: Map<string, FileReadResult | Error>) {
  const calls: Array<{ cwd: string; path: string }> = [];
  const client: FileBrowserClient = {
    listDirectory: () => Promise.reject(new Error("not used by file-view-model tests")),
    readFile(cwd, path) {
      calls.push({ cwd, path });
      const next = responses.get(path);
      if (next === undefined) {
        return Promise.reject(new Error(`no scripted response for "${path}"`));
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return { client, calls };
}

// ---------------------------------------------------------------------------
// refuseFileViewForSize
// ---------------------------------------------------------------------------

describe("refuseFileViewForSize", () => {
  it("names the oversized refusal distinctly, with the actual size in the description", () => {
    const state = refuseFileViewForSize("big.log", MAX_PREVIEWABLE_FILE_BYTES + 2048);
    expect(state.status).toBe("refused");
    expect(state.refusal?.title).toBe("This file is too large to preview");
    expect(state.refusal?.description).toMatch(/1026 KB/);
  });
});

// ---------------------------------------------------------------------------
// readFileWithTimeout — "reads go through daemon RPC"
// ---------------------------------------------------------------------------

describe("readFileWithTimeout", () => {
  it("issues exactly one readFile(cwd, path) call to the injected client — the only seam for a read", async () => {
    const clock = new FakeClock();
    const file = textFile("docs/readme.md", "hello");
    const { client, calls } = createScriptedReadClient(new Map([["docs/readme.md", file]]));

    const result = await readFileWithTimeout(client, "/ws", "docs/readme.md", clock, 1000);

    expect(calls).toEqual([{ cwd: "/ws", path: "docs/readme.md" }]);
    expect(result).toBe(file);
  });

  it("rejects with FILE_READ_NOT_CONNECTED, with no RPC attempted, when the client has no readFile", async () => {
    const clock = new FakeClock();
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
    };

    await expect(readFileWithTimeout(client, "/ws", "a.txt", clock, 1000)).rejects.toThrow(
      FILE_READ_NOT_CONNECTED,
    );
    expect(clock.pendingCount).toBe(0);
  });

  it("rejects with FILE_READ_TIMEOUT once the clock fires before the client answers", async () => {
    const clock = new FakeClock();
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
      readFile: () => new Promise<FileReadResult>(() => {}), // never settles
    };

    const result = readFileWithTimeout(client, "/ws", "a.txt", clock, 1000);
    clock.advance(1000);
    await expect(result).rejects.toThrow(FILE_READ_TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// createFileViewController
// ---------------------------------------------------------------------------

describe("createFileViewController", () => {
  it("reads the given path through the client on construction and reaches 'ready' for a small text file", async () => {
    const file = textFile("notes.md", "# hi");
    const { client, calls } = createScriptedReadClient(new Map([["notes.md", file]]));

    const controller = createFileViewController({ client, workspaceRoot: "/ws", path: "notes.md" });
    expect(controller.getState().status).toBe("loading");
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("ready");
    expect(state.file).toBe(file);
    expect(calls).toEqual([{ cwd: "/ws", path: "notes.md" }]);
  });

  it("refuses a binary file distinctly from an oversized or daemon-error refusal", async () => {
    const file = textFile("photo.bin", "", { kind: "binary", mime: "application/octet-stream" });
    const { client } = createScriptedReadClient(new Map([["photo.bin", file]]));

    const controller = createFileViewController({
      client,
      workspaceRoot: "/ws",
      path: "photo.bin",
    });
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("refused");
    expect(state.refusal?.title).toBe("This is a binary file");
  });

  it("refuses an image file with its own distinct title, not the binary one", async () => {
    const file = textFile("logo.png", "", { kind: "image", mime: "image/png" });
    const { client } = createScriptedReadClient(new Map([["logo.png", file]]));

    const controller = createFileViewController({ client, workspaceRoot: "/ws", path: "logo.png" });
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("refused");
    expect(state.refusal?.title).toBe("This is an image file");
    expect(state.refusal?.title).not.toBe("This is a binary file");
  });

  it("names a not-found read distinctly from a permission-denied one", async () => {
    const { client: notFoundClient } = createScriptedReadClient(
      new Map([["gone.txt", new Error("ENOENT: no such file or directory")]]),
    );
    const notFound = createFileViewController({
      client: notFoundClient,
      workspaceRoot: "/ws",
      path: "gone.txt",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(notFound.getState().error?.title).toBe("This file no longer exists");

    const { client: deniedClient } = createScriptedReadClient(
      new Map([["secret.txt", new Error("EACCES: permission denied")]]),
    );
    const denied = createFileViewController({
      client: deniedClient,
      workspaceRoot: "/ws",
      path: "secret.txt",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(denied.getState().error?.title).toBe("Permission denied");
    expect(denied.getState().error?.title).not.toBe(notFound.getState().error?.title);
  });

  it("names a timed-out read via the injected clock, distinct from every other error", async () => {
    const clock = new FakeClock();
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
      readFile: () => new Promise(() => {}), // never settles
    };

    const controller = createFileViewController({
      client,
      workspaceRoot: "/ws",
      path: "slow.txt",
      clock,
      timeoutMs: 5000,
    });
    expect(controller.getState().status).toBe("loading");
    clock.advance(5000);
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("Request timed out");
    expect(state.error?.raw).toBe(FILE_READ_TIMEOUT);
  });

  // --- The size boundary: exactly at the ceiling, and exactly one byte past it. ---

  it("previews a file whose listed size is exactly at the ceiling — the RPC is still issued", async () => {
    const content = "x".repeat(MAX_PREVIEWABLE_FILE_BYTES);
    const file = textFile("at-limit.txt", content);
    const { client, calls } = createScriptedReadClient(new Map([["at-limit.txt", file]]));

    const controller = createFileViewController({
      client,
      workspaceRoot: "/ws",
      path: "at-limit.txt",
      sizeHint: MAX_PREVIEWABLE_FILE_BYTES,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect(controller.getState().status).toBe("ready");
  });

  it("refuses a file whose listed size is one byte over the ceiling, WITHOUT ever calling readFile", async () => {
    const { client, calls } = createScriptedReadClient(new Map());

    const controller = createFileViewController({
      client,
      workspaceRoot: "/ws",
      path: "over-limit.txt",
      sizeHint: MAX_PREVIEWABLE_FILE_BYTES + 1,
    });

    expect(controller.getState().status).toBe("refused");
    expect(controller.getState().refusal?.title).toBe("This file is too large to preview");
    // No microtask flush needed: the size pre-check settles synchronously,
    // proving no RPC round-trip was ever started for this refusal.
    expect(calls).toHaveLength(0);
  });

  it("refuses via the post-read size check when no sizeHint was given but the read result itself is oversized", async () => {
    const content = "y".repeat(MAX_PREVIEWABLE_FILE_BYTES + 1);
    const file = textFile("unlisted-big.txt", content);
    const { client, calls } = createScriptedReadClient(new Map([["unlisted-big.txt", file]]));

    const controller = createFileViewController({
      client,
      workspaceRoot: "/ws",
      path: "unlisted-big.txt",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(1); // the RPC *was* issued — no sizeHint to pre-check against
    expect(controller.getState().status).toBe("refused");
    expect(controller.getState().refusal?.title).toBe("This file is too large to preview");
  });

  it("retry() re-issues the read, including the size pre-check", async () => {
    const { client, calls } = createScriptedReadClient(new Map());
    const controller = createFileViewController({
      client,
      workspaceRoot: "/ws",
      path: "over-limit.txt",
      sizeHint: MAX_PREVIEWABLE_FILE_BYTES + 1,
    });
    expect(controller.getState().status).toBe("refused");

    controller.retry();
    expect(controller.getState().status).toBe("refused");
    expect(calls).toHaveLength(0);
  });

  it("subscribe() delivers every transition and unsubscribe() stops delivery", async () => {
    const file = textFile("notes.md", "hi");
    const { client } = createScriptedReadClient(new Map([["notes.md", file]]));
    const controller = createFileViewController({ client, workspaceRoot: "/ws", path: "notes.md" });
    const seen: string[] = [];
    const unsubscribe = controller.subscribe((state) => seen.push(state.status));
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(["ready"]);

    unsubscribe();
    controller.retry();
    await Promise.resolve();
    expect(seen).toEqual(["ready"]);
  });

  it("ignores a stale response from a superseded request (retry beats a slow first read)", async () => {
    let resolveFirst!: (file: FileReadResult) => void;
    const calls: string[] = [];
    let callCount = 0;
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
      readFile(_cwd, path) {
        callCount += 1;
        calls.push(path);
        if (callCount === 1) {
          return new Promise((res) => {
            resolveFirst = res;
          });
        }
        return Promise.resolve(textFile(path, "second"));
      },
    };
    const controller = createFileViewController({ client, workspaceRoot: "/ws", path: "f.txt" });
    controller.retry();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().file?.mime).toBe("text/plain");
    expect(controller.getState().status).toBe("ready");

    // The stale first read now resolves late; it must not clobber the retry's result.
    resolveFirst(textFile("f.txt", "first", { revision: "stale" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().file?.revision).toBeUndefined();
  });
});

describe("initialFileViewState", () => {
  it("starts loading, with no file/refusal/error populated yet", () => {
    const state = initialFileViewState("a.txt");
    expect(state).toEqual({
      path: "a.txt",
      status: "loading",
      file: null,
      refusal: null,
      error: null,
    });
  });
});
