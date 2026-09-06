/**
 * Proves T37A's first acceptance criterion: "Cached sessions render
 * offline, asserted by unit tests against the shared `frontend-core`
 * fixtures."
 *
 * This exercises the real, shared `@picompanion/frontend-core`
 * `offline.OfflineCache` — not a reimplementation of it — over this
 * task's `SqliteStructuredStorage`, using session identity drawn from
 * `@picompanion/frontend-core`'s own shared `testing.loadRecordedSessionChapter`
 * fixture (not fabricated ad hoc strings), and proves the cache is
 * written through the `StructuredStorage` platform interface: this file
 * never calls `SqliteStructuredStorage.get`/`put` itself, only
 * `OfflineCache.save`/`load`/`markCaughtUp` — so if `OfflineCache` ever
 * bypassed the injected storage, the "second instance after restart"
 * case below would see nothing and fail.
 */
import { offline as coreOffline, testing as coreTesting } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import { InMemorySqliteDriver } from "./in-memory-sqlite-driver.js";
import { SqliteStructuredStorage } from "./sqlite-structured-storage.js";

/** Deterministic, manually advanced `Clock` — this file is intentionally the only place in this task that needs one, so it is not worth promoting to a shared module for a single caller. */
class ManualClock {
  constructor(private currentMs: number) {}
  now(): number {
    return this.currentMs;
  }
  setTimeout(): never {
    throw new Error("ManualClock.setTimeout is not implemented; this test double is now-only.");
  }
  clearTimeout(): never {
    throw new Error("ManualClock.clearTimeout is not implemented; this test double is now-only.");
  }
  setInterval(): never {
    throw new Error("ManualClock.setInterval is not implemented; this test double is now-only.");
  }
  clearInterval(): never {
    throw new Error("ManualClock.clearInterval is not implemented; this test double is now-only.");
  }
  advance(deltaMs: number): void {
    this.currentMs += deltaMs;
  }
}

interface CachedSessionSummary {
  sessionId: string;
  hostname: string;
  serverVersion: string;
}

/** Pulls hostname/version out of the shared fixture's `server_info` frame without an `any` cast. */
function cachedSessionFromHelloFixture(): CachedSessionSummary {
  const helloChapter = coreTesting.loadRecordedSessionChapter("hello");
  const serverInfoFrame = helloChapter.frames.find((frame) => frame.id === "server-info-1");
  if (!serverInfoFrame) {
    throw new Error("fixture regression: 'hello' chapter no longer has a 'server-info-1' frame");
  }
  const envelope = serverInfoFrame.message as {
    message: { payload: { hostname: string; version: string } };
  };
  return {
    sessionId: helloChapter.frames[0]!.id,
    hostname: envelope.message.payload.hostname,
    serverVersion: envelope.message.payload.version,
  };
}

describe("OfflineCache over SqliteStructuredStorage: cached sessions render offline", () => {
  it("loads real fixture-derived session data from a second instance, still flagged stale, before any catch-up", async () => {
    const cachedSession = cachedSessionFromHelloFixture();
    // Sanity: this data really came from the shared fixture, not this test file.
    expect(cachedSession.hostname).toBe("fixture-daemon");

    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(1_000);

    const firstRunStorage = new SqliteStructuredStorage({ driver });
    const firstRunCache = new coreOffline.OfflineCache(firstRunStorage, clock);
    await firstRunCache.save("last-open-session", cachedSession);

    // Simulate the app being killed and relaunched offline: a fresh
    // OfflineCache and a fresh SqliteStructuredStorage, over the same
    // underlying driver (the on-disk database survives a restart; this
    // in-memory fake models that by sharing its backing array).
    const secondRunStorage = new SqliteStructuredStorage({ driver });
    const secondRunCache = new coreOffline.OfflineCache(secondRunStorage, clock);

    const loaded = await secondRunCache.load<CachedSessionSummary>("last-open-session");

    expect(loaded).not.toBeNull();
    expect(loaded?.data).toEqual(cachedSession);
    // "renders offline" — the data is available with no daemon connection
    // at all (this test never constructs one) — but flagged stale until
    // the owning domain confirms it (plan.md §12.5).
    expect(loaded?.stale).toBe(true);
  });

  it("markCaughtUp clears staleness for the cached session, and it survives a further restart", async () => {
    const cachedSession = cachedSessionFromHelloFixture();
    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(2_000);

    const storage = new SqliteStructuredStorage({ driver });
    const cache = new coreOffline.OfflineCache(storage, clock);
    await cache.save("last-open-session", cachedSession);
    await cache.markCaughtUp("last-open-session");

    const afterRestartStorage = new SqliteStructuredStorage({ driver });
    const afterRestartCache = new coreOffline.OfflineCache(afterRestartStorage, clock);
    const loaded = await afterRestartCache.load<CachedSessionSummary>("last-open-session");

    expect(loaded?.stale).toBe(false);
    expect(loaded?.data).toEqual(cachedSession);
  });

  it("a fresh save after catch-up re-flags the entry stale, per OfflineCache's own contract", async () => {
    const cachedSession = cachedSessionFromHelloFixture();
    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(3_000);
    const storage = new SqliteStructuredStorage({ driver });
    const cache = new coreOffline.OfflineCache(storage, clock);

    await cache.save("last-open-session", cachedSession);
    await cache.markCaughtUp("last-open-session");
    clock.advance(1_000);
    await cache.save("last-open-session", { ...cachedSession, serverVersion: "0.1.1-fixture" });

    const loaded = await cache.load<CachedSessionSummary>("last-open-session");
    expect(loaded?.stale).toBe(true);
    expect(loaded?.data.serverVersion).toBe("0.1.1-fixture");
  });
});
