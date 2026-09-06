import { describe, expect, it } from "vitest";

import type { Clock, TimerHandle } from "@picompanion/frontend-core";

import {
  FILE_WRITE_NOT_CONNECTED,
  FILE_WRITE_TIMEOUT,
  type FileBrowserClient,
  type FileReadResult,
  type FileWriteInput,
  type FileWriteResult,
} from "./file-browser-client";
import {
  DEFAULT_FILE_EDIT_TIMEOUT_MS,
  FILE_EDIT_LIMITS,
  MAX_EDITABLE_FILE_BYTES,
  MAX_EDITABLE_LINE_LENGTH,
  createFileEditController,
  describeFileEditLimits,
  explainFileEditLimitRefusal,
  longestLineLength,
  utf8ByteLength,
  writeFileWithTimeout,
} from "./file-edit-model";

/** Deterministic, manually-advanced `Clock` test double — mirrors `file-view-model.test.ts`'s `FakeClock`. */
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
    throw new Error("not used by file-edit-model");
  }

  clearInterval(): void {
    throw new Error("not used by file-edit-model");
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

/**
 * Builds ASCII content of exactly `byteTarget` UTF-8 bytes, split into
 * 99-character lines (well under `MAX_EDITABLE_LINE_LENGTH`) so a
 * byte-boundary test exercises only the byte ceiling, never
 * accidentally tripping the line-length one too (a single unbroken
 * `"x".repeat(byteTarget)` string would be one `byteTarget`-character
 * line, which the line-length check would refuse on its own well below
 * `MAX_EDITABLE_FILE_BYTES`).
 */
function contentOfExactByteSize(byteTarget: number): string {
  const block = `${"x".repeat(99)}\n`; // 100 ASCII bytes
  const blockCount = Math.floor(byteTarget / 100);
  const remainder = byteTarget - blockCount * 100;
  return block.repeat(blockCount) + "x".repeat(remainder);
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
    revision: "rev-1",
    ...overrides,
  };
}

