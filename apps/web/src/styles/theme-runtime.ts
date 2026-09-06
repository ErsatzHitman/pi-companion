import { ensureDesignTokensCss } from "./design-tokens.js";

/**
 * Applies `data-theme`/`data-contrast` on `<html>` so the selectors
 * `web.ts#generateThemeCss` emits (`[data-theme="light|dark"]`,
 * `[data-contrast="high"]`) resolve to the right token block, tracking
 * `prefers-color-scheme` and `prefers-contrast` live. Idempotent and safe
 * to call from tests: with no `matchMedia` (older jsdom) it falls back to
 * light/normal contrast and skips the listeners.
 */
export function bootstrapThemeRuntime(): void {
  ensureDesignTokensCss();
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  const applyScheme = (dark: boolean) => {
    root.setAttribute("data-theme", dark ? "dark" : "light");
  };
  const applyContrast = (high: boolean) => {
    if (high) root.setAttribute("data-contrast", "high");
    else root.removeAttribute("data-contrast");
  };

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    applyScheme(false);
    applyContrast(false);
    return;
  }

  const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const contrastQuery = window.matchMedia("(prefers-contrast: more)");
  applyScheme(schemeQuery.matches);
  applyContrast(contrastQuery.matches);
  schemeQuery.addEventListener("change", (event) => applyScheme(event.matches));
  contrastQuery.addEventListener("change", (event) => applyContrast(event.matches));
}
