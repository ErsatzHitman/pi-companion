import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface ThinkingSectionProps {
  summary: string;
  body: string;
  durationLabel: string;
  defaultExpanded?: boolean;
  testId?: string;
}

/**
 * ThinkingSection recipe (plan.md §10.4): a collapsible transcript block
 * for an assistant turn's reasoning. Built from a clean interaction
 * specification (a disclosure trigger controlling a labelled region) —
 * see the web recipe's doc comment and plan.md §10.1 — not copied code.
 *
 * Accessibility (plan.md §10.5): the trigger is a real `Pressable` with
 * `accessibilityRole="button"` and `accessibilityState.expanded`, so
 * TalkBack announces "collapsed"/"expanded" without relying on the
 * chevron glyph's rotation; the duration is always visible text. The
 * chevron rotation and body reveal both use the theme's reduced-motion
 * duration, collapsing to a near-instant snap when reduce motion is on.
 */
export function ThinkingSection({
  summary,
  body,
  durationLabel,
  defaultExpanded = false,
  testId,
}: ThinkingSectionProps) {
  const { theme, motion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const progress = useSharedValue(defaultExpanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: motion.duration.fast,
      easing: Easing.bezier(...motion.easing.standard),
    });
  }, [expanded, motion, progress]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 180}deg` }],
  }));

  return (
    <View style={styles.wrapper} testID={testId}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        hitSlop={4}
        style={styles.trigger}
      >
        <Animated.Text style={[styles.chevron, chevronStyle]} accessibilityElementsHidden>
          {"\u203a"}
        </Animated.Text>
        <Text style={styles.summary}>{summary}</Text>
        <Text style={styles.duration}>{durationLabel}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          <Text style={styles.bodyText}>{body}</Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { gap: theme.spacing[1] },
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      minHeight: 48,
    },
    chevron: { color: theme.colors["ink-3"], fontSize: theme.typography.variant.body.fontSize },
    summary: {
      flex: 1,
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    // Elapsed-time readout: Geist Mono with tabular figures (docs/
    // beautiful-ui-reference.md "mono elapsed-time readout").
    duration: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    body: {
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.line,
      paddingLeft: theme.spacing[3],
      paddingVertical: theme.spacing[1],
    },
    bodyText: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.bodySmall.fontSize,
      lineHeight: theme.typography.variant.bodySmall.lineHeight,
    },
  });
}

export default ThinkingSection;
