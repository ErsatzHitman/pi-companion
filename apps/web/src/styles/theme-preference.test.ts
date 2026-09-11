import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapThemeRuntime } from "./theme-runtime.js";
import {
  THEME_PREFERENCE_STORAGE_KEY,
  applyThemePreference,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  systemPrefersDark,
  writeThemePreference,
} from "./theme-preference.js";
import type { ThemeStorage } from "./theme-preference.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    raw: map,
  };
}

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
  };
  const original = window.matchMedia;
  window.matchMedia = (() => query) as unknown as typeof window.matchMedia;
  return {
    emit: (next: boolean) => {
      // A real MediaQueryList flips `matches` before dispatching the
      // change event, and `applyThemePreference("system")` re-queries it.
      query.matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
    restore: () => {
      window.matchMedia = original;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-contrast");
});

describe("theme preference storage", () => {
  it("recognizes only the three real preferences", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("midnight")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it("defaults to system when nothing (or garbage) is persisted", () => {
    expect(readThemePreference(memoryStorage())).toBe("system");
    expect(readThemePreference(memoryStorage({ [THEME_PREFERENCE_STORAGE_KEY]: "midnight" }))).toBe(
      "system",
    );
  });

  it("round-trips a real choice", () => {
    const storage = memoryStorage();
    writeThemePreference("dark", storage);
    expect(storage.raw.get(THEME_PREFERENCE_STORAGE_KEY)).toBe("dark");
    expect(readThemePreference(storage)).toBe("dark");
  });

  it("never throws when storage throws or is absent", () => {
    const throwing: ThemeStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readThemePreference(throwing)).toBe("system");
    expect(() => writeThemePreference("light", throwing)).not.toThrow();
    expect(readThemePreference(null)).toBe("system");
    expect(() => writeThemePreference("light", null)).not.toThrow();
  });
});

describe("theme resolution", () => {
  it("resolves an explicit preference without consulting the OS", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves system through prefers-color-scheme, defaulting to light without matchMedia", () => {
    const noMatchMedia = (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
    (window as { matchMedia?: typeof window.matchMedia }).matchMedia = undefined;
    expect(systemPrefersDark()).toBe(false);
    expect(resolveTheme("system")).toBe("light");
    (window as { matchMedia?: typeof window.matchMedia }).matchMedia = noMatchMedia;

    const media = stubMatchMedia(true);
    try {
      expect(systemPrefersDark()).toBe(true);
      expect(resolveTheme("system")).toBe("dark");
    } finally {
      media.restore();
    }
  });

  it("applies the resolved theme on the element it is given", () => {
    const media = stubMatchMedia(false);
    try {
      expect(applyThemePreference("dark")).toBe("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      expect(applyThemePreference("system")).toBe("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    } finally {
      media.restore();
    }
  });

  it("setThemePreference persists and applies in one call", () => {
    const storage = memoryStorage();
    setThemePreference("dark", document.documentElement, storage);
    expect(readThemePreference(storage)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("bootstrapThemeRuntime", () => {
  it("applies the persisted preference rather than always following the OS", () => {
    const storage = memoryStorage({ [THEME_PREFERENCE_STORAGE_KEY]: "dark" });
    const originalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    const media = stubMatchMedia(false);
    try {
      bootstrapThemeRuntime();
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    } finally {
      media.restore();
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it("follows a live OS change only while the preference is still system", () => {
    const storage = memoryStorage();
    const originalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    const media = stubMatchMedia(false);
    try {
      bootstrapThemeRuntime();
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");

      media.emit(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      // An explicit choice pins the theme: the OS listener must leave it
      // alone from here on (the control itself applies the new choice
      // through `setThemePreference`, covered above).
      storage.setItem(THEME_PREFERENCE_STORAGE_KEY, "light");
      media.emit(false);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    } finally {
      media.restore();
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });
});
