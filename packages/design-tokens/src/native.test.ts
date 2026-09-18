import { describe, expect, it } from "vitest";
import {
  getNativeElevation,
  getNativeMotion,
  getNativeTheme,
  getNativeTypography,
  nativeFontFamily,
  resolveNativeLetterSpacing,
  resolveNativeLineHeight,
} from "./native.js";
import { nativeFontFamilyNames, typography } from "./tokens.js";

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

describe("resolveNativeLetterSpacing", () => {
  it("converts an em ratio into an absolute dp value by multiplying against the font size", () => {
    expect(resolveNativeLetterSpacing(10, 0.09)).toBeCloseTo(0.9, 10);
    expect(resolveNativeLetterSpacing(21, -0.02)).toBeCloseTo(-0.42, 10);
    expect(resolveNativeLetterSpacing(12.5, 0)).toBe(0);
  });

  it("does not round, unlike resolveNativeLineHeight, so a sub-pixel result survives", () => {
    // `tokens.ts`'s own `wide` ratio (0.09) against a sub-12px font size
    // produces a sub-pixel dp value; rounding would collapse it to 1 (or
    // to 0 for `tight`'s negative ratio at these sizes) and destroy the
    // only variation this helper exists to produce.
    const result = resolveNativeLetterSpacing(10, 0.09);
    expect(result).toBeCloseTo(0.9, 10);
    expect(Number.isInteger(result)).toBe(false);
    // `Math.round`, which `resolveNativeLineHeight` uses, would collapse
    // this same input to 1 — confirming the two helpers genuinely differ,
    // not just asserting this one doesn't call `Math.round` by name.
    expect(Math.round(result)).toBe(1);
    expect(Math.round(result)).not.toBe(result);
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

  it("scales every variant's letterSpacing against that variant's own font size, not the bare em ratio", () => {
    const typo = getNativeTypography();
    // `label` (`wide`, 0.09) is built at `typography.fontSize.sm` (11):
    // the bare token is no longer what `variant.label.letterSpacing` holds.
    expect(typo.variant.label.letterSpacing).not.toBe(typography.letterSpacing.wide);
    expect(typo.variant.label.letterSpacing).toBe(
      resolveNativeLetterSpacing(typography.fontSize.sm, typography.letterSpacing.wide),
    );
    // `display` and `title` (`tight`, -0.02) are the other two non-zero
    // roles; each variant's own font size scales its result differently.
    expect(typo.variant.display.letterSpacing).not.toBe(typography.letterSpacing.tight);
    expect(typo.variant.display.letterSpacing).toBe(
      resolveNativeLetterSpacing(typography.fontSize["4xl"], typography.letterSpacing.tight),
    );
    expect(typo.variant.title.letterSpacing).toBe(
      resolveNativeLetterSpacing(typography.fontSize["2xl"], typography.letterSpacing.tight),
    );
    expect(typo.variant.display.letterSpacing).not.toBe(typo.variant.title.letterSpacing);
    // The other five variants take `normal` (0 em): 0 times any font size
    // is still 0, so scaling changes nothing for them.
    for (const name of ["heading", "body", "bodySmall", "caption", "code"] as const) {
      expect(typo.variant[name].letterSpacing).toBe(0);
    }
  });

  it("exposes the raw, unresolved em-ratio map for a call site that overrides the font size", () => {
    const typo = getNativeTypography();
    expect(typo.letterSpacing).toEqual(typography.letterSpacing);
    expect(typo.letterSpacing.wide).toBe(0.09);
    expect(typo.letterSpacing.tight).toBe(-0.02);
    expect(typo.letterSpacing.normal).toBe(0);
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
