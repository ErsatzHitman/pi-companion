/**
 * Proves T68's four acceptance criteria for `OfflineCacheOwner`
 * (`./offline-cache-owner.ts`):
 *
 * 1. An `OfflineCache` is constructed once, owned by something with a
 *    defined lifetime, and disposed when that lifetime ends — proven
 *    below by asserting the underlying driver's `closeAsync` actually
 *    arrives, not merely that some internal flag flipped.
 * 2. A cache that cannot open its storage lands in a named degraded
 *    state and the app still runs (`open()` never throws/rejects).
 * 3. Nothing cached reaches plain storage unencrypted, a log, or a URL
 *    query string — already proven by `sqlite-structured-storage.test.ts`
 *    for `put`'s secret-shape guard; this file adds one case confirming
 *    that guard still fires when reached through an `OfflineCacheOwner`.
 * 4. Two constructions for the same scope are prevented, not merely
 *    discouraged.
 *
 * Uses the real, shared `@picompanion/frontend-core` `offline.OfflineCache`
 * over this task's real `SqliteStructuredStorage` and
 * `InMemorySqliteDriver` — never a reimplementation of any of the three.
 */
import type { Clock } from "@picompanion/frontend-core";
import { describe, expect, it, vi } from "vitest";

import { InMemorySqliteDriver } from "./in-memory-sqlite-driver.js";
import { OfflineCacheOwner, createOfflineCacheOwner } from "./offline-cache-owner.js";
import type { SqliteDriver } from "./sqlite-driver.js";
import { createUnavailableSqliteDriverFactory } from "./sqlite-driver-factory.js";

/** Minimal `Clock` double — only `now()` is ever exercised by `OfflineCache`; every other member throws if this file ever starts needing it, so a silent behavior change is loud rather than quiet. */
class FakeClock implements Clock {
  constructor(private currentMs: number) {}
  now(): number {
    return this.currentMs;
  }
  setTimeout(): never {
    throw new Error("FakeClock.setTimeout is not implemented; this test double is now-only.");
  }
  clearTimeout(): never {
    throw new Error("FakeClock.clearTimeout is not implemented; this test double is now-only.");
  }
  setInterval(): never {
    throw new Error("FakeClock.setInterval is not implemented; this test double is now-only.");
  }
  clearInterval(): never {
    throw new Error("FakeClock.clearInterval is not implemented; this test double is now-only.");
  }
}

function makeDriverFactory(): { driver: InMemorySqliteDriver; open: () => Promise<SqliteDriver> } {
  const driver = new InMemorySqliteDriver();
  return { driver, open: () => Promise.resolve(driver) };
}

