import { describe, expect, it } from "vitest";

import type { Clock, TimerHandle } from "@picompanion/frontend-core";

import { FILE_BROWSER_TIMEOUT } from "./file-browser-client";
import type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserEntry,
} from "./file-browser-client";
import {
  buildFilesBreadcrumbs,
  createFilesBrowserController,
  listDirectoryWithTimeout,
  normalizeFilesPath,
  parentFilesPath,
  pathSegments,
  sortFilesEntries,
} from "./files-model";

// ---------------------------------------------------------------------------
// Path / breadcrumb / sort utilities
// ---------------------------------------------------------------------------

describe("normalizeFilesPath", () => {
  it("strips empty and '.' segments and trims whitespace", () => {
    expect(normalizeFilesPath("/a//b/./c/")).toBe("a/b/c");
    expect(normalizeFilesPath("  a / b  ")).toBe("a/b");
    expect(normalizeFilesPath("")).toBe("");
    expect(normalizeFilesPath(".")).toBe("");
  });
});

describe("pathSegments / parentFilesPath", () => {
  it("splits a normalized path into segments", () => {
    expect(pathSegments("a/b/c")).toEqual(["a", "b", "c"]);
    expect(pathSegments("")).toEqual([]);
  });

  it("returns null for the workspace root's parent", () => {
    expect(parentFilesPath("")).toBeNull();
  });

  it("returns the workspace root for a top-level directory's parent", () => {
    expect(parentFilesPath("docs")).toBe("");
  });

  it("strips exactly one segment for a nested directory", () => {
    expect(parentFilesPath("docs/plans")).toBe("docs");
  });
});

describe("buildFilesBreadcrumbs", () => {
  it("is just the root crumb, marked current, at the workspace root", () => {
    const crumbs = buildFilesBreadcrumbs("");
    expect(crumbs).toEqual([{ label: "Files", path: "", isCurrent: true }]);
  });

  it("builds one crumb per segment, root first, only the last marked current", () => {
    const crumbs = buildFilesBreadcrumbs("docs/plans/2026");
    expect(crumbs).toEqual([
      { label: "Files", path: "", isCurrent: false },
      { label: "docs", path: "docs", isCurrent: false },
      { label: "plans", path: "docs/plans", isCurrent: false },
      { label: "2026", path: "docs/plans/2026", isCurrent: true },
    ]);
  });
});

function entry(name: string, kind: "file" | "directory"): FileBrowserEntry {
  return { name, path: name, kind, size: 10, modifiedAt: "2026-01-01T00:00:00.000Z" };
}

