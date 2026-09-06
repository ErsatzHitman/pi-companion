/**
 * @picompanion/design-tokens — native (Android) output (plan.md §10.2, §6).
 *
 * Converts the token source of truth into plain, typed objects consumable
 * from Expo/React Native `StyleSheet`s and Reanimated without importing any
 * React Native APIs from this package itself.
 */

import {
  type BreakpointTokens,
  type ColorScheme,
  type ColorTokens,
  type MotionTokens,
  type NativeFontWeightKey,
  type RadiiTokens,
  type ShadowTokens,
  type SpacingTokens,
  type TypographyTokens,
  elevation,
  motion,
  nativeFontFamilyNames,
  reducedMotion,
  resolveTheme,
  typography,
} from "./tokens.js";

/**
 * Resolves a `(family, weight)` pair to the exact font-family name the
 * bundled TTF is registered under via `expo-font` (T13C). This is the
 * Android-specific counterpart to `typography.fontFamily[family]`'s CSS
 * font stack: React Native's `fontFamily` style prop takes exactly one
 * name, resolved by exact string match against whatever `useFonts()`
 * registered, so passing the CSS stack (a quoted, comma-separated string)
 * would silently fail to match any registered font and fall back to the
 * system face — the specific Android-only bug T13C's gap analysis called
 * out ("a missing family fails differently from web, so verify the
 * registered name, not just the token string"). `apps/android`'s font
 * loader (`src/ui/theme/fonts.ts`) must register its assets under exactly
 * `nativeFontFamilyNames`'s values for this to resolve to a real bundled
 * glyph instead of a silent system-font fallback.
 */
export function nativeFontFamily(family: "sans" | "mono", weight: NativeFontWeightKey): string {
  return nativeFontFamilyNames[family][weight];
}

export interface NativeShadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  /** Android-only `elevation` prop; ignored on other RN platforms. */
  elevation: number;
}

export type NativeElevationTokens = Record<0 | 1 | 2 | 3 | 4, NativeShadow>;

/** React Native shadow props for every elevation level, keyed 0-4. */
export function getNativeElevation(): NativeElevationTokens {
  const out = {} as NativeElevationTokens;
  for (const key of [0, 1, 2, 3, 4] as const) {
    const level = elevation[key];
    out[key] = {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: level.offsetY },
      shadowOpacity: level.opacity,
      shadowRadius: level.blurRadius,
      elevation: level.androidElevation,
    };
  }
  return out;
}

export interface NativeTypeStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  letterSpacing: number;
}

/**
 * React Native's `lineHeight` is an absolute pixel value, not a multiplier
 * like CSS. This resolves a token line-height multiplier against a font
 * size into the absolute value RN expects.
 */
export function resolveNativeLineHeight(fontSize: number, lineHeightMultiplier: number): number {
  return Math.round(fontSize * lineHeightMultiplier);
}

export interface NativeTypography {
  fontFamily: TypographyTokens["fontFamily"];
  fontWeight: Record<keyof TypographyTokens["fontWeight"], string>;
  /** Ready-to-spread text styles for common roles. */
  variant: {
    body: NativeTypeStyle;
    bodySmall: NativeTypeStyle;
    caption: NativeTypeStyle;
    label: NativeTypeStyle;
    heading: NativeTypeStyle;
    title: NativeTypeStyle;
    display: NativeTypeStyle;
    code: NativeTypeStyle;
  };
}

function buildTypeStyle(
  tokens: TypographyTokens,
  family: "sans" | "mono",
  fontSize: number,
  weight: keyof TypographyTokens["fontWeight"],
  lineHeight: number,
  letterSpacing: number,
): NativeTypeStyle {
  return {
    fontFamily: nativeFontFamily(family, weight),
    fontSize,
    fontWeight: String(tokens.fontWeight[weight]),
    lineHeight: resolveNativeLineHeight(fontSize, lineHeight),
    letterSpacing,
  };
}

export function getNativeTypography(): NativeTypography {
  return {
    fontFamily: typography.fontFamily,
    fontWeight: {
      regular: String(typography.fontWeight.regular),
      medium: String(typography.fontWeight.medium),
      semibold: String(typography.fontWeight.semibold),
      bold: String(typography.fontWeight.bold),
    },
    variant: {
      display: buildTypeStyle(
        typography,
        "sans",
        typography.fontSize["4xl"],
        "bold",
        typography.lineHeight.tight,
        typography.letterSpacing.tight,
      ),
      title: buildTypeStyle(
        typography,
        "sans",
        typography.fontSize["2xl"],
        "semibold",
        typography.lineHeight.tight,
        typography.letterSpacing.tight,
      ),
      heading: buildTypeStyle(
        typography,
        "sans",
        typography.fontSize.xl,
        "semibold",
        typography.lineHeight.snug,
        typography.letterSpacing.normal,
      ),
      body: buildTypeStyle(
        typography,
        "sans",
        typography.fontSize.base,
        "regular",
        typography.lineHeight.normal,
        typography.letterSpacing.normal,
      ),
      bodySmall: buildTypeStyle(
        typography,
        "sans",
        typography.fontSize.sm,
        "regular",
        typography.lineHeight.normal,
        typography.letterSpacing.normal,
      ),
      label: buildTypeStyle(
        typography,
        "sans",
        typography.fontSize.sm,
        "medium",
        typography.lineHeight.snug,
        typography.letterSpacing.wide,
      ),
      caption: buildTypeStyle(
        typography,
        "sans",
        typography.fontSize.xs,
        "regular",
        typography.lineHeight.normal,
        typography.letterSpacing.normal,
      ),
      code: buildTypeStyle(
        typography,
        "mono",
        typography.fontSize.sm,
        "regular",
        typography.lineHeight.relaxed,
        typography.letterSpacing.normal,
      ),
    },
  };
}

export interface NativeMotion {
  duration: MotionTokens["duration"];
  /** Cubic-bezier control points; pass to `Easing.bezier(...)` in Reanimated. */
  easing: MotionTokens["easing"];
  /** Beautiful UI's `active:scale-[0.96]` control press feedback. */
  pressScale: number;
}

/** Motion tokens for Android, honoring the device's reduce-motion setting. */
export function getNativeMotion(reduceMotion: boolean): NativeMotion {
  const tokens = reduceMotion ? reducedMotion : motion;
  return { duration: tokens.duration, easing: tokens.easing, pressScale: tokens.pressScale };
}

export interface NativeTheme {
  scheme: ColorScheme;
  highContrast: boolean;
  colors: ColorTokens;
  typography: NativeTypography;
  spacing: SpacingTokens;
  radii: RadiiTokens;
  elevation: NativeElevationTokens;
  /**
   * Beautiful UI's ring-based shadow set (plan §10.2), as CSS-shadow-syntax
   * strings. Android has no `box-shadow`; T26C renders these as 1px borders
   * plus RN's `elevation`/`shadow*` props rather than parsing the string.
   */
  shadows: ShadowTokens;
  breakpoints: BreakpointTokens;
}

/**
 * Full typed theme object for Android. Accessibility hook: pass the
 * platform's color scheme and `AccessibilityInfo`/high-contrast signal
 * straight through.
 */
export function getNativeTheme(scheme: ColorScheme, highContrast: boolean): NativeTheme {
  const theme = resolveTheme(scheme, highContrast);
  return {
    scheme: theme.scheme,
    highContrast: theme.highContrast,
    colors: theme.colors,
    typography: getNativeTypography(),
    spacing: theme.spacing,
    radii: theme.radii,
    elevation: getNativeElevation(),
    shadows: theme.shadows,
    breakpoints: theme.breakpoints,
  };
}
