import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RailCollapseStorage } from "./use-rail-collapse.js";
import { readRailCollapsed, useRailCollapse, writeRailCollapsed } from "./use-rail-collapse.js";

function memoryStorage(initial: Record<string, string> = {}): RailCollapseStorage & {
  raw: Map<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    raw: map,
  };
}

/** Mirrors `theme-preference.test.ts`'s throwing-storage stub for the degrade-gracefully path. */
function throwingStorage(): RailCollapseStorage {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
}

describe("readRailCollapsed / writeRailCollapsed", () => {
  it("defaults to expanded (false) with no stored value", () => {
    expect(readRailCollapsed("session", memoryStorage())).toBe(false);
    expect(readRailCollapsed("extension", memoryStorage())).toBe(false);
  });

  it("round-trips a written flag, keyed independently per rail", () => {
    const storage = memoryStorage();
    writeRailCollapsed("session", true, storage);
    expect(readRailCollapsed("session", storage)).toBe(true);
    expect(readRailCollapsed("extension", storage)).toBe(false);
  });

  it("reads false and swallows the throw when storage access itself throws", () => {
    const storage = throwingStorage();
    expect(readRailCollapsed("session", storage)).toBe(false);
    expect(() => writeRailCollapsed("session", true, storage)).not.toThrow();
  });

  it("reads false with no storage at all (e.g. SSR/older jsdom)", () => {
    expect(readRailCollapsed("session", null)).toBe(false);
  });
});

describe("useRailCollapse", () => {
  it("starts both rails expanded when nothing is persisted", () => {
    const { result } = renderHook(() => useRailCollapse(memoryStorage()));
    expect(result.current.sessionCollapsed).toBe(false);
    expect(result.current.extensionCollapsed).toBe(false);
  });

  it("reads a persisted collapsed flag back on mount", () => {
    const storage = memoryStorage({ "picompanion.rail-collapsed.extension": "1" });
    const { result } = renderHook(() => useRailCollapse(storage));
    expect(result.current.sessionCollapsed).toBe(false);
    expect(result.current.extensionCollapsed).toBe(true);
  });

  it("toggleSessionRail flips only the session flag and persists it", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useRailCollapse(storage));

    act(() => result.current.toggleSessionRail());
    expect(result.current.sessionCollapsed).toBe(true);
    expect(result.current.extensionCollapsed).toBe(false);
    expect(storage.raw.get("picompanion.rail-collapsed.session")).toBe("1");

    act(() => result.current.toggleSessionRail());
    expect(result.current.sessionCollapsed).toBe(false);
    expect(storage.raw.get("picompanion.rail-collapsed.session")).toBe("0");
  });

  it("toggleExtensionRail flips only the extension flag and persists it", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useRailCollapse(storage));

    act(() => result.current.toggleExtensionRail());
    expect(result.current.extensionCollapsed).toBe(true);
    expect(result.current.sessionCollapsed).toBe(false);
    expect(storage.raw.get("picompanion.rail-collapsed.extension")).toBe("1");
  });

  it("keeps toggling in memory even when storage throws on every access", () => {
    const { result } = renderHook(() => useRailCollapse(throwingStorage()));
    expect(result.current.sessionCollapsed).toBe(false);

    act(() => result.current.toggleSessionRail());
    expect(result.current.sessionCollapsed).toBe(true);

    act(() => result.current.toggleSessionRail());
    expect(result.current.sessionCollapsed).toBe(false);
  });
});