describe("sortFilesEntries", () => {
  it("orders directories before files", () => {
    const sorted = sortFilesEntries([entry("z.txt", "file"), entry("a", "directory")]);
    expect(sorted.map((e) => e.name)).toEqual(["a", "z.txt"]);
  });

  it("orders alphabetically, case-insensitively, within each kind group", () => {
    const sorted = sortFilesEntries([
      entry("Bravo", "directory"),
      entry("alpha", "directory"),
      entry("Zulu.txt", "file"),
      entry("yankee.txt", "file"),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["alpha", "Bravo", "yankee.txt", "Zulu.txt"]);
  });

  it("does not mutate its input array", () => {
    const input = [entry("z.txt", "file"), entry("a", "directory")];
    const original = [...input];
    sortFilesEntries(input);
    expect(input).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

/** Deterministic, manually-advanced `Clock` test double, local to this file. */
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
    throw new Error("not used by files-model");
  }

  clearInterval(): void {
    throw new Error("not used by files-model");
  }

  /** Advances time by `ms`, firing (and removing) any timers now due. */
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

/** A `FileBrowserClient` whose `listDirectory` never settles until the test resolves/rejects it. */
function createControllableClient() {
  const calls: Array<{ cwd: string; path: string }> = [];
  let resolve!: (directory: FileBrowserDirectory) => void;
  let reject!: (error: Error) => void;
  const client: FileBrowserClient = {
    listDirectory(cwd, path) {
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
    resolve: (d: FileBrowserDirectory) => resolve(d),
    reject: (e: Error) => reject(e),
  };
}

describe("listDirectoryWithTimeout", () => {
  it("rejects with FILE_BROWSER_TIMEOUT once the clock fires first", async () => {
    const clock = new FakeClock();
    const { client } = createControllableClient();
    const result = listDirectoryWithTimeout(client, "/ws", "", clock, 1000);
    clock.advance(1000);
    await expect(result).rejects.toThrow(FILE_BROWSER_TIMEOUT);
  });

  it("resolves with the client's directory when it answers before the timeout", async () => {
    const clock = new FakeClock();
    const { client, resolve } = createControllableClient();
    const result = listDirectoryWithTimeout(client, "/ws", "", clock, 1000);
    resolve({ path: "", entries: [] });
    await expect(result).resolves.toEqual({ path: "", entries: [] });
  });

  it("clears its timer once the client answers, so a late timer fire has no effect", async () => {
    const clock = new FakeClock();
    const { client, resolve } = createControllableClient();
    const promise = listDirectoryWithTimeout(client, "/ws", "", clock, 1000);
    resolve({ path: "", entries: [] });
    await promise;
    expect(clock.pendingCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Controller — navigation and the three named error states
// ---------------------------------------------------------------------------

/** A scripted `FileBrowserClient`: `responses` maps a normalized path to either a directory or an `Error` to reject with, keyed in call order per path (an array lets the same path answer differently across calls). */
function createScriptedClient(responses: Map<string, Array<FileBrowserDirectory | Error>>) {
  const calls: Array<{ cwd: string; path: string }> = [];
  const client: FileBrowserClient = {
    listDirectory(cwd, path) {
      calls.push({ cwd, path });
      const queue = responses.get(path);
      const next = queue?.shift();
      if (next === undefined) {
        return Promise.reject(new Error(`no scripted response for "${path}"`));
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return { client, calls };
}

function readyDirectory(path: string, entries: FileBrowserEntry[]): FileBrowserDirectory {
  return { path, entries };
}

describe("createFilesBrowserController", () => {
  it("lists the initial path on construction and notifies subscribers", async () => {
    const child = entry("docs", "directory");
    const { client } = createScriptedClient(new Map([["", [readyDirectory("", [child])]]]));
    const controller = createFilesBrowserController({ client, workspaceRoot: "/ws" });

    expect(controller.getState().status).toBe("loading");
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("ready");
    expect(state.entries).toEqual([child]);
  });

  it("proves entering a directory as a real state transition over the injected client", async () => {
    const child = entry("docs", "directory");
    const { client, calls } = createScriptedClient(
      new Map([
        ["", [readyDirectory("", [child])]],
        ["docs", [readyDirectory("docs", [entry("plans", "directory")])]],
      ]),
    );
    const controller = createFilesBrowserController({ client, workspaceRoot: "/ws" });
    await Promise.resolve();
    await Promise.resolve();

    controller.open(child);
    expect(controller.getState().status).toBe("loading");
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("ready");
    expect(state.path).toBe("docs");
    expect(state.entries).toEqual([entry("plans", "directory")]);
    expect(calls.map((c) => c.path)).toEqual(["", "docs"]);
  });

  it("proves going up as a real state transition, back to the parent path", async () => {
    const { client, calls } = createScriptedClient(
      new Map([
        ["docs/plans", [readyDirectory("docs/plans", [])]],
        ["docs", [readyDirectory("docs", [entry("plans", "directory")])]],
      ]),
    );
    const controller = createFilesBrowserController({
      client,
      workspaceRoot: "/ws",
      initialPath: "docs/plans",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().path).toBe("docs/plans");

    controller.up();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().path).toBe("docs");
    expect(calls.map((c) => c.path)).toEqual(["docs/plans", "docs"]);
  });

  it("does nothing when going up from the workspace root", async () => {
    const { client, calls } = createScriptedClient(new Map([["", [readyDirectory("", [])]]]));
    const controller = createFilesBrowserController({ client, workspaceRoot: "/ws" });
    await Promise.resolve();
    await Promise.resolve();

    controller.up();
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect(controller.getState().path).toBe("");
  });

  it("proves the breadcrumb path: load() jumps directly to an ancestor path", async () => {
    const { client, calls } = createScriptedClient(
      new Map([
        ["a/b/c", [readyDirectory("a/b/c", [])]],
        ["a", [readyDirectory("a", [entry("b", "directory")])]],
      ]),
    );
    const controller = createFilesBrowserController({
      client,
      workspaceRoot: "/ws",
      initialPath: "a/b/c",
    });
    await Promise.resolve();
    await Promise.resolve();

    controller.load("a");
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().path).toBe("a");
    expect(calls.map((c) => c.path)).toEqual(["a/b/c", "a"]);
  });

  it("names a permission-denied listing distinctly", async () => {
    const { client } = createScriptedClient(
      new Map([["", [new Error("EACCES: permission denied, scandir '/ws'")]]]),
    );
    const controller = createFilesBrowserController({ client, workspaceRoot: "/ws" });
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("Permission denied");
  });

  it("names a path that vanished between listing and open distinctly from an initial-listing ENOENT", async () => {
    const child = entry("ghost", "directory");
    const { client } = createScriptedClient(
      new Map([
        ["", [readyDirectory("", [child])]],
        ["ghost", [new Error("ENOENT: no such file or directory")]],
      ]),
    );
    const controller = createFilesBrowserController({ client, workspaceRoot: "/ws" });
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().status).toBe("ready");

    controller.open(child);
    await Promise.resolve();
    await Promise.resolve();

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.error?.title).toBe("This item just disappeared");
    // Not the initial-listing ENOENT copy — a genuinely different state.
    expect(state.error?.title).not.toBe("This folder no longer exists");
  });

  it("names a request that times out distinctly, via the injected clock", async () => {
    const clock = new FakeClock();
    const { client } = createControllableClient();
    const controller = createFilesBrowserController({
      client,
      workspaceRoot: "/ws",
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
    expect(state.error?.raw).toBe(FILE_BROWSER_TIMEOUT);
  });

  it("ignores a stale response from a superseded request (open beats a slow initial load)", async () => {
    const child = entry("docs", "directory");
    let resolveRoot!: (d: FileBrowserDirectory) => void;
    const calls: string[] = [];
    const client: FileBrowserClient = {
      listDirectory(_cwd, path) {
        calls.push(path);
        if (path === "") {
          return new Promise((res) => {
            resolveRoot = res;
          });
        }
        return Promise.resolve(readyDirectory("docs", []));
      },
    };
    const controller = createFilesBrowserController({ client, workspaceRoot: "/ws" });
    // The root listing is still pending when `open` fires a second request.
    controller.open(child);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().path).toBe("docs");

    // The stale root listing now resolves late; it must not clobber "docs".
    resolveRoot(readyDirectory("", [child]));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().path).toBe("docs");
  });

  it("retry() re-issues the current path in its current context", async () => {
    const child = entry("ghost", "directory");
    const { client, calls } = createScriptedClient(
      new Map([
        ["", [readyDirectory("", [child])]],
        ["ghost", [new Error("ENOENT"), readyDirectory("ghost", [])]],
      ]),
    );
    const controller = createFilesBrowserController({ client, workspaceRoot: "/ws" });
    await Promise.resolve();
    await Promise.resolve();

    controller.open(child);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().error?.title).toBe("This item just disappeared");

    controller.retry();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().status).toBe("ready");
    expect(controller.getState().path).toBe("ghost");
    expect(calls.map((c) => c.path)).toEqual(["", "ghost", "ghost"]);
  });

  it("subscribe() delivers every transition and unsubscribe() stops delivery", async () => {
    const { client } = createScriptedClient(new Map([["", [readyDirectory("", [])]]]));
    const controller = createFilesBrowserController({ client, workspaceRoot: "/ws" });
    const seen: string[] = [];
    const unsubscribe = controller.subscribe((state) => seen.push(state.status));
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(["ready"]);

    unsubscribe();
    controller.load("docs");
    await Promise.resolve();
    expect(seen).toEqual(["ready"]);
  });
});
