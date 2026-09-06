import { describe, expect, it } from "vitest";
import { OfflineCache } from "./cache.js";
import { FakeClock, InMemoryStructuredStorage } from "./test-doubles.js";

interface FakeTimelinePage {
  sessionId: string;
  messageIds: string[];
}

describe("OfflineCache", () => {
  it("returns null when nothing is cached", async () => {
    const cache = new OfflineCache(new InMemoryStructuredStorage(), new FakeClock());
    expect(await cache.load("session-1")).toBeNull();
  });

  it("flags newly saved data as stale", async () => {
    const clock = new FakeClock(1_000);
    const cache = new OfflineCache(new InMemoryStructuredStorage(), clock);
    const saved = await cache.save<FakeTimelinePage>("session-1", {
      sessionId: "session-1",
      messageIds: ["m1", "m2"],
    });

    expect(saved.stale).toBe(true);
    expect(saved.cachedAt).toBe(1_000);

    const loaded = await cache.load<FakeTimelinePage>("session-1");
    expect(loaded?.stale).toBe(true);
    expect(loaded?.data).toEqual({ sessionId: "session-1", messageIds: ["m1", "m2"] });
  });

  it("cached timelines load flagged stale until authoritative catch-up completes", async () => {
    const cache = new OfflineCache(new InMemoryStructuredStorage(), new FakeClock());
    await cache.save<FakeTimelinePage>("session-1", {
      sessionId: "session-1",
      messageIds: ["m1"],
    });

    // Before catch-up: still stale.
    expect((await cache.load("session-1"))?.stale).toBe(true);

    // Authoritative catch-up (e.g. fetch_agent_timeline_request) completes.
    const caughtUp = await cache.markCaughtUp<FakeTimelinePage>("session-1");
    expect(caughtUp?.stale).toBe(false);

    // After catch-up: no longer stale.
    const loadedAfter = await cache.load<FakeTimelinePage>("session-1");
    expect(loadedAfter?.stale).toBe(false);
    expect(loadedAfter?.data).toEqual({ sessionId: "session-1", messageIds: ["m1"] });
  });

  it("re-flags a caught-up entry as stale via markStale", async () => {
    const cache = new OfflineCache(new InMemoryStructuredStorage(), new FakeClock());
    await cache.save("session-1", { ok: true });
    await cache.markCaughtUp("session-1");
    expect((await cache.load("session-1"))?.stale).toBe(false);

    await cache.markStale("session-1");
    expect((await cache.load("session-1"))?.stale).toBe(true);
  });

  it("markCaughtUp and markStale are no-ops when nothing is cached", async () => {
    const cache = new OfflineCache(new InMemoryStructuredStorage(), new FakeClock());
    expect(await cache.markCaughtUp("missing")).toBeNull();
    expect(await cache.markStale("missing")).toBeNull();
  });

  it("re-saving after catch-up resets the entry to stale again", async () => {
    const cache = new OfflineCache(new InMemoryStructuredStorage(), new FakeClock());
    await cache.save("session-1", { revision: 1 });
    await cache.markCaughtUp("session-1");
    expect((await cache.load("session-1"))?.stale).toBe(false);

    await cache.save("session-1", { revision: 2 });
    const reloaded = await cache.load<{ revision: number }>("session-1");
    expect(reloaded?.stale).toBe(true);
    expect(reloaded?.data.revision).toBe(2);
  });

  it("clears a cached entry", async () => {
    const cache = new OfflineCache(new InMemoryStructuredStorage(), new FakeClock());
    await cache.save("session-1", { ok: true });
    await cache.clear("session-1");
    expect(await cache.load("session-1")).toBeNull();
  });

  it("survives a simulated app restart, still flagged stale on cold load", async () => {
    const backing = new Map<string, unknown>();
    const before = new OfflineCache(new InMemoryStructuredStorage(backing), new FakeClock());
    await before.save<FakeTimelinePage>("session-1", {
      sessionId: "session-1",
      messageIds: ["m1"],
    });

    const after = new OfflineCache(new InMemoryStructuredStorage(backing), new FakeClock());
    const loaded = await after.load<FakeTimelinePage>("session-1");
    expect(loaded?.stale).toBe(true);
    expect(loaded?.data.messageIds).toEqual(["m1"]);
  });

  it("keeps distinct keys independent", async () => {
    const cache = new OfflineCache(new InMemoryStructuredStorage(), new FakeClock());
    await cache.save("session-1", { n: 1 });
    await cache.save("session-2", { n: 2 });
    await cache.markCaughtUp("session-1");

    expect((await cache.load<{ n: number }>("session-1"))?.stale).toBe(false);
    expect((await cache.load<{ n: number }>("session-2"))?.stale).toBe(true);
  });
});
