import { describe, expect, it } from "vitest";
import { HostProfileStore } from "./host-profile-store.js";
import { FakeClock } from "./test-support/fake-clock.js";
import { InMemorySecureStorage, InMemoryStructuredStorage } from "./test-support/fakes.js";

function makeStore() {
  const storage = new InMemoryStructuredStorage();
  const secrets = new InMemorySecureStorage();
  const clock = new FakeClock(1_000);
  const store = new HostProfileStore({ storage, secrets, clock });
  return { store, storage, secrets, clock };
}

describe("HostProfileStore", () => {
  it("creates a profile, assigning an id, createdAt, and updatedAt", async () => {
    const { store } = makeStore();
    const profile = await store.save({
      label: "My laptop",
      direct: { endpoint: "localhost:6767", useTls: false },
    });
    expect(profile.id).toBeTruthy();
    expect(profile.label).toBe("My laptop");
    expect(profile.direct).toEqual({ endpoint: "localhost:6767", useTls: false });
    expect(profile.preferDirect).toBe(true);
    expect(profile.createdAt).toBe(1_000);
    expect(profile.updatedAt).toBe(1_000);
    expect(profile.lastConnectedAt).toBeNull();
    expect(profile.lastConnectionKind).toBeNull();
  });

  it("persists profiles through the storage interface: list()/get() see what save() wrote", async () => {
    const { store, storage } = makeStore();
    const saved = await store.save({ label: "Host A" });
    expect((await store.get(saved.id))?.label).toBe("Host A");
    expect(await store.list()).toEqual([saved]);

    // Prove this is the injected StructuredStorage, not private in-memory
    // state: a second store over the same storage sees the same data.
    const other = new HostProfileStore({
      storage,
      secrets: new InMemorySecureStorage(),
      clock: new FakeClock(),
    });
    expect(await other.get(saved.id)).toEqual(saved);
  });

  it("updates an existing profile in place, preserving createdAt across the update", async () => {
    const { store, clock } = makeStore();
    const created = await store.save({ label: "Host A" });
    clock.advance(5_000);
    const updated = await store.save({
      id: created.id,
      label: "Host A (renamed)",
      preferDirect: false,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.label).toBe("Host A (renamed)");
    expect(updated.preferDirect).toBe(false);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBe(6_000);
    expect(await store.list()).toHaveLength(1);
  });

  it("preserves an existing connection profile field an update omits", async () => {
    const { store } = makeStore();
    const created = await store.save({
      label: "Host A",
      direct: { endpoint: "localhost:6767", useTls: false },
    });
    const updated = await store.save({ id: created.id, label: "Host A renamed" });
    expect(updated.direct).toEqual({ endpoint: "localhost:6767", useTls: false });
  });

  it("keeps the password out of the persisted HostProfile record, routing it through SecureStorage instead", async () => {
    const { store, storage } = makeStore();
    const profile = await store.save({ label: "Host A" }, { password: "hunter2" });
    expect(JSON.stringify(profile)).not.toContain("hunter2");
    const raw = await storage.get("hosts.profiles", profile.id);
    expect(JSON.stringify(raw)).not.toContain("hunter2");
    expect(await store.getPassword(profile.id)).toBe("hunter2");
  });

  it("returns null for a password that was never set", async () => {
    const { store } = makeStore();
    const profile = await store.save({ label: "Host A" });
    expect(await store.getPassword(profile.id)).toBeNull();
  });

  it("setPassword/clearPassword manage the secret independently of save()", async () => {
    const { store } = makeStore();
    const profile = await store.save({ label: "Host A" });
    await store.setPassword(profile.id, "secret1");
    expect(await store.getPassword(profile.id)).toBe("secret1");
    await store.clearPassword(profile.id);
    expect(await store.getPassword(profile.id)).toBeNull();
  });

  it("remove() deletes both the profile and its stored password", async () => {
    const { store } = makeStore();
    const profile = await store.save({ label: "Host A" }, { password: "hunter2" });
    await store.remove(profile.id);
    expect(await store.get(profile.id)).toBeNull();
    expect(await store.getPassword(profile.id)).toBeNull();
  });

  it("recordConnectionOutcome sets lastConnectedAt/lastConnectionKind using the injected clock", async () => {
    const { store, clock } = makeStore();
    const profile = await store.save({ label: "Host A" });
    clock.advance(2_500);
    const updated = await store.recordConnectionOutcome(profile.id, "relay");
    expect(updated?.lastConnectedAt).toBe(3_500);
    expect(updated?.lastConnectionKind).toBe("relay");
    expect((await store.get(profile.id))?.lastConnectionKind).toBe("relay");
  });

  it("recordConnectionOutcome returns null for an unknown profile id", async () => {
    const { store } = makeStore();
    expect(await store.recordConnectionOutcome("does-not-exist", "direct")).toBeNull();
  });
});
