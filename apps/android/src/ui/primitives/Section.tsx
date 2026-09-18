import { resolveNativeLetterSpacing } from "@picompanion/design-tokens";
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
 * tracking, resolved against this size via `resolveNativeLetterSpacing`
 * — see the `letterSpacing` comment in `titleLabel` for why this element
 * resolves the raw `theme.typography.letterSpacing.wide` ratio itself
 * rather than reading `theme.typography.variant.label.letterSpacing`.
 *
 * (CORRECTED twice. First, at an earlier merge gate: a hardcoded `0.95`
 * dp guess was replaced with a bare, unscaled read of the theme's
 * `variant.label.letterSpacing` (then still the raw `0.09` em ratio,
 * since `native.ts` did not yet scale it), then multiplied by
 * `LABEL_FONT_SIZE` here to reach the correct `0.9` dp. Second, this
 * wave: `native.ts`'s `buildTypeStyle` now resolves every variant's own
 * `letterSpacing` into an absolute dp value internally, via the same
 * `resolveNativeLetterSpacing` helper, so `variant.label.letterSpacing`
 * is no longer that raw ratio — it is already dp, pre-scaled against
 * `label`'s own font size (11). Multiplying it by `LABEL_FONT_SIZE` here
 * would now double-scale it, so this element calls
 * `resolveNativeLetterSpacing` directly against the raw
 * `theme.typography.letterSpacing.wide` ratio and its own font size
 * instead.)
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
      // font size (`LABEL_FONT_SIZE`) via `resolveNativeLetterSpacing`
      // (packages/design-tokens/src/native.ts), the same helper
      // `buildTypeStyle` uses internally to scale every `variant.<name>.
      // letterSpacing` value against that variant's own font size.
      //
      // This label does NOT read `theme.typography.variant.label.
      // letterSpacing`: that value is pre-scaled against `label`'s own font
      // size (`typography.fontSize.sm` = 11), while this element renders at
      // `LABEL_FONT_SIZE` = 10, the size `.lbl` itself declares — spending
      // the pre-scaled variant value here would bind the tracking to the
      // wrong font size, ~10% off. `theme.typography.letterSpacing.wide` is
      // the raw, unscaled em ratio design-tokens exposes for exactly this —
      // a call site that overrides the font size away from a named variant.
      letterSpacing: resolveNativeLetterSpacing(
        LABEL_FONT_SIZE,
        theme.typography.letterSpacing.wide,
      ),
      paddingVertical: LABEL_PADDING_VERTICAL,
      paddingHorizontal: LABEL_PADDING_HORIZONTAL,
      textTransform: "uppercase",
    },
  });
}
