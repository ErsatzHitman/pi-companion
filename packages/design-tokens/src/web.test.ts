import { describe, expect, it } from "vitest";
import {
  cssVar,
  cssVarName,
  generateBaseCss,
  generateReducedMotionCss,
  generateThemeCss,
  wideBreakpointMediaQuery,
} from "./web.js";

describe("cssVarName / cssVar", () => {
  it("converts camelCase token names to kebab-case CSS custom properties", () => {
    expect(cssVarName("color-accentMuted")).toBe("--color-accent-muted");
    expect(cssVar("color-background")).toBe("var(--color-background)");
  });
});

describe("generateThemeCss", () => {
  const css = generateThemeCss();

  it("scopes light and dark theme colors by data-theme", () => {
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain('[data-theme="dark"]');
  });

  it("scopes high-contrast overrides by data-contrast", () => {
    expect(css).toContain('[data-theme="light"][data-contrast="high"]');
    expect(css).toContain('[data-theme="dark"][data-contrast="high"]');
  });

  it("emits a reduced-motion media query", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("emits base tokens under :root", () => {
    expect(css).toMatch(/:root \{[^}]*--font-size-base:/s);
    expect(css).toContain("--spacing-4:");
    expect(css).toContain("--radius-full:");
    expect(css).toContain("--elevation-1:");
    expect(css).toContain("--breakpoint-wide:");
  });

  it("only ever emits values through custom properties, not bare selectors", () => {
    for (const line of css.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "{" || trimmed === "}") continue;
      if (trimmed.endsWith("{")) continue;
      if (trimmed.startsWith("@media")) continue;
      expect(trimmed.startsWith("--")).toBe(true);
    }
  });
});

describe("generateThemeCss shadows (T13B)", () => {
  const css = generateThemeCss();

  it("emits Beautiful UI's ring-based shadow set per theme", () => {
    expect(css).toContain("--shadow-hairline:");
    expect(css).toContain("--shadow-btn:");
    expect(css).toContain("--shadow-card:");
    expect(css).toContain("--shadow-overlay:");
    expect(css).toContain("--shadow-inset-field:");
  });
});

describe("generateBaseCss / generateReducedMotionCss", () => {
  it("are independent, composable blocks", () => {
    expect(generateBaseCss()).toContain(":root");
    expect(generateReducedMotionCss()).toContain("--motion-duration-base: 1ms");
  });
});

describe("wideBreakpointMediaQuery", () => {
  it("matches the wide breakpoint token", () => {
    expect(wideBreakpointMediaQuery()).toBe("(min-width: 720px)");
  });
});
