import { Text, type TextStyle } from "react-native";

/**
 * Minimal glyph set for `IconButton`/`Chip` (plan.md §10.3), matching the
 * web primitive layer's `IconName` union. React Native has no bundled SVG
 * renderer here (no `react-native-svg` dependency), so this uses plain
 * Unicode glyphs instead of hand-drawn paths — same "no icon-library
 * dependency" intent as the web primitive, adapted to what the platform
 * has for free. Icons are always decorative: the accessible name lives on
 * the button that hosts them (`IconButton.accessibleName`, `Chip`'s
 * "Remove <label>"), never on the glyph itself.
 */
export type IconName = "close" | "refresh" | "settings" | "copy";

const glyphs: Record<IconName, string> = {
  close: "\u2715",
  refresh: "\u21bb",
  settings: "\u2699",
  copy: "\u29c9",
};

export function Icon({ name, style }: { name: IconName; style?: TextStyle }) {
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={style}>
      {glyphs[name]}
    </Text>
  );
}
