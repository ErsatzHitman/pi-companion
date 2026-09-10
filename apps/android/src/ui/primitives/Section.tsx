import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

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
}

/**
 * Section primitive (plan.md §10.3): a labelled grouping. Native TalkBack
 * has no `aria-labelledby` grouping equivalent, so this exposes the
 * heading as `accessibilityRole="header"` and wraps the group with
 * `accessible={false}`/`accessibilityRole="none"` at the container so the
 * heading still reads standalone (plan.md §10.5 "screen-reader role and
 * state").
 */
export function Section({ title, children, testId, style }: SectionProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.section, style]} testID={testId}>
      <Text accessibilityRole="header" style={styles.title}>
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
  });
}
