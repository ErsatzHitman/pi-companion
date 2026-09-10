import { describe, expect, it } from "vitest";
import {
  breakpoints,
  darkHighContrastTheme,
  darkTheme,
  elevation,
  lightHighContrastTheme,
  lightTheme,
  motion,
  nativeFontFamilyNames,
  radii,
  reducedMotion,
  resolveMotion,
  resolveTheme,
  spacing,
  themes,
  typography,
} from "./tokens.js";

const HEX_RE = /^#[0-9a-f]{3,8}$/i;
const RGBA_RE = /^rgba?\(/;

function isColorValue(value: string): boolean {
  return HEX_RE.test(value) || RGBA_RE.test(value);
}

describe("themes", () => {
  it("provides light and dark themes", () => {
    expect(lightTheme.scheme).toBe("light");
    expect(darkTheme.scheme).toBe("dark");
    expect(lightTheme.colors.background).not.toBe(darkTheme.colors.background);
  });

  it("provides high-contrast variants for both schemes", () => {
    expect(lightHighContrastTheme.highContrast).toBe(true);
    expect(darkHighContrastTheme.highContrast).toBe(true);
    expect(lightHighContrastTheme.colors.textPrimary).not.toBe(lightTheme.colors.textPrimary);
    expect(darkHighContrastTheme.colors.borderStrong).not.toBe(darkTheme.colors.borderStrong);
  });

  it("resolves the correct theme via the accessibility hook", () => {
    expect(resolveTheme("light", false)).toBe(lightTheme);
    expect(resolveTheme("light", true)).toBe(lightHighContrastTheme);
    expect(resolveTheme("dark", false)).toBe(darkTheme);
    expect(resolveTheme("dark", true)).toBe(darkHighContrastTheme);
  });

  it("exposes every theme through the themes registry", () => {
    expect(themes.light.normal).toBe(lightTheme);
    expect(themes.dark.highContrast).toBe(darkHighContrastTheme);
  });

  it("every semantic color and status tone is a real color value", () => {
    for (const theme of [lightTheme, darkTheme, lightHighContrastTheme, darkHighContrastTheme]) {
      for (const [key, value] of Object.entries(theme.colors)) {
        if (key === "status" || key === "code") continue;
        expect(isColorValue(value as string), `${theme.scheme}.${key}`).toBe(true);
      }
      for (const tone of Object.values(theme.colors.status)) {
        for (const value of Object.values(tone)) {
          expect(isColorValue(value)).toBe(true);
        }
      }
    }
  });
});

describe("motion", () => {
  it("provides standard and reduced-motion tokens", () => {
    expect(motion.duration.base).toBeGreaterThan(0);
    expect(reducedMotion.duration.base).toBeLessThanOrEqual(1);
  });

  it("resolves motion via the accessibility hook", () => {
    expect(resolveMotion(false)).toBe(motion);
    expect(resolveMotion(true)).toBe(reducedMotion);
  });
});

describe("scales", () => {
  it("defines typography, spacing, radii, elevation, and breakpoints", () => {
    expect(typography.fontSize.base).toBeGreaterThan(0);
    expect(spacing[4]).toBe(16);
    expect(radii.full).toBeGreaterThan(9000);
    expect(elevation[0].opacity).toBe(0);
    expect(elevation[4].opacity).toBeGreaterThan(elevation[1].opacity);
    expect(breakpoints.wide).toBeGreaterThan(breakpoints.compact);
  });
});

// T13B (docs/beautiful-ui-reference.md): the design system carries Beautiful
// UI's semantic structure and exact values, both themes.
describe("Beautiful UI conformance (T13B)", () => {
  it("carries the exact dark-theme surface stack and line values", () => {
    expect(darkTheme.colors.page).toBe("#17181a");
    expect(darkTheme.colors.canvas).toBe("#1c1d1f");
    expect(darkTheme.colors.surface).toBe("#232427");
    expect(darkTheme.colors.inset).toBe("#1f2022");
    expect(darkTheme.colors.field).toBe("#2b2c2f");
    expect(darkTheme.colors.ink).toBe("#f2f3f4");
    expect(darkTheme.colors["ink-2"]).toBe("#a5a8ad");
    expect(darkTheme.colors.line).toBe("#2e3033");
    expect(darkTheme.colors["line-strong"]).toBe("#3a3c40");
    expect(darkTheme.colors["line-soft"]).toBe("#27282b");
    expect(darkTheme.colors.green).toBe("#3cbb72");
    expect(darkTheme.colors.orange).toBe("#f68f3c");
  });

  it("carries the exact light-theme surface stack and line values", () => {
    expect(lightTheme.colors.page).toBe("#fafafb");
    expect(lightTheme.colors.canvas).toBe("#f1f2f3");
    expect(lightTheme.colors.surface).toBe("#ffffff");
    expect(lightTheme.colors.inset).toBe("#f7f8f9");
    expect(lightTheme.colors.field).toBe("#f2f2f3");
    expect(lightTheme.colors.ink).toBe("#1f2124");
    expect(lightTheme.colors["ink-2"]).toBe("#62656b");
    expect(lightTheme.colors.line).toBe("#ecedef");
    expect(lightTheme.colors["line-strong"]).toBe("#e0e2e5");
  });

  // T54A1 (docs/beautiful-ui-reference.md "WCAG AA contrast pass (T54A1)"):
  // `ink-3`, `accent`, `accent-ink`, `green`, `orange`, and `red` were
  // deliberately darkened/lightened off Beautiful UI's byte-exact published
  // hex, per the user's 2026-09-03 "accessibility wins" decision. This test
  // pins the deviation so nobody reverts it back to the published (failing)
  // figures believing it restores fidelity; the WCAG suite below is what
  // actually guards the contrast property.
  it("deliberately deviates six roles off the published Beautiful UI hex for WCAG AA (T54A1)", () => {
    expect(darkTheme.colors["ink-3"]).toBe("#92959b");
    expect(darkTheme.colors.accent).toBe("#4da3ff");
    expect(darkTheme.colors.red).toBe("#f17579");
    expect(lightTheme.colors["ink-3"]).toBe("#6b6f76");
    expect(lightTheme.colors.accent).toBe("#006dd3");
    expect(lightTheme.colors["accent-ink"]).toBe("#005aaf");
    expect(lightTheme.colors.green).toBe("#157f40");
    expect(lightTheme.colors.orange).toBe("#b1540a");
    expect(lightTheme.colors.red).toBe("#d52026");
  });

  it("exposes chip/control/card/window radii at 6/8/10/14", () => {
    expect(radii.chip).toBe(6);
    expect(radii.control).toBe(8);
    expect(radii.card).toBe(10);
    expect(radii.window).toBe(14);
    expect(radii.full).toBeGreaterThan(9000);
  });

  it("exposes a ring-based shadow set per theme, with the hairline workhorse", () => {
    expect(darkTheme.shadows.hairline).toBe("0 0 0 1px #2e3033");
    expect(lightTheme.shadows.hairline).toBe("0 0 0 1px #ecedef");
    for (const theme of [darkTheme, lightTheme]) {
      expect(theme.shadows.hairline).toMatch(/^0 0 0 1px /);
      expect(theme.shadows.btn).not.toMatch(/blur/);
      expect(theme.shadows.card).toContain("0 0 0 1px");
      expect(theme.shadows.overlay).toContain("0 0 0 1px");
      expect(theme.shadows.insetField).toContain("inset");
    }
  });

  it("uses Inter and Geist Mono on the web, JetBrains Mono on Android (T345)", () => {
    expect(typography.fontFamily.sans).toContain("Inter");
    expect(typography.fontFamily.mono).toContain("Geist Mono");
    expect(nativeFontFamilyNames.sans.regular).toContain("Inter");
    expect(nativeFontFamilyNames.mono.regular).toContain("JetBrainsMono");
  });

  it("names the S7 Pi roles in both themes (T345)", () => {
    for (const theme of [darkTheme, lightTheme]) {
      for (const role of [
        "purple",
        "teal",
        "tool-success-bg",
        "tool-error-bg",
        "extension-bg",
        "accent-highlight",
      ] as const) {
        expect(theme.colors[role], role).toMatch(/^(#[0-9a-f]{6}|rgba\()/);
      }
    }
    expect(darkTheme.colors.purple).not.toBe(lightTheme.colors.purple);
    expect(darkTheme.colors["extension-bg"]).not.toBe(lightTheme.colors["extension-bg"]);
  });

  it("runs a small type scale, with the 21px/600 page heading and -0.02em tracking", () => {
    expect(typography.fontSize.xs).toBe(10.5);
    expect(typography.fontSize.lg).toBe(13);
    expect(typography.fontSize["4xl"]).toBe(21);
    expect(typography.fontWeight.semibold).toBe(600);
    expect(typography.letterSpacing.tight).toBe(-0.02);
    expect(typography.lineHeight.relaxed).toBe(1.625);
  });

  it("carries the signature easing family and durations", () => {
    expect(motion.easing.easeOutStrong).toEqual([0.23, 1, 0.32, 1]);
    expect(motion.easing.easeInOutStrong).toEqual([0.77, 0, 0.175, 1]);
    expect(motion.easing.link).toEqual([0.16, 1, 0.3, 1]);
    expect(motion.duration.fast).toBe(100);
    expect(motion.duration.base).toBe(150);
    expect(motion.duration.slow).toBe(300);
    expect(motion.duration.slower).toBe(400);
    expect(motion.duration.entrance).toBe(600);
    expect(motion.pressScale).toBe(0.96);
  });

  // T13C (docs/beautiful-ui-reference.md "Light theme" table, now
  // publishing every role for both themes): replaces the T13B
  // approximations for hover/hover-2/line-soft/accent-ink/every *-tint,
  // tooltip-*, stripe, stripe-bg, and adds the `raised` shadow role that
  // was missing entirely.
  it("carries the exact recovered light-theme roles (T13C), not approximations", () => {
    expect(lightTheme.colors.hover).toBe("#f4f5f6");
    expect(lightTheme.colors["hover-2"]).toBe("#e7e9eb");
    expect(lightTheme.colors["line-soft"]).toBe("#f3f4f5");
    // accent-ink's published figure (#0070dd) was darkened by T54A1 for
    // WCAG AA; see the dedicated deviation test above.
    expect(lightTheme.colors["accent-tint"]).toBe("#e9f3ff");
    expect(lightTheme.colors["green-tint"]).toBe("#e8f5ed");
    expect(lightTheme.colors["orange-tint"]).toBe("#fdf1e5");
    expect(lightTheme.colors["red-tint"]).toBe("#fcecec");
    expect(lightTheme.colors["tooltip-bg"]).toBe("#25272b");
    expect(lightTheme.colors["tooltip-fg"]).toBe("#f6f7f8");
    expect(lightTheme.colors["tooltip-muted"]).toBe("#a5a8ad");
    expect(lightTheme.colors["tooltip-border"]).toBe("#3a3c40");
    expect(lightTheme.colors["stripe-bg"]).toBe("#f5f5f5");
    expect(lightTheme.colors.stripe).toMatch(RGBA_RE);
  });

  it("carries the light theme's near-white solid tints, not dark's alpha overlays", () => {
    // Structural rule (docs/beautiful-ui-reference.md): light tints are
    // near-white *solid* fills; dark tints are alpha overlays of their own
    // hue. Asserts the light values are opaque hex, and the dark values
    // remain rgba alpha overlays, so light was never mechanically mirrored
    // from dark's construction.
    for (const tint of ["accent-tint", "green-tint", "orange-tint", "red-tint"] as const) {
      expect(lightTheme.colors[tint]).toMatch(HEX_RE);
      expect(darkTheme.colors[tint]).toMatch(RGBA_RE);
    }
  });

  it("carries the missing dark-theme tooltip/stripe-bg roles (T13C)", () => {
    expect(darkTheme.colors["tooltip-fg"]).toBe("#f2f3f4");
    expect(darkTheme.colors["tooltip-muted"]).toBe("#a5a8ad");
    expect(darkTheme.colors["tooltip-border"]).toBe("#2e3033");
    expect(darkTheme.colors["stripe-bg"]).toBe("#1b1c1e");
  });

  it("exposes a raised shadow role, both themes (T13C)", () => {
    expect(darkTheme.shadows.raised).toBe(
      "0 0 0 1px rgba(255, 255, 255, 0.13), 0 2px 10px rgba(0, 0, 0, 0.22)",
    );
    expect(lightTheme.shadows.raised).toContain("0 0 0 1px");
    expect(lightTheme.shadows.raised).not.toBe(lightTheme.shadows.card);
  });

  it("keeps legacy semantic roles compiling, mapped onto the new fields", () => {
    expect(darkTheme.colors.background).toBe(darkTheme.colors.page);
    expect(darkTheme.colors.textPrimary).toBe(darkTheme.colors.ink);
    expect(darkTheme.colors.border).toBe(darkTheme.colors.line);
    expect(darkTheme.colors.accent).toBe(darkTheme.colors.accent);
    expect(lightTheme.colors.background).toBe(lightTheme.colors.page);
    expect(lightTheme.colors.textPrimary).toBe(lightTheme.colors.ink);
    expect(lightTheme.colors.border).toBe(lightTheme.colors.line);
  });
});
