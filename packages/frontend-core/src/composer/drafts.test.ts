import { describe, expect, it } from "vitest";
import { DraftStore, isDraftAlreadySubmitted } from "./drafts.js";
import { FakeClock, InMemoryStructuredStorage } from "./test-doubles.js";

describe("DraftStore", () => {
  it("returns null for a key with no saved draft", async () => {
    const store = new DraftStore(new InMemoryStructuredStorage(), new FakeClock());
    expect(await store.load("session-1")).toBeNull();
  });

  it("saves and loads a draft with attachments", async () => {
    const clock = new FakeClock(1_000);
    const store = new DraftStore(new InMemoryStructuredStorage(), clock);

    const saved = await store.save("session-1", {
      text: "hello there",
      attachments: [{ id: "att-1", name: "log.txt", mimeType: "text/plain", size: 42 }],
    });

    expect(saved).toEqual({
      key: "session-1",
      text: "hello there",
      attachments: [{ id: "att-1", name: "log.txt", mimeType: "text/plain", size: 42 }],
      updatedAt: 1_000,
    });

    const loaded = await store.load("session-1");
    expect(loaded).toEqual(saved);
  });

  it("defaults attachments to an empty array when omitted", async () => {
    const store = new DraftStore(new InMemoryStructuredStorage(), new FakeClock());
    await store.save("session-1", { text: "no attachments" });
    const loaded = await store.load("session-1");
    expect(loaded?.attachments).toEqual([]);
  });

  it("survives a simulated app restart through the storage interface", async () => {
    const backing = new Map<string, unknown>();
    const clock = new FakeClock(5_000);

    const storeBeforeRestart = new DraftStore(new InMemoryStructuredStorage(backing), clock);
    await storeBeforeRestart.save("session-1", { text: "draft before restart" });

    // Simulate restart: a brand-new DraftStore instance, but constructed
    // over the same underlying storage (as a real disk-backed
    // StructuredStorage would be after the app relaunches).
    const storeAfterRestart = new DraftStore(
      new InMemoryStructuredStorage(backing),
      new FakeClock(),
    );
    const loaded = await storeAfterRestart.load("session-1");

    expect(loaded?.text).toBe("draft before restart");
  });

  it("clears a saved draft", async () => {
    const store = new DraftStore(new InMemoryStructuredStorage(), new FakeClock());
    await store.save("session-1", { text: "will be cleared" });
    await store.clear("session-1");
    expect(await store.load("session-1")).toBeNull();
  });

  it("lists every saved draft, most recently updated first", async () => {
    const clock = new FakeClock(0);
    const store = new DraftStore(new InMemoryStructuredStorage(), clock);

    await store.save("session-1", { text: "first" });
    clock.advance(10);
    await store.save("session-2", { text: "second" });
    clock.advance(10);
    await store.save("session-3", { text: "third" });

    const all = await store.listAll();
    expect(all.map((draft) => draft.key)).toEqual(["session-3", "session-2", "session-1"]);
  });

  it("keeps drafts for different keys independent", async () => {
    const store = new DraftStore(new InMemoryStructuredStorage(), new FakeClock());
    await store.save("session-1", { text: "draft one" });
    await store.save("session-2", { text: "draft two" });

    expect((await store.load("session-1"))?.text).toBe("draft one");
    expect((await store.load("session-2"))?.text).toBe("draft two");
  });
});

describe("isDraftAlreadySubmitted (FIX-W2)", () => {
  it("is false for a blank draft, regardless of outbox contents", () => {
    expect(
      isDraftAlreadySubmitted("   ", "session-1", [
        { sessionId: "session-1", status: "sending", payload: { text: "   " } },
      ]),
    ).toBe(false);
  });

  it("is false when no outbox entry matches the session", () => {
    expect(
      isDraftAlreadySubmitted("already sent", "session-1", [
        { sessionId: "session-2", status: "sending", payload: { text: "already sent" } },
      ]),
    ).toBe(false);
  });

  it("is false when the matching entry's text differs", () => {
    expect(
      isDraftAlreadySubmitted("a different draft", "session-1", [
        { sessionId: "session-1", status: "sending", payload: { text: "already sent" } },
      ]),
    ).toBe(false);
  });

  it.each(["pending", "sending", "awaiting-confirmation", "sent"] as const)(
    "is true when a same-session entry in status %s matches, comparing trimmed text",
    (status) => {
      expect(
        isDraftAlreadySubmitted("  already sent  ", "session-1", [
          { sessionId: "session-1", status, payload: { text: "already sent" } },
        ]),
      ).toBe(true);
    },
  );

  it("ignores a malformed payload rather than throwing", () => {
    expect(
      isDraftAlreadySubmitted("already sent", "session-1", [
        { sessionId: "session-1", status: "sending", payload: null },
        { sessionId: "session-1", status: "sending", payload: "not an object" },
      ]),
    ).toBe(false);
  });
});
