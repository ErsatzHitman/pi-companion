import type { ITheme } from "@xterm/xterm";

/**
 * Builds an xterm `ITheme` from this app's design tokens (plan.md §10.2)
 * instead of a hard-coded palette — the repository invariant is that no
 * raw hex color may appear under `apps/web/src`.
 *
 * xterm parses `ITheme` colors as plain CSS color strings through its own
 * color code, not through the DOM style cascade, so a `var(--...)`
 * reference does not resolve there. This reads the already-*computed*
 * custom-property values instead: `ensureDesignTokensCss` (see
 * `styles/design-tokens.ts`) puts every token onto `document.documentElement`
 * via its `[data-theme="light"|"dark"]` selector, so reading
 * `getComputedStyle(document.documentElement)` there returns the real
 * theme-appropriate value, and switching `data-theme` (light/dark/high
 * contrast) re-themes the terminal the same way it re-themes everything
 * else — callers just re-read this after a theme change.
 *
 * Beautiful UI (docs/beautiful-ui-reference.md) does not publish an ANSI
 * 16-color terminal palette. `@picompanion/design-tokens`' own
 * `tokens.ts` hits the identical gap for syntax highlighting and resolves
 * it by reusing the published ink ramp plus the green/orange/red/accent
 * tones it does publish, rather than inventing new colors; this mirrors
 * that same approach for the ANSI slots.
 */
export function readTerminalTheme(root: Element = document.documentElement): ITheme {
  const style = getComputedStyle(root);
  const read = (name: string): string => style.getPropertyValue(name).trim();

  const background = read("--code-code-background");
  const foreground = read("--code-code-foreground");
  const accent = read("--color-accent");
  const accentInk = read("--color-accent-ink");
  const accentTint = read("--color-accent-tint");
  const ink = read("--color-ink");
  const ink2 = read("--color-ink-2");
  const ink3 = read("--color-ink-3");
  const green = read("--color-green");
  const orange = read("--color-orange");
  const red = read("--color-red");

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: accentTint,
    // No published bright/dim ANSI pairs either: bright variants reuse
    // the same tone as their base color (see the module doc above).
    black: ink3,
    red,
    green,
    yellow: orange,
    blue: accent,
    magenta: accentInk,
    cyan: accentInk,
    white: ink2,
    brightBlack: ink2,
    brightRed: red,
    brightGreen: green,
    brightYellow: orange,
    brightBlue: accentInk,
    brightMagenta: accentInk,
    brightCyan: accentInk,
    brightWhite: ink,
  };
}

/** Reads the terminal's monospace font stack from tokens (`--font-family-mono`). */
export function readTerminalFontFamily(root: Element = document.documentElement): string {
  const value = getComputedStyle(root).getPropertyValue("--font-family-mono").trim();
  return value.length > 0 ? value : "monospace";
}

/**
 * Reads a token font size (`--font-size-<name>`, stored as a `rem`
 * string) and converts it to the pixel number xterm's `fontSize` option
 * expects. Falls back to a fixed 13px if the token is missing/unparsable
 * (e.g. before `ensureDesignTokensCss` has run) rather than letting xterm
 * fall back to its own hard-coded default.
 */
export function readTerminalFontSizePx(
  root: Element = document.documentElement,
  tokenName = "--font-size-base",
): number {
  const raw = getComputedStyle(root).getPropertyValue(tokenName).trim();
  const remValue = Number.parseFloat(raw);
  if (!Number.isFinite(remValue) || remValue <= 0) {
    return 13;
  }
  return remValue * 16;
}

/** `true` when the platform requests reduced motion (guards xterm's cursor blink). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
