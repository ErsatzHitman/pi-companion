import { describe, expect, it } from "vitest";

import { InMemorySqliteDriver } from "./in-memory-sqlite-driver.js";
import {
  DEFAULT_MAX_ROWS_PER_COLLECTION,
  SqliteStructuredStorage,
} from "./sqlite-structured-storage.js";

function makeStorage(
  overrides: Partial<ConstructorParameters<typeof SqliteStructuredStorage>[0]> = {},
) {
  const driver = new InMemorySqliteDriver();
  const storage = new SqliteStructuredStorage({ driver, ...overrides });
  return { driver, storage };
}

describe("SqliteStructuredStorage: StructuredStorage contract", () => {
  it("round-trips a value through put/get", async () => {
    const { storage } = makeStorage();
    await storage.put("sessions", "s1", {
      title: "First session",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(storage.get("sessions", "s1")).resolves.toEqual({
      title: "First session",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("get returns null for a key nothing was ever put under", async () => {
    const { storage } = makeStorage();
    await expect(storage.get("sessions", "missing")).resolves.toBeNull();
  });

  it("put overwrites an existing id in place rather than duplicating it", async () => {
    const { driver, storage } = makeStorage();
    await storage.put("sessions", "s1", { title: "v1" });
    await storage.put("sessions", "s1", { title: "v2" });
    await expect(storage.get("sessions", "s1")).resolves.toEqual({ title: "v2" });
    expect(driver.totalRowCount).toBe(1);
  });

  it("delete removes only the targeted id", async () => {
    const { storage } = makeStorage();
    await storage.put("sessions", "s1", { title: "keep" });
    await storage.put("sessions", "s2", { title: "gone" });
    await storage.delete("sessions", "s2");
    await expect(storage.get("sessions", "s1")).resolves.toEqual({ title: "keep" });
    await expect(storage.get("sessions", "s2")).resolves.toBeNull();
  });

  it("delete on a missing id is a no-op, not an error", async () => {
    const { storage } = makeStorage();
    await expect(storage.delete("sessions", "never-existed")).resolves.toBeUndefined();
  });

  it("list returns every row in a collection", async () => {
    const { storage } = makeStorage();
    await storage.put("sessions", "s1", { n: 1 });
    await storage.put("sessions", "s2", { n: 2 });
    const rows = await storage.list<{ n: number }>("sessions");
    expect(rows.map((r) => r.n).sort()).toEqual([1, 2]);
  });

  it("list respects idPrefix", async () => {
    const { storage } = makeStorage();
    await storage.put("sessions", "timeline/page-1", { n: 1 });
    await storage.put("sessions", "timeline/page-2", { n: 2 });
    await storage.put("sessions", "summary", { n: 3 });
    const rows = await storage.list<{ n: number }>("sessions", { idPrefix: "timeline/" });
    expect(rows.map((r) => r.n).sort()).toEqual([1, 2]);
  });

  it("list respects limit", async () => {
    const { storage } = makeStorage();
    await storage.put("sessions", "a", { n: 1 });
    await storage.put("sessions", "b", { n: 2 });
    await storage.put("sessions", "c", { n: 3 });
    const rows = await storage.list<{ n: number }>("sessions", { limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it("list does not cross collections", async () => {
    const { storage } = makeStorage();
    await storage.put("sessions", "s1", { n: 1 });
    await storage.put("timelines", "s1", { n: 99 });
    const rows = await storage.list<{ n: number }>("sessions");
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("clear removes only the targeted collection", async () => {
    const { storage } = makeStorage();
    await storage.put("sessions", "s1", { n: 1 });
    await storage.put("timelines", "t1", { n: 2 });
    await storage.clear("sessions");
    await expect(storage.list("sessions")).resolves.toEqual([]);
    await expect(storage.get("timelines", "t1")).resolves.toEqual({ n: 2 });
  });

  it("two instances over the same driver see each other's writes, simulating a restart", async () => {
    const driver = new InMemorySqliteDriver();
    const before = new SqliteStructuredStorage({ driver });
    await before.put("sessions", "s1", { title: "survives restart" });
    const after = new SqliteStructuredStorage({ driver });
    await expect(after.get("sessions", "s1")).resolves.toEqual({ title: "survives restart" });
  });
});

describe("SqliteStructuredStorage: cache size is bounded", () => {
  it("documents the default bound", () => {
    expect(DEFAULT_MAX_ROWS_PER_COLLECTION).toBeGreaterThan(0);
  });

  it("evicts the oldest row once a collection exceeds maxRowsPerCollection", async () => {
    let clock = 0;
    const { driver, storage } = makeStorage({ maxRowsPerCollection: 3, now: () => clock++ });
    await storage.put("sessions", "s1", { n: 1 });
    await storage.put("sessions", "s2", { n: 2 });
    await storage.put("sessions", "s3", { n: 3 });
    expect(driver.totalRowCount).toBe(3);

    await storage.put("sessions", "s4", { n: 4 });

    expect(driver.totalRowCount).toBe(3);
    await expect(storage.get("sessions", "s1")).resolves.toBeNull(); // oldest, evicted
    await expect(storage.get("sessions", "s2")).resolves.toEqual({ n: 2 });
    await expect(storage.get("sessions", "s3")).resolves.toEqual({ n: 3 });
    await expect(storage.get("sessions", "s4")).resolves.toEqual({ n: 4 });
  });

  it("re-writing an existing id refreshes its recency and saves it from eviction", async () => {
    let clock = 0;
    const { storage } = makeStorage({ maxRowsPerCollection: 2, now: () => clock++ });
    await storage.put("sessions", "s1", { n: 1 });
    await storage.put("sessions", "s2", { n: 2 });
    await storage.put("sessions", "s1", { n: 1, refreshed: true }); // s1 is now the newest, s2 is oldest
    await storage.put("sessions", "s3", { n: 3 }); // pushes over bound; s2 (oldest) should go

    await expect(storage.get("sessions", "s1")).resolves.toEqual({ n: 1, refreshed: true });
    await expect(storage.get("sessions", "s2")).resolves.toBeNull();
    await expect(storage.get("sessions", "s3")).resolves.toEqual({ n: 3 });
  });

  it("the bound is per collection, not shared across collections", async () => {
    const { storage } = makeStorage({ maxRowsPerCollection: 1 });
    await storage.put("sessions", "s1", { n: 1 });
    await storage.put("timelines", "t1", { n: 2 });
    await expect(storage.get("sessions", "s1")).resolves.toEqual({ n: 1 });
    await expect(storage.get("timelines", "t1")).resolves.toEqual({ n: 2 });
  });

  it("does not evict a protected id even when it is the oldest row, evicting the next-oldest unprotected row instead", async () => {
    let clock = 0;
    const { driver, storage } = makeStorage({
      maxRowsPerCollection: 2,
      now: () => clock++,
      isProtected: (collection, id) => collection === "sessions" && id === "currently-open",
    });
    await storage.put("sessions", "currently-open", { n: 0 }); // oldest, but protected
    await storage.put("sessions", "s2", { n: 2 }); // next-oldest, unprotected
    await storage.put("sessions", "s3", { n: 3 }); // would normally evict "currently-open" as oldest

    // Bound still held at 2: eviction skipped the protected oldest row and
    // removed the next-oldest unprotected one (s2) instead.
    expect(driver.totalRowCount).toBe(2);
    await expect(storage.get("sessions", "currently-open")).resolves.toEqual({ n: 0 });
    await expect(storage.get("sessions", "s2")).resolves.toBeNull();
    await expect(storage.get("sessions", "s3")).resolves.toEqual({ n: 3 });
  });

  it("lets the bound be exceeded rather than ever evicting a protected id, when every other row is also protected", async () => {
    let clock = 0;
    const { driver, storage } = makeStorage({
      maxRowsPerCollection: 1,
      now: () => clock++,
      isProtected: () => true, // every row in this collection is protected
    });
    await storage.put("sessions", "currently-open", { n: 0 });
    await storage.put("sessions", "also-protected", { n: 1 }); // pushes past the bound of 1

    expect(driver.totalRowCount).toBe(2); // bound exceeded, deliberately — see module doc
    await expect(storage.get("sessions", "currently-open")).resolves.toEqual({ n: 0 });
    await expect(storage.get("sessions", "also-protected")).resolves.toEqual({ n: 1 });
  });
});

describe("SqliteStructuredStorage: secret exclusion", () => {
  it("refuses a top-level password field", async () => {
    const { storage } = makeStorage();
    await expect(
      storage.put("sessions", "s1", { title: "ok", password: "hunter2" }),
    ).rejects.toThrow(/secret-shaped field "password"/);
  });

  it("refuses a nested daemonKey field", async () => {
    const { storage } = makeStorage();
    await expect(
      storage.put("sessions", "s1", { title: "ok", host: { label: "laptop", daemonKey: "abc" } }),
    ).rejects.toThrow(/secret-shaped field "daemonKey"/);
  });

  it("refuses a relayKey field inside an array element", async () => {
    const { storage } = makeStorage();
    await expect(
      storage.put("sessions", "s1", {
        profiles: [{ label: "a" }, { label: "b", relayKey: "xyz" }],
      }),
    ).rejects.toThrow(/secret-shaped field "relayKey"/);
  });

  it("a refused put never reaches the driver", async () => {
    const { driver, storage } = makeStorage();
    await expect(storage.put("sessions", "s1", { token: "abc" })).rejects.toThrow();
    expect(driver.totalRowCount).toBe(0);
  });

  it("allows ordinary session data with no secret-shaped field", async () => {
    const { storage } = makeStorage();
    await expect(
      storage.put("sessions", "s1", {
        id: "s1",
        title: "Refactor the parser",
        provider: "anthropic",
        status: "idle",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not false-positive on field names that merely contain 'key', like 'keyboard'", async () => {
    const { storage } = makeStorage();
    await expect(storage.put("sessions", "s1", { keyboardVisible: true })).resolves.toBeUndefined();
  });

  // T60A regression: the pre-unification exact-match key pattern let a
  // realistic field name that merely *contains* a secret-shaped word
  // (rather than being exactly one) through undetected. Proven directly
  // against `@picompanion/frontend-core`'s `security.isSecretShapedKey`
  // in `packages/frontend-core/src/security/secret-shape.test.ts`; this
  // proves the fix reaches this call site too.
  it.each(["accessToken", "refreshToken", "relayPassword", "sessionCookie"])(
    "refuses a %s field, which the pre-T60A exact-match pattern let through",
    async (key) => {
      const { storage, driver } = makeStorage();
      await expect(storage.put("sessions", "s1", { [key]: "plaintext-value" })).rejects.toThrow(
        new RegExp(`secret-shaped field "${key}"`),
      );
      expect(driver.totalRowCount).toBe(0);
    },
  );
});
