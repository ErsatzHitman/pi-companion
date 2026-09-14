import { useCallback, useState } from "react";

/**
 * Manual sidebar collapse state for `Shell` (owner requirement: the design
 * reference `docs/ui-reference/pi-companion-web.html` fixes both rails at a
 * constant width with no collapse affordance at all, but the product needs
 * one for both the session rail and the live Pi extension rail).
 *
 * Persisted to `localStorage` so a chosen collapse survives a reload, using
 * the exact guarded-read/guarded-write shape `styles/theme-preference.ts`
 * already established for this app: every accessor is wrapped in `try`/
 * `catch` and falls back to a plain in-memory default, so a blocked-cookies/
 * privacy-mode `localStorage` accessor (which throws on access, not just on
 * read) degrades to "the toggle still works for this tab, just does not
 * outlive a reload" rather than crashing the shell.
 */

export type RailId = "session" | "extension";

/** The subset of the DOM `Storage` interface this module needs (so tests can inject a plain map). */
export interface RailCollapseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageKey(rail: RailId): string {
  return `picompanion.rail-collapsed.${rail}`;
}

function defaultStorage(): RailCollapseStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // A blocked-cookies/privacy-mode `localStorage` accessor throws;
    // "cannot persist" is not a reason the toggle itself cannot work.
    return null;
  }
}

/** Reads a rail's persisted collapsed flag; anything missing or unrecognized is `false` (expanded). */
export function readRailCollapsed(
  rail: RailId,
  storage: RailCollapseStorage | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(storageKey(rail)) === "1";
  } catch {
    return false;
  }
}

/** Persists a rail's collapsed flag; a storage failure is swallowed (the in-memory toggle still works). */
export function writeRailCollapsed(
  rail: RailId,
  collapsed: boolean,
  storage: RailCollapseStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(storageKey(rail), collapsed ? "1" : "0");
  } catch {
    // See `defaultStorage`: persisting is best-effort.
  }
}

export interface RailCollapseState {
  sessionCollapsed: boolean;
  extensionCollapsed: boolean;
  toggleSessionRail: () => void;
  toggleExtensionRail: () => void;
}

/**
 * `Shell`'s own collapse hook. `storage` is overridable so tests can inject
 * a plain in-memory map (or a throwing stub, to prove the degrade-gracefully
 * path) instead of reaching into `window.localStorage` directly.
 *
 * The returned flags are read once, on mount, from `storage` — matching
 * `readThemePreference`'s own "read at construction time" contract — and
 * every toggle both updates the live React state and persists the new value
 * in the same call, so a manual choice always wins over whatever the CSS
 * responsive ladder in `shell.css` would otherwise do at the current
 * viewport width: the ladder can only ever auto-*hide* a rail at a narrow
 * width, and a `[data-rail-*="collapsed"]` selector there is unconditional
 * (not itself inside a `@media` block), so it keeps a manually collapsed
 * rail hidden even if the window is later widened past the point the ladder
 * would have shown it again.
 */
export function useRailCollapse(
  storage: RailCollapseStorage | null = defaultStorage(),
): RailCollapseState {
  const [sessionCollapsed, setSessionCollapsed] = useState(() =>
    readRailCollapsed("session", storage),
  );
  const [extensionCollapsed, setExtensionCollapsed] = useState(() =>
    readRailCollapsed("extension", storage),
  );

  const toggleSessionRail = useCallback(() => {
    setSessionCollapsed((wasCollapsed) => {
      const next = !wasCollapsed;
      writeRailCollapsed("session", next, storage);
      return next;
    });
  }, [storage]);

  const toggleExtensionRail = useCallback(() => {
    setExtensionCollapsed((wasCollapsed) => {
      const next = !wasCollapsed;
      writeRailCollapsed("extension", next, storage);
      return next;
    });
  }, [storage]);

  return { sessionCollapsed, extensionCollapsed, toggleSessionRail, toggleExtensionRail };
}
