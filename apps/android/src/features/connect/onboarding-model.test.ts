import { describe, expect, it } from "vitest";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import { createOnboardingController, ONBOARDING_STORAGE_KEY } from "./onboarding-model.js";

/** In-memory `KeyValueStorage` fake — mirrors `credential-store.test.ts`'s convention of a scripted plain-storage fake rather than a real Expo/AsyncStorage adapter. */
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

/** A `KeyValueStorage` whose `getItem` always rejects — proves the "storage that fails to read must not silently skip onboarding" rule. */
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

describe("createOnboardingController", () => {
  it("fresh storage: runs onboarding, starting at the welcome step (clean install)", async () => {
    const controller = createOnboardingController({ storage: makeMemoryStorage() });
    expect(controller.getSnapshot().phase).toBe("loading");
    await controller.load();
    expect(controller.getSnapshot()).toEqual({ phase: "welcome", loadError: false });
  });

  it("completed storage: skips onboarding entirely (subsequent launch)", async () => {
    const storage = makeMemoryStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify({
        version: 1,
        status: "completed",
        step: "permissions",
      }),
    });
    const controller = createOnboardingController({ storage });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({ phase: "completed", loadError: false });
  });

  it("half-finished storage (in-progress at permissions): resumes at that step, not welcome and not completed", async () => {
    const storage = makeMemoryStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify({
        version: 1,
        status: "in-progress",
        step: "permissions",
      }),
    });
    const controller = createOnboardingController({ storage });
    await controller.load();
    expect(controller.getSnapshot()).toEqual({ phase: "permissions", loadError: false });
  });

  it("a storage read failure runs onboarding from welcome — it never resolves to completed", async () => {
    const controller = createOnboardingController({ storage: makeThrowingStorage() });
    await controller.load();
    const snapshot = controller.getSnapshot();
    expect(snapshot.phase).toBe("welcome");
    expect(snapshot.phase).not.toBe("completed");
    expect(snapshot.loadError).toBe(true);
  });

  it("corrupt (unparsable) persisted JSON also runs onboarding from welcome, never completed", async () => {
    const storage = makeMemoryStorage({ [ONBOARDING_STORAGE_KEY]: "{not json" });
    const controller = createOnboardingController({ storage });
    await controller.load();
    const snapshot = controller.getSnapshot();
    expect(snapshot.phase).toBe("welcome");
    expect(snapshot.loadError).toBe(true);
  });

  it("a well-formed but unrecognized persisted shape also falls back to welcome, not completed", async () => {
    const storage = makeMemoryStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify({ version: 2, status: "bogus" }),
    });
    const controller = createOnboardingController({ storage });
    await controller.load();
    expect(controller.getSnapshot().phase).toBe("welcome");
  });

  it("advance() moves welcome -> permissions and persists the step before publishing it", async () => {
    const storage = makeMemoryStorage();
    const controller = createOnboardingController({ storage });
    await controller.load();
    await controller.advance();
    expect(controller.getSnapshot().phase).toBe("permissions");
    const persisted = await storage.getItem(ONBOARDING_STORAGE_KEY);
    expect(JSON.parse(persisted as string)).toEqual({
      version: 1,
      status: "in-progress",
      step: "permissions",
    });
  });

  it("complete() finishes onboarding, persists status completed, and a fresh controller over the same storage then skips it", async () => {
    const storage = makeMemoryStorage();
    const first = createOnboardingController({ storage });
    await first.load();
    await first.advance();
    await first.complete();
    expect(first.getSnapshot().phase).toBe("completed");

    // A brand-new controller/gate mount (process restart) over the same
    // durable storage is exactly what "skipped on subsequent launches"
    // means — proved end to end here, not just as two isolated units.
    const second = createOnboardingController({ storage });
    await second.load();
    expect(second.getSnapshot().phase).toBe("completed");
  });

  it("advance() is a no-op once already past welcome (does not throw, does not move)", async () => {
    const storage = makeMemoryStorage();
    const controller = createOnboardingController({ storage });
    await controller.load();
    await controller.advance();
    expect(controller.getSnapshot().phase).toBe("permissions");
    await controller.advance();
    expect(controller.getSnapshot().phase).toBe("permissions");
  });

  it("complete() before load() has resolved is a no-op — never publishes completed from the loading phase", async () => {
    const controller = createOnboardingController({ storage: makeMemoryStorage() });
    expect(controller.getSnapshot().phase).toBe("loading");
    await controller.complete();
    expect(controller.getSnapshot().phase).toBe("loading");
  });

  it("subscribe() notifies listeners of every published snapshot and unsubscribe stops further notifications", async () => {
    const storage = makeMemoryStorage();
    const controller = createOnboardingController({ storage });
    const seen: string[] = [];
    const unsubscribe = controller.subscribe((snapshot) => seen.push(snapshot.phase));
    await controller.load();
    await controller.advance();
    unsubscribe();
    await controller.complete();
    expect(seen).toEqual(["welcome", "permissions"]);
  });
});
