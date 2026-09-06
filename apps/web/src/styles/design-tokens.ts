import { generateThemeCss } from "@picompanion/design-tokens";

let injected = false;

/**
 * Injects the generated design-token CSS custom properties (plan.md
 * §10.2) into `document.head` exactly once. Every web primitive reads
 * colour, spacing, typography, radius, elevation, and motion values
 * through `var(--...)` — this is the one place a generated stylesheet
 * turns into DOM state, so no component file needs to import
 * `@picompanion/design-tokens` directly or hold a raw hex/pixel value.
 *
 * Safe to call from tests (jsdom) and from `main.tsx`; a second call is a
 * no-op.
 */
export function ensureDesignTokensCss(): void {
  if (injected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.setAttribute("data-design-tokens", "true");
  style.textContent = generateThemeCss();
  document.head.appendChild(style);
  injected = true;
}
