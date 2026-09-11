import { ensureDesignTokensCss } from "./design-tokens.js";
import { applyThemePreference, readThemePreference } from "./theme-preference.js";

/**
 * Applies the resolved theme and `data-contrast` on `<html>` so the
 * selectors `web.ts#generateThemeCss` emits (`[data-theme="light|dark"]`,
 * `[data-contrast="high"]`) resolve to the right token block.
 *
 * The chosen theme comes from `theme-preference.ts` (persisted System /
 * Light / Dark; System is the default). This module adds the two live
 * listeners the platform can offer: `prefers-contrast` always applies,
 * and `prefers-color-scheme` applies only while the stored preference is
 * still `system`, re-read at event time so a later choice made from the
 * settings screen wins without re-running bootstrap.
 *
 * Idempotent and safe to call from tests: with no `matchMedia` (older
 * jsdom) it falls back to light/normal contrast and skips the listeners.
 */
export function bootstrapThemeRuntime(): void {
  ensureDesignTokensCss();
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  const applyContrast = (high: boolean) => {
    if (high) root.setAttribute("data-contrast", "high");
    else root.removeAttribute("data-contrast");
  };

  applyThemePreference(readThemePreference(), root);

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    applyContrast(false);
    return;
  }

  const contrastQuery = window.matchMedia("(prefers-contrast: more)");
  applyContrast(contrastQuery.matches);
  contrastQuery.addEventListener("change", (event) => applyContrast(event.matches));

  const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  schemeQuery.addEventListener("change", () => {
    if (readThemePreference() === "system") applyThemePreference("system", root);
  });
}
