import type { NativeTheme } from "@picompanion/design-tokens";
import type { TextStyle } from "react-native";

/**
 * `NativeTypography` stores `fontWeight` as a plain string (design-tokens
 * has no React Native dependency and can't import RN's stricter
 * `TextStyle["fontWeight"]` union). This is the one place primitives cast
 * the token value into the RN style type React Native actually expects at
 * runtime — the same numeric-string values (`"400"`, `"700"`, ...) are
 * valid `fontWeight` values on Android.
 */
export function asFontWeight(value: string): TextStyle["fontWeight"] {
  return value as TextStyle["fontWeight"];
}

/**
 * Beautiful UI's ring-based shadow set (plan.md §10.2, docs/beautiful-ui-
 * reference.md "Shadows are rings, not blurs") is published as CSS
 * `box-shadow` strings on `theme.shadows`. React Native has no
 * `box-shadow`; T26C renders the same language as a themed 1px border
 * (`line` for a plain card, `line-strong` for a modal/overlay panel,
 * matching `--shadow-card` vs `--shadow-overlay`'s stronger ring) plus a
 * light native shadow/`elevation` for depth, instead of parsing the CSS
 * string.
 */
export function ringShadow(theme: NativeTheme, tier: "card" | "overlay") {
  const level = theme.elevation[tier === "overlay" ? 3 : 1];
  return {
    borderWidth: 1,
    borderColor: tier === "overlay" ? theme.colors["line-strong"] : theme.colors.line,
    shadowColor: level.shadowColor,
    shadowOffset: level.shadowOffset,
    shadowOpacity: level.shadowOpacity,
    shadowRadius: level.shadowRadius,
    elevation: level.elevation,
  };
}
