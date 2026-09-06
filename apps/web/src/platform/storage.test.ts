import { beforeEach, describe, expect, it } from "vitest";

import { createLocalStorageKeyValueStorage } from "./storage.js";

describe("createLocalStorageKeyValueStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips values through the namespace", async () => {
    const storage = createLocalStorageKeyValueStorage("test:kv:");
    await storage.setItem("a", "1");
    expect(await storage.getItem("a")).toBe("1");
    expect(window.localStorage.getItem("test:kv:a")).toBe("1");
  });

  it("returns null for missing keys", async () => {
    const storage = createLocalStorageKeyValueStorage("test:kv:");
    expect(await storage.getItem("missing")).toBeNull();
  });

  it("removes items", async () => {
    const storage = createLocalStorageKeyValueStorage("test:kv:");
    await storage.setItem("a", "1");
    await storage.removeItem("a");
    expect(await storage.getItem("a")).toBeNull();
  });

  it("lists keys, optionally filtered by prefix, without the namespace", async () => {
    const storage = createLocalStorageKeyValueStorage("test:kv:");
    await storage.setItem("host/1", "one");
    await storage.setItem("host/2", "two");
    await storage.setItem("draft/1", "three");

    expect((await storage.keys()).sort()).toEqual(["draft/1", "host/1", "host/2"]);
    expect((await storage.keys("host/")).sort()).toEqual(["host/1", "host/2"]);
  });

  it("clear() only removes keys in its own namespace", async () => {
    window.localStorage.setItem("other:kv:x", "keep");
    const storage = createLocalStorageKeyValueStorage("test:kv:");
    await storage.setItem("a", "1");
    await storage.clear();
    expect(await storage.getItem("a")).toBeNull();
    expect(window.localStorage.getItem("other:kv:x")).toBe("keep");
  });
});
