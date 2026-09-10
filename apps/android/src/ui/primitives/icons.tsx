import { Text, type TextStyle } from "react-native";

/**
 * Minimal glyph set for `IconButton`/`Chip` (plan.md §10.3), matching the
 * web primitive layer's `IconName` union. These four stay Unicode glyphs:
 * they exist to mirror that union one-for-one, and a glyph is the whole
 * point — same "no icon-library dependency" intent as the web primitive,
 * adapted to what the platform has for free. Icons are always decorative:
 * the accessible name lives on the button that hosts them
 * (`IconButton.accessibleName`, `Chip`'s "Remove <label>"), never on the
 * glyph itself.
 *
 * CORRECTED (T349): this said "React Native has no bundled SVG renderer
 * here (no `react-native-svg` dependency)". T349 added that dependency and
 * `./vector-icons.tsx`'s `VectorIcon`, so the S7 design's stroked paths
 * are drawn as real vectors. The choice above is now a deliberate split,
 * not a platform limit: see that module's doc comment for which set to
 * reach for.
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