describe("OfflineCacheOwner: construction, lifecycle, and disposal", () => {
  it("constructs a real, working OfflineCache reachable via getCache() once open() resolves ready", async () => {
    const { open } = makeDriverFactory();
    const owner = createOfflineCacheOwner({ driverFactory: { open }, clock: new FakeClock(1_000) });

    const status = await owner.open();
    expect(status).toEqual({ kind: "ready" });
    expect(owner.getStatus()).toEqual({ kind: "ready" });

    const cache = owner.getCache();
    expect(cache).not.toBeNull();
    await cache?.save("k", { hello: "world" });
    const loaded = await cache?.load<{ hello: string }>("k");
    expect(loaded?.data).toEqual({ hello: "world" });
    expect(loaded?.stale).toBe(true);

    await owner.dispose();
  });

  it("opens the driver at most once even when open() is called concurrently and repeatedly", async () => {
    const driver = new InMemorySqliteDriver();
    const openSpy = vi.fn(() => Promise.resolve(driver as SqliteDriver));
    const owner = createOfflineCacheOwner({
      driverFactory: { open: openSpy },
      clock: new FakeClock(1),
    });

    const [a, b, c] = await Promise.all([owner.open(), owner.open(), owner.open()]);
    expect(a).toEqual({ kind: "ready" });
    expect(b).toEqual({ kind: "ready" });
    expect(c).toEqual({ kind: "ready" });
    expect(openSpy).toHaveBeenCalledTimes(1);

    // A later call after settlement still does not re-open.
    await owner.open();
    expect(openSpy).toHaveBeenCalledTimes(1);

    await owner.dispose();
  });

  it("disposal actually reaches the driver's closeAsync, and getCache() returns null forever after", async () => {
    const { driver, open } = makeDriverFactory();
    const owner = createOfflineCacheOwner({ driverFactory: { open }, clock: new FakeClock(1) });
    await owner.open();
    expect(driver.isClosed).toBe(false);

    await owner.dispose();

    // The proof this is a real disposal, not a registration: the value
    // (the closed driver) actually arrived, not just an internal flag.
    expect(driver.isClosed).toBe(true);
    expect(owner.getStatus()).toEqual({ kind: "disposed" });
    expect(owner.getCache()).toBeNull();
  });

  it("dispose() is idempotent: a second call never calls closeAsync twice", async () => {
    const { driver, open } = makeDriverFactory();
    const closeSpy = vi.spyOn(driver, "closeAsync");
    const owner = createOfflineCacheOwner({ driverFactory: { open }, clock: new FakeClock(1) });
    await owner.open();

    await owner.dispose();
    await owner.dispose();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("dispose() called before open() ever resolves still closes the driver once it does, and never constructs a reachable cache", async () => {
    const { driver } = makeDriverFactory();
    let resolveOpen!: (d: SqliteDriver) => void;
    const openPromise = new Promise<SqliteDriver>((resolve) => {
      resolveOpen = resolve;
    });
    const owner = createOfflineCacheOwner({
      driverFactory: { open: () => openPromise },
      clock: new FakeClock(1),
    });

    const opening = owner.open();
    const disposing = owner.dispose();
    resolveOpen(driver);
    await Promise.all([opening, disposing]);

    expect(owner.getStatus()).toEqual({ kind: "disposed" });
    expect(owner.getCache()).toBeNull();
    expect(driver.isClosed).toBe(true);
  });
});

describe("OfflineCacheOwner: degraded state when storage cannot be opened", () => {
  it("open() never throws when the driver factory rejects — it resolves a named degraded status instead", async () => {
    const owner = createOfflineCacheOwner({
      driverFactory: { open: () => Promise.reject(new Error("disk full")) },
      clock: new FakeClock(1),
    });

    const status = await owner.open();
    expect(status).toEqual({ kind: "degraded", reason: "disk full" });
    expect(owner.getStatus()).toEqual({ kind: "degraded", reason: "disk full" });
    expect(owner.getCache()).toBeNull();

    // The app still runs: dispose() on a degraded owner does not throw.
    await expect(owner.dispose()).resolves.toBeUndefined();
    expect(owner.getStatus()).toEqual({ kind: "disposed" });
  });

  it("T82: a dispose() that wins the race against a rejecting driverFactory.open() settles to disposed, not degraded", async () => {
    let rejectOpen!: (error: Error) => void;
    const openPromise = new Promise<SqliteDriver>((_resolve, reject) => {
      rejectOpen = reject;
    });
    const owner = createOfflineCacheOwner({
      driverFactory: { open: () => openPromise },
      clock: new FakeClock(1),
    });

    const opening = owner.open();
    const disposing = owner.dispose();
    // The dispose() above has already flipped status to "disposed" and
    // is now awaiting this same openPromise (see dispose()'s own await);
    // reject it only now, after dispose() has committed to that status,
    // to exercise doOpen()'s catch path racing a disposed owner.
    rejectOpen(new Error("disk full"));
    await Promise.all([opening.catch(() => {}), disposing]);

    // The proof this is not the pre-T82 clobber: getStatus() must read
    // "disposed", not "degraded" — before the fix, this assertion fails
    // because the catch block unconditionally overwrote this.status.
    expect(owner.getStatus()).toEqual({ kind: "disposed" });
    expect(owner.getCache()).toBeNull();
  });

  it("production's createUnavailableSqliteDriverFactory lands the owner in degraded — no real SQLite file is opened", async () => {
    const owner = createOfflineCacheOwner({
      driverFactory: createUnavailableSqliteDriverFactory(),
      clock: new FakeClock(1),
    });

    const status = await owner.open();
    expect(status.kind).toBe("degraded");
    if (status.kind === "degraded") {
      expect(status.reason).toMatch(/native ExpoSQLite module is not available/);
      expect(status.reason).toMatch(/no real SQLite file was opened/);
    }
    expect(owner.getCache()).toBeNull();
    await owner.dispose();
  });
});

describe("OfflineCacheOwner: nothing cached reaches plain storage unencrypted", () => {
  it("still refuses a secret-shaped value through the owner's live cache's storage", async () => {
    const { open } = makeDriverFactory();
    const owner = createOfflineCacheOwner({ driverFactory: { open }, clock: new FakeClock(1) });
    await owner.open();
    const cache = owner.getCache();
    expect(cache).not.toBeNull();

    await expect(cache?.save("k", { password: "hunter2" })).rejects.toThrow(/secret-shaped/);

    await owner.dispose();
  });
});

describe("OfflineCacheOwner: two constructions for the same scope are prevented", () => {
  it("constructing a second owner for a scope with an undisposed owner throws synchronously", async () => {
    const { open: openA } = makeDriverFactory();
    const ownerA = createOfflineCacheOwner({
      driverFactory: { open: openA },
      clock: new FakeClock(1),
      scope: "shared",
    });

    const { open: openB } = makeDriverFactory();
    expect(() =>
      createOfflineCacheOwner({
        driverFactory: { open: openB },
        clock: new FakeClock(1),
        scope: "shared",
      }),
    ).toThrow(/scope "shared" already has an undisposed owner/);

    await ownerA.dispose();
  });

  it("a scope frees up for reconstruction once its owner is disposed", async () => {
    const { open: openA } = makeDriverFactory();
    const ownerA = createOfflineCacheOwner({
      driverFactory: { open: openA },
      clock: new FakeClock(1),
      scope: "reusable",
    });
    await ownerA.open();
    await ownerA.dispose();

    const { open: openB } = makeDriverFactory();
    // Does not throw — the scope was freed by dispose().
    const ownerB = createOfflineCacheOwner({
      driverFactory: { open: openB },
      clock: new FakeClock(2),
      scope: "reusable",
    });
    const status = await ownerB.open();
    expect(status).toEqual({ kind: "ready" });

    await ownerB.dispose();
  });

  it("two owners with different explicit scopes coexist without conflict", async () => {
    const { open: openA } = makeDriverFactory();
    const { open: openB } = makeDriverFactory();
    const ownerA = createOfflineCacheOwner({
      driverFactory: { open: openA },
      clock: new FakeClock(1),
      scope: "session-cache",
    });
    const ownerB = createOfflineCacheOwner({
      driverFactory: { open: openB },
      clock: new FakeClock(1),
      scope: "outbox-cache",
    });

    await Promise.all([ownerA.open(), ownerB.open()]);
    expect(ownerA.getCache()).not.toBeNull();
    expect(ownerB.getCache()).not.toBeNull();

    await Promise.all([ownerA.dispose(), ownerB.dispose()]);
  });

  it("the default scope is shared across callers that omit scope entirely", async () => {
    const { open: openA } = makeDriverFactory();
    const ownerA = createOfflineCacheOwner({
      driverFactory: { open: openA },
      clock: new FakeClock(1),
    });

    const { open: openB } = makeDriverFactory();
    expect(() =>
      createOfflineCacheOwner({ driverFactory: { open: openB }, clock: new FakeClock(1) }),
    ).toThrow(/scope "default" already has an undisposed owner/);

    await ownerA.dispose();
  });
});

describe("OfflineCacheOwner: class export matches the factory", () => {
  it("new OfflineCacheOwner(...) behaves identically to createOfflineCacheOwner(...)", async () => {
    const { open } = makeDriverFactory();
    const owner = new OfflineCacheOwner({
      driverFactory: { open },
      clock: new FakeClock(1),
      scope: "direct-construction",
    });
    const status = await owner.open();
    expect(status).toEqual({ kind: "ready" });
    await owner.dispose();
  });
});
