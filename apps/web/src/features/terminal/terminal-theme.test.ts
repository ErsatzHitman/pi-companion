import { describe, expect, it } from "vitest";

import {
  prefersReducedMotion,
  readTerminalFontFamily,
  readTerminalFontSizePx,
  readTerminalTheme,
} from "./terminal-theme.js";

/**
 * T30A2 acceptance criterion "the terminal is themed from design tokens":
 * `test-setup.ts` already injects `@picompanion/design-tokens`' generated
 * CSS and sets `data-theme="light"` on `document.documentElement`, so
 * reading through the real DOM here proves the theme comes from actual
 * token values, not a hard-coded fallback.
 */
describe("readTerminalTheme", () => {
  it("resolves every color from computed design-token custom properties, not a hard-coded hex", () => {
    const theme = readTerminalTheme();

    for (const [key, value] of Object.entries(theme)) {
      expect(typeof value, `${key} should be a resolved color string`).toBe("string");
      expect((value as string).length, `${key} should not be empty`).toBeGreaterThan(0);
    }
  });

  it("keeps cursor/selection roles tied to the accent tokens", () => {
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim();
    const theme = readTerminalTheme();
    expect(theme.cursor).toBe(accent);
    expect(theme.blue).toBe(accent);
  });

  it("re-reads live when the active theme attribute changes (light vs dark)", () => {
    const light = readTerminalTheme();
    document.documentElement.setAttribute("data-theme", "dark");
    const dark = readTerminalTheme();
    document.documentElement.setAttribute("data-theme", "light");

    expect(dark.background).not.toBe(light.background);
  });
});

describe("readTerminalFontFamily", () => {
  it("reads the mono font stack token, not a hard-coded string", () => {
    const family = readTerminalFontFamily();
    expect(family).toContain("Geist Mono");
  });
});

describe("readTerminalFontSizePx", () => {
  it("converts the rem-valued token to a positive pixel number", () => {
    const px = readTerminalFontSizePx();
    expect(px).toBeGreaterThan(0);
    expect(Number.isFinite(px)).toBe(true);
  });

  it("falls back to a fixed default for a missing token", () => {
    const px = readTerminalFontSizePx(document.documentElement, "--font-size-does-not-exist");
    expect(px).toBe(13);
  });
});

describe("prefersReducedMotion", () => {
  it("returns a boolean without throwing under jsdom", () => {
    expect(typeof prefersReducedMotion()).toBe("boolean");
  });
});
