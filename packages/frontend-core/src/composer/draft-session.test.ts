import { describe, expect, it } from "vitest";
import type { StructuredStorage } from "../platform/storage.js";
import { DraftSessionController, DraftStore, draftKeyForSession } from "./drafts.js";
import { FakeClock, InMemoryStructuredStorage } from "./test-doubles.js";

/** Lets the controller's async `persist`/`load` promises settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function makeController(backing = new Map<string, unknown>()) {
  const clock = new FakeClock(1_000);
  const storage = new InMemoryStructuredStorage(backing);
  const store = new DraftStore(storage, clock);
  const controller = new DraftSessionController(store, clock, { debounceMs: 300 });
  return { backing, clock, storage, store, controller };
}

describe("draftKeyForSession", () => {
  it("changes when either half changes", () => {
    expect(draftKeyForSession({ serverId: "s1", agentId: "a1" })).not.toBe(
      draftKeyForSession({ serverId: "s1", agentId: "a2" }),
    );
    expect(draftKeyForSession({ serverId: "s1", agentId: "a1" })).not.toBe(
      draftKeyForSession({ serverId: "s2", agentId: "a1" }),
    );
  });

  it("cannot be fooled by a separator inside an id", () => {
    expect(draftKeyForSession({ serverId: "a", agentId: "b::c" })).not.toBe(
      draftKeyForSession({ serverId: "a::b", agentId: "c" }),
    );
  });
});

describe("DraftSessionController", () => {
  it("resolves to an empty draft when the target has none", async () => {
    const { controller } = makeController();
    expect(await controller.open({ serverId: "s1", agentId: "a1" })).toBe("");
  });

  it("restores a previously saved draft", async () => {
    const backing = new Map<string, unknown>();
    const { controller } = makeController(backing);
    await controller.open({ serverId: "s1", agentId: "a1" });
    controller.update("half-written");
    await controller.flush();

    const { controller: second } = makeController(backing);
    expect(await second.open({ serverId: "s1", agentId: "a1" })).toBe("half-written");
  });

  it("debounces a change until the injected clock advances", async () => {
    const { controller, clock, store } = makeController();
    await controller.open({ serverId: "s1", agentId: "a1" });
    controller.update("typed");

    expect(await store.load(draftKeyForSession({ serverId: "s1", agentId: "a1" }))).toBeNull();

    clock.advance(299);
    await settle();
    expect(await store.load(draftKeyForSession({ serverId: "s1", agentId: "a1" }))).toBeNull();

    clock.advance(1);
    await settle();
    expect((await store.load(draftKeyForSession({ serverId: "s1", agentId: "a1" })))?.text).toBe(
      "typed",
    );
  });

  it("keeps two sessions independent, clearing nothing on switch", async () => {
    const { controller, store } = makeController();
    await controller.open({ serverId: "s1", agentId: "a1" });
    controller.update("draft one");
    await controller.flush();

    expect(await controller.open({ serverId: "s1", agentId: "a2" })).toBe("");
    controller.update("draft two");
    await controller.flush();

    expect((await store.load(draftKeyForSession({ serverId: "s1", agentId: "a1" })))?.text).toBe(
      "draft one",
    );
    expect((await store.load(draftKeyForSession({ serverId: "s1", agentId: "a2" })))?.text).toBe(
      "draft two",
    );
  });

  it("flushes the previous session's pending change before switching", async () => {
    const { controller, store } = makeController();
    await controller.open({ serverId: "s1", agentId: "a1" });
    controller.update("unsaved when switching");

    // Switching before the debounce fires must not lose (or misattribute) it.
    await controller.open({ serverId: "s1", agentId: "a2" });

    expect((await store.load(draftKeyForSession({ serverId: "s1", agentId: "a1" })))?.text).toBe(
      "unsaved when switching",
    );
  });

  it("ignores updates before the first open resolves", async () => {
    const { controller, store } = makeController();
    controller.update("typed too early");
    await controller.open({ serverId: "s1", agentId: "a1" });
    await controller.flush();
    expect(await store.load(draftKeyForSession({ serverId: "s1", agentId: "a1" }))).toBeNull();
  });

  it("survives a restart: a new controller over the same storage sees the draft", async () => {
    const backing = new Map<string, unknown>();
    const { controller } = makeController(backing);
    await controller.open({ serverId: "s1", agentId: "a1" });
    controller.update("survives restart");
    await controller.flush();

    const relit = new DraftSessionController(
      new DraftStore(new InMemoryStructuredStorage(backing), new FakeClock()),
      new FakeClock(),
    );
    expect(await relit.open({ serverId: "s1", agentId: "a1" })).toBe("survives restart");
  });

  it("clears the active session's draft and cancels a pending write", async () => {
    const { controller, clock, store } = makeController();
    await controller.open({ serverId: "s1", agentId: "a1" });
    controller.update("to be cleared");
    await controller.clear();

    clock.advance(1_000);
    await settle();

    expect(await store.load(draftKeyForSession({ serverId: "s1", agentId: "a1" }))).toBeNull();
  });

  it("stays usable when storage is unavailable", async () => {
    const unavailable: StructuredStorage = {
      async get() {
        throw new Error("no storage");
      },
      async put() {
        throw new Error("no storage");
      },
      async delete() {
        throw new Error("no storage");
      },
      async list() {
        throw new Error("no storage");
      },
      async clear() {
        throw new Error("no storage");
      },
    };
    const controller = new DraftSessionController(
      new DraftStore(unavailable, new FakeClock()),
      new FakeClock(),
    );

    await expect(controller.open({ serverId: "s1", agentId: "a1" })).resolves.toBe("");
    controller.update("typed anyway");
    await expect(controller.flush()).resolves.toBeUndefined();
    await expect(controller.clear()).resolves.toBeUndefined();
  });
});
