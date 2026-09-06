import { describe, expect, it, vi } from "vitest";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import {
  assertSettingNotSecretShaped,
  createSettingsController,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  settingsSecurityGuard,
} from "./settings-model.js";

/** In-memory `KeyValueStorage` fake — mirrors `onboarding-model.test.ts`'s `makeMemoryStorage`. */
function makeMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const store = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
    async keys(prefix) {
      const all = [...store.keys()];
      return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
    },
  };
}

/** A `KeyValueStorage` whose `getItem` always rejects. */
function makeThrowingStorage(): KeyValueStorage {
  return {
    async getItem() {
      throw new Error("simulated storage read failure");
    },
    async setItem() {},
    async removeItem() {},
    async clear() {},
    async keys() {
      return [];
    },
  };
}

describe("createSettingsController: the default-value rule (four failure shapes)", () => {
  it("missing key: resolves to DEFAULT_SETTINGS, no loadError", async () => {
    const controller = createSettingsController({ storage: makeMemoryStorage() });
    expect(controller.getSnapshot()).toEqual({
      ...DEFAULT_SETTINGS,
      loaded: false,
      loadError: false,
    });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({
      ...DEFAULT_SETTINGS,
      loaded: true,
      loadError: false,
    });
  });

  it("malformed JSON: resolves to DEFAULT_SETTINGS with loadError true, never a disabled setting", async () => {
    const storage = makeMemoryStorage({ [SETTINGS_STORAGE_KEY]: "{not json" });
    const controller = createSettingsController({ storage });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({
      ...DEFAULT_SETTINGS,
      loaded: true,
      loadError: true,
    });
  });

  it("wrong-typed value (hapticsEnabled as a string, not boolean): resolves to DEFAULT_SETTINGS with loadError true", async () => {
    const storage = makeMemoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 1, hapticsEnabled: "yes" }),
    });
    const controller = createSettingsController({ storage });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({
      ...DEFAULT_SETTINGS,
      loaded: true,
      loadError: true,
    });
  });

  it("storage read throws: resolves to DEFAULT_SETTINGS (true) with loadError true -- a read failure must not silently turn haptics off", async () => {
    const controller = createSettingsController({ storage: makeThrowingStorage() });
    await controller.load();
    const snapshot = controller.getSnapshot();
    expect(snapshot.hapticsEnabled).toBe(true);
    expect(snapshot.loadError).toBe(true);
  });

  it("unknown version envelope is treated as malformed, not silently accepted", async () => {
    const storage = makeMemoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 2, hapticsEnabled: false }),
    });
    const controller = createSettingsController({ storage });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({
      ...DEFAULT_SETTINGS,
      loaded: true,
      loadError: true,
    });
  });
});

describe("createSettingsController: persistence and cold start", () => {
  it("setHapticsEnabled(false) persists through the given KeyValueStorage and updates the snapshot immediately", async () => {
    const storage = makeMemoryStorage();
    const controller = createSettingsController({ storage });
    await controller.load();
    await controller.setHapticsEnabled(false);
    expect(controller.getSnapshot().hapticsEnabled).toBe(false);
    expect(await storage.getItem(SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, hapticsEnabled: false }),
    );
  });

  it("survives a cold start: a second controller over the same storage reads back what the first wrote", async () => {
    const storage = makeMemoryStorage();
    const first = createSettingsController({ storage });
    await first.load();
    await first.setHapticsEnabled(false);

    // Simulates a process restart: a brand new controller instance, same storage.
    const second = createSettingsController({ storage });
    expect(second.getSnapshot()).toEqual({ ...DEFAULT_SETTINGS, loaded: false, loadError: false });
    await second.load();
    expect(second.getSnapshot()).toEqual({ hapticsEnabled: false, loaded: true, loadError: false });
  });

  it("subscribe/unsubscribe: a listener is notified on load() and set*(), and not after unsubscribing", async () => {
    const storage = makeMemoryStorage();
    const controller = createSettingsController({ storage });
    const seen: boolean[] = [];
    const unsubscribe = controller.subscribe((snapshot) => seen.push(snapshot.hapticsEnabled));

    await controller.load();
    await controller.setHapticsEnabled(false);
    unsubscribe();
    await controller.setHapticsEnabled(true);

    expect(seen).toEqual([true, false]);
  });
});

describe("assertSettingNotSecretShaped", () => {
  it("does not throw for the real setting this store defines today (a plain boolean)", () => {
    expect(() => assertSettingNotSecretShaped("hapticsEnabled", true)).not.toThrow();
    expect(() => assertSettingNotSecretShaped("hapticsEnabled", false)).not.toThrow();
  });

  it("does not throw for an ordinary string field", () => {
    expect(() => assertSettingNotSecretShaped("displayName", "My Pi")).not.toThrow();
  });

  it("throws when a hypothetical future string setting's KEY looks secret-shaped", () => {
    expect(() => assertSettingNotSecretShaped("apiKey", "not obviously secret")).toThrow(
      /secret-shaped/,
    );
  });

  it("throws when a hypothetical future string setting's VALUE looks secret-shaped, regardless of an innocuous key", () => {
    const ghToken = `ghp_${"a".repeat(36)}`;
    expect(() => assertSettingNotSecretShaped("note", ghToken)).toThrow(/secret-shaped/);
  });

  it("setHapticsEnabled still succeeds end-to-end through persist()'s guard for the real boolean setting", async () => {
    const storage = makeMemoryStorage();
    const controller = createSettingsController({ storage });
    await expect(controller.setHapticsEnabled(true)).resolves.toBeUndefined();
  });

  it("the guard is actually wired into persist(), not just standalone-testable -- proven by a spy, since no field PersistedSettings defines today can trip it through the public API alone", async () => {
    const storage = makeMemoryStorage();
    const controller = createSettingsController({ storage });
    const spy = vi.spyOn(settingsSecurityGuard, "assertSettingNotSecretShaped");
    try {
      await controller.setHapticsEnabled(false);
      expect(spy).toHaveBeenCalledWith("hapticsEnabled", false);
    } finally {
      spy.mockRestore();
    }
  });
});
