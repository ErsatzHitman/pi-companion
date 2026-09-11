/**
 * The S7 line-icon set (T349) — the design artifact's own SVG paths,
 * drawn with `react-native-svg`.
 *
 * `./icons.tsx` stays exactly as it is and keeps every caller it has.
 * That module is the Unicode-glyph set matching the web primitive
 * layer's `IconName` union (close/refresh/settings/copy) and is what
 * `IconButton` renders; this one is a different thing with a different
 * job. The S7 design (plan.md §10.2, and the redesign spec this task's
 * ledger section cites) draws its prompt-bar and transcript affordances
 * as stroked vector paths with specific stroke widths and line caps —
 * a plus at 2.2, a send arrow at 2.4, a microphone at 2, a filled
 * sparkle — none of which a font glyph can express, and all of which
 * the artifact specifies path-for-path. Rendering them as text glyphs
 * would be a different drawing at a different weight on every OEM font
 * fallback.
 *
 * Every icon is DECORATIVE. It carries `accessibilityElementsHidden`
 * and `importantForAccessibility="no-hide-descendants"`, exactly as
 * `./icons.tsx`'s `Icon` does, so the accessible name always comes from
 * the pressable that hosts it and never from the drawing (plan.md
 * §10.5).
 *
 * **Colour comes from the caller**, as a resolved token value, never a
 * literal here (plan.md §10.2 forbids raw hex product colours in
 * component code). The artifact's own CSS uses `currentColor` for every
 * one of these paths; React Native has no such cascade, so the `color`
 * prop is that inheritance made explicit.
 *
 * **Deliberately not in `testing.primitiveLabManifest`.** That manifest
 * is asserted by BOTH apps' component labs
 * (`apps/web/src/dev/component-lab.test.ts` and
 * `apps/android/src/dev/component-lab.test.ts`), so adding a name to it
 * obliges a web twin to exist. This set is Android-only until the web
 * app adopts the same S7 language; nothing asserts the reverse
 * direction, so the omission is a decision, not an oversight.
 */
import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * The artifact's icons, by the role each plays rather than by its
 * shape, so a later drawing change does not rename every call site.
 */
export type VectorIconName =
  | "plus"
  | "mic"
  | "send"
  | "sparkle"
  | "chevron-down"
  | "check"
  | "search"
  | "camera";

export interface VectorIconProps {
  name: VectorIconName;
  /** Rendered square edge, in dp. The artifact sizes each site itself. */
  size: number;
  /** A resolved token colour. Applied to the stroke, or the fill for `sparkle`. */
  color: string;
}

/**
 * The artifact draws every icon in a 24×24 viewBox and scales it at the
 * call site, so the paths below are its literal `d` attributes and the
 * stroke widths are its literal `stroke-width` values.
 */
const VIEW_BOX = "0 0 24 24";

function IconBody({ name, color }: { name: VectorIconName; color: string }) {
  switch (name) {
    case "plus":
      return <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.2} strokeLinecap="round" />;
    case "mic":
      return (
        <>
          <Rect
            x={9}
            y={2.5}
            width={6}
            height={11.5}
            rx={3}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.5M9 21h6"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "send":
      return (
        <Path
          d="M12 19V5M5.5 11.5 12 5l6.5 6.5"
          stroke={color}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "sparkle":
      // The one filled icon in the set — the thinking-row mark.
      return <Path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" fill={color} />;
    case "chevron-down":
      return (
        <Path
          d="M6 9l6 6 6-6"
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "check":
      return (
        <Path
          d="M4 12.5 9.5 18 20 6.5"
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "search":
      return (
        <>
          <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={2} strokeLinecap="round" />
          <Path d="M21 21l-4.3-4.3" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case "camera":
      // Not one of the artifact's own paths: the S7 frame draws no camera
      // mark, but the composer's capture control is a real, visible
      // control and a `📷` font glyph is a different drawing at a
      // different weight on every OEM fallback. Drawn in the same
      // language as the rest of this set — 24 viewBox, stroked, round
      // joins — so it sits beside them without looking imported.
      return (
        <>
          <Path
            d="M4 8h3l1.5-2.5h7L17 8h3a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 8z"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={12} cy={13} r={3.5} stroke={color} strokeWidth={2} strokeLinecap="round" />
        </>
      );
  }
}

export function VectorIcon({ name, size, color }: VectorIconProps) {
  return (
    <Svg
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      width={size}
      height={size}
      viewBox={VIEW_BOX}
      fill="none"
    >
      <IconBody name={name} color={color} />
    </Svg>
  );
}
