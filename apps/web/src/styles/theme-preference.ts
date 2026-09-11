/**
 * Theme preference (plan.md §10.2, §10.5): the user's choice of System /
 * Light / Dark, persisted in `localStorage` and applied as
 * `data-theme="light|dark"` on `<html>` — the attribute
 * `@picompanion/design-tokens`' generated stylesheet keys its colour
 * blocks off (`web.ts#generateThemeCss`).
 *
 * `system` is the default and means "follow `prefers-color-scheme`
 * exactly", so this module owns the resolution rule and
 * `theme-runtime.ts` owns the live OS listener; both were previously one
 * function, which is why a stored choice could never outlive a reload.
 *
 * Every DOM/localStorage read is guarded: with no `document`/`window`
 * (older jsdom, SSR-shaped tests) the preference still resolves
 * (`system` → `light`) and every write becomes a no-op rather than a
 * throw.
 */

export type ThemePreference = "system" | "light" | "dark";

/** `localStorage` key the preference is persisted under. */
export const THEME_PREFERENCE_STORAGE_KEY = "picompanion.theme-preference";

/** The three choices, in the order the settings control offers them. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** Human labels for `THEME_PREFERENCES`, matching the design reference's own values. */
export const THEME_PREFERENCE_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** The subset of the DOM `Storage` interface this module needs (so tests can inject a plain map). */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ThemeStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // A blocked-cookies/privacy-mode `localStorage` accessor throws;
    // "cannot persist" is not a reason the theme cannot be applied.
    return null;
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/** Reads the persisted preference; anything missing or unrecognized is `system`. */
export function readThemePreference(
  storage: ThemeStorage | null = defaultStorage(),
): ThemePreference {
  try {
    const raw = storage?.getItem(THEME_PREFERENCE_STORAGE_KEY) ?? null;
    return isThemePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/** Persists the preference; a storage failure is swallowed (the applied theme still changes). */
export function writeThemePreference(
  preference: ThemePreference,
  storage: ThemeStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // See `defaultStorage`: persisting is best-effort.
  }
}

/** True when the OS currently asks for a dark colour scheme; `false` without `matchMedia`. */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The resolved theme for a preference: `system` defers to the OS query. */
export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

function documentRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.documentElement;
}

/** Applies a preference's resolved theme to `<html>`; returns the theme actually applied. */
export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement | null = documentRoot(),
): "light" | "dark" {
  const resolved = resolveTheme(preference);
  root?.setAttribute("data-theme", resolved);
  return resolved;
}

/** Persist + apply in one call — the settings control's only writer. */
export function setThemePreference(
  preference: ThemePreference,
  root: HTMLElement | null = documentRoot(),
  storage: ThemeStorage | null = defaultStorage(),
): "light" | "dark" {
  writeThemePreference(preference, storage);
  return applyThemePreference(preference, root);
}
