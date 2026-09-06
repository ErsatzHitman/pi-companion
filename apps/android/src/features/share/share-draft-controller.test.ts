import { composer as coreComposer } from "@picompanion/frontend-core";
import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryStructuredStorage,
  createSystemClock,
} from "../composer/in-memory-outbox-runtime";
import type { ClassifiedShareContent } from "./share-intent-model";
import { drainQueuedShares, materializeShareDraft } from "./share-draft-controller";

const TEXT_CONTENT: ClassifiedShareContent = {
  kind: "text",
  text: "shared from another app",
  looksSecretShaped: false,
};
const URL_CONTENT: ClassifiedShareContent = { kind: "url", url: "https://example.com/x" };
const FILE_CONTENT: ClassifiedShareContent = {
  kind: "file",
  name: "photo.png",
  mimeType: "image/png",
  sizeBytes: 2048,
  uri: "content://com.example/photo.png",
};

function makeDeps() {
  const storage = createInMemoryStructuredStorage();
  const clock = createSystemClock();
  const draftStore = new coreComposer.DraftStore(storage, clock);
  const outbox = new coreComposer.OutboxController(storage, clock);
  return { draftStore, outbox };
}

describe("materializeShareDraft — online", () => {
  it("creates a draft in the chosen session", async () => {
    const deps = makeDeps();
    const result = await materializeShareDraft(TEXT_CONTENT, "session-1", deps);
    expect(result).toEqual({ outcome: "drafted", sessionId: "session-1" });

    const draft = await deps.draftStore.load("session-1");
    expect(draft?.text).toBe("shared from another app");
  });

  it("does not create a draft in any other session", async () => {
    const deps = makeDeps();
    await materializeShareDraft(TEXT_CONTENT, "session-1", deps);
    const otherDraft = await deps.draftStore.load("session-2");
    expect(otherDraft).toBeNull();
  });

  it("appends to (never overwrites) existing draft text in the chosen session", async () => {
    const deps = makeDeps();
    await deps.draftStore.save("session-1", { text: "already typing", attachments: [] });
    await materializeShareDraft(URL_CONTENT, "session-1", deps);
    const draft = await deps.draftStore.load("session-1");
    expect(draft?.text).toBe("already typing\nhttps://example.com/x");
  });

  it("adds a file share as a draft attachment ref, not as text", async () => {
    const deps = makeDeps();
    await materializeShareDraft(FILE_CONTENT, "session-1", deps);
    const draft = await deps.draftStore.load("session-1");
    expect(draft?.text).toBe("");
    expect(draft?.attachments).toHaveLength(1);
    expect(draft?.attachments[0]).toMatchObject({
      name: "photo.png",
      mimeType: "image/png",
      size: 2048,
    });
  });

  it("removes the outbox entry once the draft is materialized (no leftover queue entry on success)", async () => {
    const deps = makeDeps();
    await materializeShareDraft(TEXT_CONTENT, "session-1", deps);
    const remaining = await deps.outbox.loadAll("session-1");
    expect(remaining).toHaveLength(0);
  });

  it("logs nothing, even for secret-shaped shared text", async () => {
    const deps = makeDeps();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await materializeShareDraft(
        { kind: "text", text: "token sk-LIVEKEY1234567890ABCDEF", looksSecretShaped: true },
        "session-1",
        deps,
      );
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("materializeShareDraft — offline", () => {
  it("queues through the outbox instead of creating a draft", async () => {
    const deps = makeDeps();
    const result = await materializeShareDraft(TEXT_CONTENT, "session-1", {
      ...deps,
      isOnline: () => false,
    });
    expect(result.outcome).toBe("queued-offline");

    const draft = await deps.draftStore.load("session-1");
    expect(draft).toBeNull();

    const entries = await deps.outbox.loadAll("session-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "pending", sessionId: "session-1" });
  });

  it("the queued entry is scoped to the chosen session only", async () => {
    const deps = makeDeps();
    await materializeShareDraft(TEXT_CONTENT, "session-1", { ...deps, isOnline: () => false });
    const otherSessionEntries = await deps.outbox.loadAll("session-2");
    expect(otherSessionEntries).toHaveLength(0);
  });
});

describe("drainQueuedShares", () => {
  it("materializes every queued share for a session once back online, and empties the outbox", async () => {
    const deps = makeDeps();
    await materializeShareDraft(TEXT_CONTENT, "session-1", { ...deps, isOnline: () => false });
    await materializeShareDraft(FILE_CONTENT, "session-1", { ...deps, isOnline: () => false });

    const drained = await drainQueuedShares("session-1", deps);
    expect(drained).toBe(2);

    const draft = await deps.draftStore.load("session-1");
    expect(draft?.text).toBe("shared from another app");
    expect(draft?.attachments).toHaveLength(1);

    const remaining = await deps.outbox.loadAll("session-1");
    expect(remaining).toHaveLength(0);
  });

  it("is a no-op when nothing is queued", async () => {
    const deps = makeDeps();
    expect(await drainQueuedShares("session-1", deps)).toBe(0);
  });
});
