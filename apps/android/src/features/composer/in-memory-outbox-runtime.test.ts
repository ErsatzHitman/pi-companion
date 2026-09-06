import { describe, expect, it } from "vitest";

import { createInMemoryStructuredStorage, createSystemClock } from "./in-memory-outbox-runtime";

describe("createInMemoryStructuredStorage", () => {
  it("round-trips get/put/delete within one collection", async () => {
    const storage = createInMemoryStructuredStorage();
    expect(await storage.get("c", "a")).toBeNull();

    await storage.put("c", "a", { value: 1 });
    expect(await storage.get("c", "a")).toEqual({ value: 1 });

    await storage.delete("c", "a");
    expect(await storage.get("c", "a")).toBeNull();
  });

  it("lists every record in a collection, honouring idPrefix and limit", async () => {
    const storage = createInMemoryStructuredStorage();
    await storage.put("c", "a-1", { n: 1 });
    await storage.put("c", "a-2", { n: 2 });
    await storage.put("c", "b-1", { n: 3 });

    expect(await storage.list("c")).toHaveLength(3);
    expect(await storage.list("c", { idPrefix: "a-" })).toHaveLength(2);
    expect(await storage.list("c", { limit: 1 })).toHaveLength(1);
  });

  it("keeps separate collections isolated, and clear() only empties the named one", async () => {
    const storage = createInMemoryStructuredStorage();
    await storage.put("c1", "a", { n: 1 });
    await storage.put("c2", "a", { n: 2 });

    await storage.clear("c1");
    expect(await storage.get("c1", "a")).toBeNull();
    expect(await storage.get("c2", "a")).toEqual({ n: 2 });
  });
});

describe("createSystemClock", () => {
  it("now() returns a real, monotonically-sane timestamp", () => {
    const clock = createSystemClock();
    const before = Date.now();
    const value = clock.now();
    const after = Date.now();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  it("setTimeout/clearTimeout round-trip through a real timer without throwing", async () => {
    const clock = createSystemClock();
    await new Promise<void>((resolve, reject) => {
      const handle = clock.setTimeout(() => reject(new Error("should have been cleared")), 50);
      clock.clearTimeout(handle);
      setTimeout(resolve, 60);
    });
  });
});
