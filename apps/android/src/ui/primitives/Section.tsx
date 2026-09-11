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

/** The artifact's `.lbl`: 9.5px, uppercase, with its tracking in dp at that size. */
const LABEL_FONT_SIZE = 9.5;
const LABEL_LETTER_SPACING = 0.95;
/** The artifact's `.lbl { padding: 8px 2px 0 }`. */
const LABEL_PADDING_TOP = 8;

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
      fontWeight: asFontWeight(theme.typography.fontWeight.bold),
      letterSpacing: LABEL_LETTER_SPACING,
      paddingTop: LABEL_PADDING_TOP,
      textTransform: "uppercase",
    },
  });
}