/** A scripted `FileBrowserClient.writeFile`: `responses` maps a path to a `FileWriteResult` or `Error` to reject with. Records every call's input. */
function createScriptedWriteClient(responses: Map<string, FileWriteResult | Error>) {
  const calls: FileWriteInput[] = [];
  const client: FileBrowserClient = {
    listDirectory: () => Promise.reject(new Error("not used by file-edit-model tests")),
    writeFile(input) {
      calls.push(input);
      const next = responses.get(input.path);
      if (next === undefined) {
        return Promise.reject(new Error(`no scripted response for "${input.path}"`));
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return { client, calls };
}

const written = (overrides: Partial<Extract<FileWriteResult, { status: "written" }>> = {}) =>
  ({ status: "written", modifiedAt: "2026-01-02T00:00:00.000Z", size: 5, ...overrides }) as const;

// ---------------------------------------------------------------------------
// utf8ByteLength / longestLineLength
// ---------------------------------------------------------------------------

describe("utf8ByteLength", () => {
  it("counts ASCII as one byte per character", () => {
    expect(utf8ByteLength("hello")).toBe(5);
  });

  it("counts a multi-byte character correctly, including a surrogate-pair emoji as 4 bytes", () => {
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("longestLineLength", () => {
  it("returns the longest of several lines, not the total length", () => {
    expect(longestLineLength("a\nbbbbb\ncc")).toBe(5);
  });

  it("returns 0 for empty content", () => {
    expect(longestLineLength("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// describeFileEditLimits — always-visible, pre-typing
// ---------------------------------------------------------------------------

describe("describeFileEditLimits", () => {
  it("states both the byte and line-length ceilings in human units", () => {
    const text = describeFileEditLimits();
    expect(text).toMatch(`${Math.round(FILE_EDIT_LIMITS.maxFileBytes / 1024)} KB`);
    expect(text).toMatch(FILE_EDIT_LIMITS.maxLineLength.toLocaleString());
  });
});

// ---------------------------------------------------------------------------
// explainFileEditLimitRefusal — boundary exactly at the ceiling
// ---------------------------------------------------------------------------

describe("explainFileEditLimitRefusal", () => {
  it("allows editing exactly at the byte ceiling", () => {
    const content = contentOfExactByteSize(MAX_EDITABLE_FILE_BYTES);
    expect(utf8ByteLength(content)).toBe(MAX_EDITABLE_FILE_BYTES);
    expect(explainFileEditLimitRefusal(content)).toBeNull();
  });

  it("refuses editing exactly one byte past the ceiling, distinctly from the line-length refusal", () => {
    const content = contentOfExactByteSize(MAX_EDITABLE_FILE_BYTES + 1);
    const refusal = explainFileEditLimitRefusal(content);
    expect(refusal?.reason).toBe("too-large");
    expect(refusal?.description).toMatch(`${Math.round((MAX_EDITABLE_FILE_BYTES + 1) / 1024)} KB`);
  });

  it("allows editing a line exactly at the line-length ceiling", () => {
    const content = "x".repeat(MAX_EDITABLE_LINE_LENGTH);
    expect(explainFileEditLimitRefusal(content)).toBeNull();
  });

  it("refuses editing a line exactly one character past the line-length ceiling", () => {
    const content = "x".repeat(MAX_EDITABLE_LINE_LENGTH + 1);
    const refusal = explainFileEditLimitRefusal(content);
    expect(refusal?.reason).toBe("line-too-long");
    expect(refusal?.title).not.toBe(
      explainFileEditLimitRefusal("x".repeat(MAX_EDITABLE_FILE_BYTES + 1))?.title,
    );
  });

  it("a file under both ceilings, split across many short lines, is not refused even though its total size approaches the byte limit", () => {
    const line = "x".repeat(80);
    const content = Array(Math.floor((MAX_EDITABLE_FILE_BYTES - 100) / 81))
      .fill(line)
      .join("\n");
    expect(utf8ByteLength(content)).toBeLessThan(MAX_EDITABLE_FILE_BYTES);
    expect(explainFileEditLimitRefusal(content)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeFileWithTimeout — "writes go through daemon RPC"
// ---------------------------------------------------------------------------

describe("writeFileWithTimeout", () => {
  it("issues exactly one writeFile(input) call to the injected client", async () => {
    const clock = new FakeClock();
    const result = written();
    const { client, calls } = createScriptedWriteClient(new Map([["a.txt", result]]));
    const input: FileWriteInput = {
      cwd: "/ws",
      path: "a.txt",
      content: "hello",
      expectedModifiedAt: "2026-01-01T00:00:00.000Z",
    };

    const settled = await writeFileWithTimeout(client, input, clock, 1000);

    expect(calls).toEqual([input]);
    expect(settled).toBe(result);
  });

  it("rejects with FILE_WRITE_NOT_CONNECTED, with no RPC attempted and no timer armed, when the client has no writeFile", async () => {
    const clock = new FakeClock();
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
    };

    await expect(
      writeFileWithTimeout(
        client,
        { cwd: "/ws", path: "a.txt", content: "x", expectedModifiedAt: "now" },
        clock,
        1000,
      ),
    ).rejects.toThrow(FILE_WRITE_NOT_CONNECTED);
    expect(clock.pendingCount).toBe(0);
  });

  it("rejects with FILE_WRITE_TIMEOUT once the clock fires before the client answers — models a connection dropped mid-save", async () => {
    const clock = new FakeClock();
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
      writeFile: () => new Promise<FileWriteResult>(() => {}), // never settles
    };

    const result = writeFileWithTimeout(
      client,
      { cwd: "/ws", path: "a.txt", content: "x", expectedModifiedAt: "now" },
      clock,
      DEFAULT_FILE_EDIT_TIMEOUT_MS,
    );
    clock.advance(DEFAULT_FILE_EDIT_TIMEOUT_MS);
    await expect(result).rejects.toThrow(FILE_WRITE_TIMEOUT);
  });

  it("passes through a genuine transport rejection unchanged, distinct from the timeout sentinel", async () => {
    const clock = new FakeClock();
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
      writeFile: () => Promise.reject(new Error("socket hang up")),
    };

    await expect(
      writeFileWithTimeout(
        client,
        { cwd: "/ws", path: "a.txt", content: "x", expectedModifiedAt: "now" },
        clock,
        1000,
      ),
    ).rejects.toThrow("socket hang up");
  });
});

// ---------------------------------------------------------------------------
// createFileEditController
// ---------------------------------------------------------------------------

describe("createFileEditController", () => {
  it("starts in read mode with no limit refusal for an ordinary small file", () => {
    const file = textFile("notes.md", "hello");
    const { client } = createScriptedWriteClient(new Map());
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    const state = controller.getState();
    expect(state.mode).toBe("read");
    expect(state.limitRefusal).toBeNull();
  });

  it("startEditing seeds the buffer from the loaded content", () => {
    const file = textFile("notes.md", "hello world");
    const { client } = createScriptedWriteClient(new Map());
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello world",
      onSaved: () => {},
    });

    controller.startEditing();

    expect(controller.getState().mode).toBe("edit");
    expect(controller.getState().buffer).toBe("hello world");
  });

  it("startEditing is a no-op when the file is over the edit limits — the refusal was already visible before this call", () => {
    const oversized = contentOfExactByteSize(MAX_EDITABLE_FILE_BYTES + 1);
    const file = textFile("big.txt", oversized);
    const { client } = createScriptedWriteClient(new Map());
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: oversized,
      onSaved: () => {},
    });

    expect(controller.getState().limitRefusal?.reason).toBe("too-large");
    controller.startEditing();
    expect(controller.getState().mode).toBe("read");
  });

  it("updateBuffer is a no-op outside edit mode, and updates the buffer while editing", () => {
    const file = textFile("notes.md", "hello");
    const { client } = createScriptedWriteClient(new Map());
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    controller.updateBuffer("ignored");
    expect(controller.getState().buffer).toBe("");

    controller.startEditing();
    controller.updateBuffer("hello there");
    expect(controller.getState().buffer).toBe("hello there");
  });

  it("cancelEditing discards the buffer and returns to read mode", () => {
    const file = textFile("notes.md", "hello");
    const { client } = createScriptedWriteClient(new Map());
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    controller.startEditing();
    controller.updateBuffer("changed my mind");
    controller.cancelEditing();

    expect(controller.getState().mode).toBe("read");
    expect(controller.getState().buffer).toBe("");
  });

  it("a successful save clears the buffer, returns to read mode, and calls onSaved so the caller re-reads (the daemon is authoritative)", async () => {
    const file = textFile("notes.md", "hello");
    const { client, calls } = createScriptedWriteClient(new Map([["notes.md", written()]]));
    let savedCount = 0;
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {
        savedCount += 1;
      },
    });

    controller.startEditing();
    controller.updateBuffer("hello, edited");
    controller.save();

    expect(controller.getState().mode).toBe("saving");
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().mode).toBe("read");
    expect(controller.getState().buffer).toBe("");
    expect(savedCount).toBe(1);
    expect(calls).toEqual([
      {
        cwd: "/ws",
        path: "notes.md",
        content: "hello, edited",
        expectedModifiedAt: file.modifiedAt,
        expectedRevision: file.revision,
      },
    ]);
  });

  it("save() is a no-op unless mode is 'edit'", () => {
    const file = textFile("notes.md", "hello");
    const { client, calls } = createScriptedWriteClient(new Map([["notes.md", written()]]));
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    controller.save(); // still in "read" mode
    expect(calls).toHaveLength(0);
  });

  it("a buffer that grows past the byte limit while editing refuses locally, with NO RPC issued, and keeps the buffer", () => {
    const file = textFile("notes.md", "hello");
    const { client, calls } = createScriptedWriteClient(new Map([["notes.md", written()]]));
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    controller.startEditing();
    const tooBig = contentOfExactByteSize(MAX_EDITABLE_FILE_BYTES + 1);
    controller.updateBuffer(tooBig);
    controller.save();

    expect(calls).toHaveLength(0);
    const state = controller.getState();
    expect(state.mode).toBe("edit");
    expect(state.buffer).toBe(tooBig);
    expect(state.error?.reason).toBe("too-large");
  });

  it("a save rejected because the client has no writeFile keeps the buffer and names 'not connected'", async () => {
    const file = textFile("notes.md", "hello");
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
    };
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {
        throw new Error("onSaved must not be called on a failed save");
      },
    });

    controller.startEditing();
    controller.updateBuffer("edited while offline");
    controller.save();
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.mode).toBe("edit");
    expect(state.buffer).toBe("edited while offline");
    expect(state.error?.title).toBe("Not connected");
    expect(state.error?.isConflict).toBe(false);
  });

  it("a save that times out (connection dropped mid-save) keeps the buffer and returns to edit mode, not saving forever", async () => {
    const file = textFile("notes.md", "hello");
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
      writeFile: () => new Promise<FileWriteResult>(() => {}), // never settles
    };
    const clock = new FakeClock();
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {
        throw new Error("onSaved must not be called on a failed save");
      },
      clock,
      timeoutMs: 5000,
    });

    controller.startEditing();
    controller.updateBuffer("edited, then the connection dropped");
    controller.save();
    expect(controller.getState().mode).toBe("saving");

    clock.advance(5000);
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.mode).toBe("edit");
    expect(state.buffer).toBe("edited, then the connection dropped");
    expect(state.error?.title).toBe("Save timed out");
  });

  it("a save that resolves 'conflict' (file changed on disk since the read) keeps the buffer and flags isConflict", async () => {
    const file = textFile("notes.md", "hello");
    const conflictResult: FileWriteResult = {
      status: "conflict",
      version: { status: "ready", cwd: "/ws", path: "notes.md", size: 99, modifiedAt: "later" },
    };
    const { client } = createScriptedWriteClient(new Map([["notes.md", conflictResult]]));
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {
        throw new Error("onSaved must not be called on a lost race");
      },
    });

    controller.startEditing();
    controller.updateBuffer("my edit, based on stale content");
    controller.save();
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.mode).toBe("edit");
    expect(state.buffer).toBe("my edit, based on stale content");
    expect(state.error?.title).toBe("Someone else changed this file");
    expect(state.error?.isConflict).toBe(true);
  });

  it("a save that resolves 'error' (write rejected, e.g. permission denied) keeps the buffer and is not flagged as a conflict", async () => {
    const file = textFile("notes.md", "hello");
    const errorResult: FileWriteResult = { status: "error", error: "EACCES: permission denied" };
    const { client } = createScriptedWriteClient(new Map([["notes.md", errorResult]]));
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {
        throw new Error("onSaved must not be called on a rejected write");
      },
    });

    controller.startEditing();
    controller.updateBuffer("permission-denied edit");
    controller.save();
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.mode).toBe("edit");
    expect(state.buffer).toBe("permission-denied edit");
    expect(state.error?.title).toBe("Permission denied");
    expect(state.error?.isConflict).toBe(false);
  });

  it("cancelEditing is a no-op while a save is in flight", async () => {
    const file = textFile("notes.md", "hello");
    const client: FileBrowserClient = {
      listDirectory: () => Promise.reject(new Error("not used")),
      writeFile: () => new Promise<FileWriteResult>(() => {}), // never settles
    };
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    controller.startEditing();
    controller.updateBuffer("in flight");
    controller.save();
    expect(controller.getState().mode).toBe("saving");

    controller.cancelEditing();
    expect(controller.getState().mode).toBe("saving");
    expect(controller.getState().buffer).toBe("in flight");
  });

  // ---------------------------------------------------------------------
  // T153: pinned write basis + resumeSession (files-screen.tsx's rebuild)
  // ---------------------------------------------------------------------

  it("save() writes against the basis pinned at startEditing, not a live file object with different modifiedAt/revision", async () => {
    // Models `files-screen.tsx`'s FileEditableBody: `file` is what
    // startEditing() pins the basis from, but if this controller were
    // (wrongly) built fresh each render with the LATEST file passed
    // straight through unpinned, `save()` would read the newer
    // modifiedAt/revision live. Constructing with the original `file`
    // and asserting the write still carries ITS values, after nothing
    // else has changed, proves save() consults the pinned basis rather
    // than some other live source.
    const file = textFile("notes.md", "hello", {
      modifiedAt: "2026-01-01T00:00:00.000Z",
      revision: "rev-1",
    });
    const { client, calls } = createScriptedWriteClient(new Map([["notes.md", written()]]));
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    controller.startEditing();
    controller.updateBuffer("edited");
    controller.save();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual([
      {
        cwd: "/ws",
        path: "notes.md",
        content: "edited",
        expectedModifiedAt: "2026-01-01T00:00:00.000Z",
        expectedRevision: "rev-1",
      },
    ]);
  });

  it("getSession returns null in read mode, and a snapshot once editing starts", () => {
    const file = textFile("notes.md", "hello");
    const { client } = createScriptedWriteClient(new Map());
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    expect(controller.getSession()).toBeNull();

    controller.startEditing();
    controller.updateBuffer("in progress");
    expect(controller.getSession()).toEqual({
      buffer: "in progress",
      error: null,
      basis: { modifiedAt: file.modifiedAt, revision: file.revision },
    });
  });

  it("THE BUG THIS TASK FIXES: without resumeSession, a controller rebuilt for the same path with a fresh file/content — exactly what files-screen.tsx's useMemo produces on any re-read while mid-edit — starts in read mode with the buffer gone", () => {
    // This is `files-screen.tsx`'s pre-T153 useMemo body, reproduced
    // directly: `createFileEditController({ client, workspaceRoot, file,
    // content, onSaved })` with no resumeSession, called a second time
    // with a fresh `file` object for the SAME path once mid-edit.
    const originalFile = textFile("notes.md", "hello", {
      modifiedAt: "2026-01-01T00:00:00.000Z",
      revision: "rev-1",
    });
    const { client } = createScriptedWriteClient(new Map());
    const firstController = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file: originalFile,
      content: "hello",
      onSaved: () => {},
    });
    firstController.startEditing();
    firstController.updateBuffer("the user's unsaved typing");
    expect(firstController.getState().buffer).toBe("the user's unsaved typing");

    // A reconnect (or any other re-read) produces a NEW file object for
    // the same path with a bumped modifiedAt/revision. files-screen.tsx
    // rebuilds the controller from scratch for it.
    const reReadFile = textFile("notes.md", "hello", {
      modifiedAt: "2026-01-02T00:00:00.000Z",
      revision: "rev-2",
    });
    const rebuiltController = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file: reReadFile,
      content: "hello",
      onSaved: () => {},
      // resumeSession deliberately omitted — this is the old behaviour.
    });

    expect(rebuiltController.getState().mode).toBe("read");
    expect(rebuiltController.getState().buffer).toBe("");
  });

  it("with resumeSession, a controller rebuilt for the same file's fresh read resumes the buffer, keeps the ORIGINAL pinned basis, and flags remoteChanged", async () => {
    const originalFile = textFile("notes.md", "hello", {
      modifiedAt: "2026-01-01T00:00:00.000Z",
      revision: "rev-1",
    });
    const { client, calls } = createScriptedWriteClient(new Map([["notes.md", written()]]));
    const firstController = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file: originalFile,
      content: "hello",
      onSaved: () => {},
    });
    firstController.startEditing();
    firstController.updateBuffer("the user's unsaved typing");
    const session = firstController.getSession();
    expect(session).not.toBeNull();

    // Same simulated reconnect-driven re-read as the bug reproduction
    // above, but this time files-screen.tsx's ref-tracked resumeSession
    // is threaded through, matching what T153 wires into
    // FileEditableBody's useMemo.
    const reReadFile = textFile("notes.md", "hello", {
      modifiedAt: "2026-01-02T00:00:00.000Z",
      revision: "rev-2",
    });
    const rebuiltController = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file: reReadFile,
      content: "hello",
      onSaved: () => {},
      resumeSession: session,
    });

    const state = rebuiltController.getState();
    expect(state.mode).toBe("edit");
    expect(state.buffer).toBe("the user's unsaved typing");
    expect(state.remoteChanged).toBe(true);

    rebuiltController.save();
    await Promise.resolve();
    await Promise.resolve();

    // The write is still based on the ORIGINAL file's version, not the
    // re-read's — the pinned basis survived the rebuild.
    expect(calls).toEqual([
      {
        cwd: "/ws",
        path: "notes.md",
        content: "the user's unsaved typing",
        expectedModifiedAt: "2026-01-01T00:00:00.000Z",
        expectedRevision: "rev-1",
      },
    ]);
  });

  it("resumeSession is ignored once cancelEditing or a successful save has ended the session (getSession returns null again)", async () => {
    const file = textFile("notes.md", "hello");
    const { client } = createScriptedWriteClient(new Map([["notes.md", written()]]));
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    controller.startEditing();
    controller.updateBuffer("typed, then changed my mind");
    controller.cancelEditing();
    expect(controller.getSession()).toBeNull();

    controller.startEditing();
    controller.updateBuffer("typed again");
    controller.save();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().mode).toBe("read");
    expect(controller.getSession()).toBeNull();
  });

  it("subscribe delivers every state transition and unsubscribe stops delivery", async () => {
    const file = textFile("notes.md", "hello");
    const { client } = createScriptedWriteClient(new Map([["notes.md", written()]]));
    const controller = createFileEditController({
      client,
      workspaceRoot: "/ws",
      file,
      content: "hello",
      onSaved: () => {},
    });

    const seen: string[] = [];
    const unsubscribe = controller.subscribe((state) => seen.push(state.mode));

    controller.startEditing();
    controller.save();
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual(["edit", "saving", "read"]);

    unsubscribe();
    controller.startEditing();
    expect(seen).toEqual(["edit", "saving", "read"]); // no more deliveries
  });
});
