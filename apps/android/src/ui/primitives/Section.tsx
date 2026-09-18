import { useMemo, type ReactNode } from "react";
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

/**
 * How the heading is drawn (T366).
 *
 * `"heading"` is the original: a full-size, ink-coloured title for a
 * screen's major divisions.
 *
 * `"label"` is the redesign's `.lbl` (`HANDOFF.md` §7.3, §7.5): a small
 * uppercase mono line in `ink-3`, used where the grouping is a quiet
 * index over a list — the Sessions screen's status groups, the Settings
 * screen's host/defaults/extensions labels. It changes the drawing
 * only: the heading is still one `accessibilityRole="header"` node with
 * the same text, and `textTransform` is a visual transform a screen
 * reader does not speak, so the announced name stays the string the
 * caller passed.
 */
export type SectionVariant = "heading" | "label";

export interface SectionProps {
  title: string;
  children: ReactNode;
  testId?: string;
  /**
   * Extra container style, merged after the primitive's own (T338:
   * `Composer.tsx` makes its section shrinkable so the scrolling controls
   * inside it give way to the pinned prompt bar). Never replaces `gap`
   * or the heading — those are the primitive's contract.
   */
  style?: StyleProp<ViewStyle>;
  /** Layout of the heading text alone (T344: `Composer.tsx` sums it with its prompt bar to reserve their height). */
  onTitleLayout?: (event: LayoutChangeEvent) => void;
  /** Defaults to `"heading"`; see `SectionVariant`. */
  variant?: SectionVariant;
}

/**
 * The artifact's `.lbl{font:500 10px/1 'JetBrains Mono',monospace;
 * letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);
 * padding:2px 4px}`, measured directly against the confirmed spec. An
 * earlier `9.5px` at `fontWeight.bold` and a `paddingTop`-only 8 matched
 * no rule there. Weight 500 comes from the theme below; so does the
 * tracking, scaled — see the `letterSpacing` comment in `titleLabel`.
 *
 * (CORRECTED, at the wave's merge gate: an earlier revision of this
 * paragraph listed the previous `hardcoded 0.95 letter-spacing` beside
 * those two as a third value that "matched no rule there", and the
 * change that landed replaced it with an unscaled read of the theme's
 * `variant.label.letterSpacing`. That was backwards. `.09em` on this
 * 10px font IS 0.9dp, so `0.95` was very nearly right and the unscaled
 * token, at 0.09dp, was 10x too tight.)
 */
const LABEL_FONT_SIZE = 10;
/** `.lbl`'s `10px/1` — line-height equal to the font size. */
const LABEL_LINE_HEIGHT = LABEL_FONT_SIZE;
const LABEL_PADDING_VERTICAL = 2;
const LABEL_PADDING_HORIZONTAL = 4;

/**
 * Section primitive (plan.md §10.3): a labelled grouping. Native TalkBack
 * has no `aria-labelledby` grouping equivalent, so this exposes the
 * heading as `accessibilityRole="header"` and wraps the group with
 * `accessible={false}`/`accessibilityRole="none"` at the container so the
 * heading still reads standalone (plan.md §10.5 "screen-reader role and
 * state").
 */
export function Section({
  title,
  children,
  testId,
  style,
  onTitleLayout,
  variant = "heading",
}: SectionProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.section, style]} testID={testId}>
      <Text
        accessibilityRole="header"
        style={[styles.title, variant === "label" ? styles.titleLabel : null]}
        onLayout={onTitleLayout}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    section: { gap: theme.spacing[3] },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.heading.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.heading.fontWeight),
    },
    titleLabel: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: LABEL_FONT_SIZE,
      lineHeight: LABEL_LINE_HEIGHT,
      fontWeight: asFontWeight(theme.typography.fontWeight.medium),
      // `.lbl`'s `letter-spacing:.09em`, resolved against this element's own
      // font size because React Native's `letterSpacing` is absolute dp, not
      // a ratio.
      //
      // `NativeTypography` (packages/design-tokens/src/native.ts) exposes no
      // top-level `letterSpacing` map — only `variant.<name>.letterSpacing` —
      // and `variant.label` carries `typography.letterSpacing.wide` UNSCALED.
      // That token is an em RATIO: `web.ts`'s token emitter writes it as
      // `${value}em`, and `.lbl` is `.09em` on a `10px` font, i.e. 0.9dp.
      // Spending `variant.label.letterSpacing` directly therefore tracks at
      // 0.09dp — 10x too tight, visually none — so it is multiplied here.
      // `buildTypeStyle` already does the matching conversion for the other
      // relative token in the same struct via `resolveNativeLineHeight`
      // (`fontSize * multiplier`); it has no `letterSpacing` counterpart, so
      // every `variant.<name>.letterSpacing` consumer on this surface carries
      // the same 1/fontSize error. Fixing that belongs in design-tokens, not
      // in this primitive.
      letterSpacing: theme.typography.variant.label.letterSpacing * LABEL_FONT_SIZE,
      paddingVertical: LABEL_PADDING_VERTICAL,
      paddingHorizontal: LABEL_PADDING_HORIZONTAL,
      textTransform: "uppercase",
    },
  });
}
