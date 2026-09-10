import { describe, expect, it } from "vitest";
import {
  getNativeElevation,
  getNativeMotion,
  getNativeTheme,
  getNativeTypography,
  nativeFontFamily,
  resolveNativeLineHeight,
} from "./native.js";
import { nativeFontFamilyNames } from "./tokens.js";

describe("getNativeTheme", () => {
  it("returns typed theme objects for each scheme and contrast level", () => {
    const light = getNativeTheme("light", false);
    const dark = getNativeTheme("dark", false);
    const lightHC = getNativeTheme("light", true);

    expect(light.scheme).toBe("light");
    expect(light.highContrast).toBe(false);
    expect(dark.colors.background).not.toBe(light.colors.background);
    expect(lightHC.highContrast).toBe(true);
    expect(lightHC.colors.textPrimary).not.toBe(light.colors.textPrimary);
  });

  it("includes spacing, radii, elevation, and breakpoints", () => {
    const theme = getNativeTheme("dark", false);
    expect(theme.spacing[4]).toBe(16);
    expect(theme.radii.md).toBeGreaterThan(0);
    expect(theme.elevation[2].elevation).toBeGreaterThan(0);
    expect(theme.breakpoints.wide).toBeGreaterThan(theme.breakpoints.compact);
  });

  it("includes Beautiful UI's ring-based shadow set (T13B)", () => {
    const theme = getNativeTheme("dark", false);
    expect(theme.shadows.hairline).toBe("0 0 0 1px #2e3033");
    expect(theme.shadows.card).toContain("0 0 0 1px");
  });
});

describe("getNativeElevation", () => {
  it("produces React Native shadow props for every level", () => {
    const elevationTokens = getNativeElevation();
    for (const level of [0, 1, 2, 3, 4] as const) {
      const shadow = elevationTokens[level];
      expect(shadow.shadowColor).toBe("#000000");
      expect(shadow.shadowOffset).toEqual({ width: 0, height: expect.any(Number) });
      expect(shadow.elevation).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("resolveNativeLineHeight", () => {
  it("converts a multiplier into an absolute pixel value", () => {
    expect(resolveNativeLineHeight(16, 1.5)).toBe(24);
  });
});

describe("getNativeTypography", () => {
  it("produces ready-to-use text style variants", () => {
    const typography = getNativeTypography();
    expect(typography.variant.body.fontSize).toBeGreaterThan(0);
    expect(typography.variant.body.lineHeight).toBeGreaterThan(typography.variant.body.fontSize);
    expect(typography.variant.code.fontFamily).toContain("Mono");
  });

  // T13C (docs/issues-from-plan.md): Android's `fontFamily` must resolve to
  // the exact name `expo-font` registered the bundled TTF under, not the
  // web CSS font stack — a mismatch here fails silently on-device (falls
  // back to a system face) rather than throwing, so this pins the literal
  // registered names rather than a loose substring match.
  it("resolves every variant's fontFamily to a nativeFontFamilyNames entry, never the raw CSS stack", () => {
    const typography = getNativeTypography();
    const known = new Set([
      ...Object.values(nativeFontFamilyNames.sans),
      ...Object.values(nativeFontFamilyNames.mono),
    ]);
    for (const variant of Object.values(typography.variant)) {
      expect(known.has(variant.fontFamily)).toBe(true);
      expect(variant.fontFamily).not.toContain(",");
      expect(variant.fontFamily).not.toContain('"Inter"');
    }
    expect(typography.variant.body.fontFamily).toBe(nativeFontFamilyNames.sans.regular);
    expect(typography.variant.label.fontFamily).toBe(nativeFontFamilyNames.sans.medium);
    expect(typography.variant.code.fontFamily).toBe(nativeFontFamilyNames.mono.regular);
  });

  it("exposes both bundled families through nativeFontFamily() for every weight", () => {
    for (const weight of ["regular", "medium", "semibold", "bold"] as const) {
      expect(nativeFontFamily("sans", weight)).toBe(nativeFontFamilyNames.sans[weight]);
      expect(nativeFontFamily("mono", weight)).toBe(nativeFontFamilyNames.mono[weight]);
      expect(nativeFontFamily("sans", weight)).toContain("Inter");
      expect(nativeFontFamily("mono", weight)).toContain("JetBrainsMono");
    }
  });
});

describe("getNativeMotion", () => {
  it("honors the reduce-motion flag", () => {
    const standard = getNativeMotion(false);
    const reduced = getNativeMotion(true);
    expect(standard.duration.base).toBeGreaterThan(reduced.duration.base);
  });

  it("exposes Beautiful UI's active:scale-[0.96] press feedback (T13B)", () => {
    expect(getNativeMotion(false).pressScale).toBe(0.96);
  });
});
