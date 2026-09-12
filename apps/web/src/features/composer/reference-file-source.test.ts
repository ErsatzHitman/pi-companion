import { describe, expect, it, vi } from "vitest";

import type {
  FileBrowserClient,
  FileBrowserDirectory,
  FileBrowserEntry,
} from "../files/file-browser-client.js";
import { createReferenceFileSource } from "./reference-file-source.js";

function entry(name: string, kind: "file" | "directory", path = name): FileBrowserEntry {
  return { name, path, kind, size: 1, modifiedAt: "2026-01-01T00:00:00.000Z" };
}

function fakeClient(
  directories: Record<string, readonly FileBrowserEntry[]>,
): FileBrowserClient & { readonly calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    async listDirectory(cwd: string, path: string): Promise<FileBrowserDirectory> {
      calls.push([cwd, path]);
      const entries = directories[path];
      if (!entries) throw new Error("ENOENT: no such directory");
      return { path, entries };
    },
  };
}

describe("createReferenceFileSource", () => {
  it("collects file paths breadth-first, recursing into directories", async () => {
    const client = fakeClient({
      "": [entry("src", "directory"), entry("README.md", "file")],
      src: [entry("index.ts", "file", "src/index.ts"), entry("nested", "directory", "src/nested")],
      "src/nested": [entry("deep.ts", "file", "src/nested/deep.ts")],
    });

    const candidates = await createReferenceFileSource(client).listFiles();

    expect(candidates).toEqual([
      { kind: "file", id: "README.md", label: "README.md" },
      { kind: "file", id: "src/index.ts", label: "src/index.ts" },
      { kind: "file", id: "src/nested/deep.ts", label: "src/nested/deep.ts" },
    ]);
  });

  it("walks once and caches the result across calls", async () => {
    const listDirectory = vi.fn(async (_cwd: string, path: string) => ({
      path,
      entries: [entry("a.ts", "file")],
    }));
    const source = createReferenceFileSource({ listDirectory });

    await source.listFiles();
    await source.listFiles();

    expect(listDirectory).toHaveBeenCalledTimes(1);
  });

  it("stops at the result and directory caps", async () => {
    const client = fakeClient({
      "": [entry("one.ts", "file"), entry("two.ts", "file"), entry("three.ts", "file")],
    });

    const candidates = await createReferenceFileSource(client, { maxResults: 2 }).listFiles();
    expect(candidates.map((candidate) => candidate.id)).toEqual(["one.ts", "two.ts"]);
  });

  it("skips an unauthorized path and an unreadable subtree instead of failing", async () => {
    const client = fakeClient({
      "": [entry("ok.ts", "file"), entry("escape", "directory", "../escape")],
      // `escape` is never listed because `authorizeWorkspacePath` refuses it.
      broken: [],
    });

    const candidates = await createReferenceFileSource(client).listFiles();

    expect(candidates.map((candidate) => candidate.id)).toEqual(["ok.ts"]);
    expect(client.calls.some(([, path]) => path === "../escape")).toBe(false);
  });

  it("returns no candidates when the root itself cannot be listed", async () => {
    const client = fakeClient({});
    expect(await createReferenceFileSource(client).listFiles()).toEqual([]);
  });
});
