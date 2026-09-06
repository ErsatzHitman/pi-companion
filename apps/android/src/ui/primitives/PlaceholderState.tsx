import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

export interface PlaceholderStateProps {
  title: string;
  description: string;
  testId?: string;
}

/**
 * EmptyState primitive (plan.md §10.3): a neutral "nothing here yet"
 * placeholder. No live-region announcement (nothing changed).
 */
export function EmptyState({ title, description, testId }: PlaceholderStateProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.wrapper} testID={testId}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

/**
 * ErrorState primitive (plan.md §10.3): `accessibilityLiveRegion="assertive"`
 * so TalkBack announces the failure as soon as it renders, plus visible
 * (non-colour) error text (plan.md §10.5).
 */
export function ErrorState({ title, description, testId }: PlaceholderStateProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View
      style={styles.wrapper}
      accessible
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`${title}. ${description}`}
      testID={testId}
    >
      <Text style={[styles.title, { color: theme.colors.status.danger.foreground }]}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

/**
 * LoadingState primitive (plan.md §10.3): `accessibilityLiveRegion="polite"`
 * with visible "Loading…" text and a spinner that collapses to a static
 * dot when `reduceMotion` is on (plan.md §10.5).
 */
export function LoadingState({ title, description, testId }: PlaceholderStateProps) {
  const { theme, motion, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const rotation = useSharedValue(0);

  if (!reduceMotion) {
    rotation.value = withRepeat(
      withTiming(1, { duration: motion.duration.slower * 2, easing: Easing.linear }),
      -1,
      false,
    );
  }

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 360}deg` }],
  }));

  return (
    <View
      style={styles.wrapper}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${title}. ${description}`}
      testID={testId}
    >
      <Animated.View
        style={[styles.spinner, reduceMotion ? null : spinStyle]}
        accessibilityElementsHidden
      />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { alignItems: "center", gap: theme.spacing[2], padding: theme.spacing[6] },
    spinner: {
      width: 24,
      height: 24,
      borderRadius: theme.radii.full,
      borderWidth: 3,
      borderColor: theme.colors["line-strong"],
      borderTopColor: theme.colors.accent,
    },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.heading.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.heading.fontWeight),
      textAlign: "center",
    },
    description: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.body.fontSize,
      textAlign: "center",
    },
  });
}
