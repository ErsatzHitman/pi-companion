import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";

/**
 * Beautiful UI's shimmer-gradient text (docs/beautiful-ui-reference.md
 * "a moving `linear-gradient(90deg, ink-3 35%, ink 50%, ink-3 65%)`
 * clipped to text, 1.4s linear — used on 'Thinking' and 'Churning'").
 * React Native has no CSS `background-clip: text`; this reproduces the
 * same read — a live caption sweeping between `ink-3` and `ink` — as a
 * plain colour interpolation over the same 1.4s linear cycle instead.
 */
const SHIMMER_DURATION_MS = 1400;

export interface StreamingMessageProps {
  speaker: "assistant" | "user";
  text: string;
  streaming: boolean;
  testId?: string;
}

/**
 * StreamingMessage recipe (plan.md §10.4): a single transcript turn,
 * optionally still streaming. Clean-specification recipe (plan.md §10.1),
 * matching the web recipe's semantics.
 *
 * Accessibility (plan.md §10.5): the whole turn is one accessibility
 * element whose label already says "(responding)" while streaming, and a
 * visible "Pi is still responding" caption repeats that as on-screen text
 * (not just the blinking cursor) so the state survives without colour or
 * animation. The cursor pulse respects `reduceMotion` by staying static.
 */
export function StreamingMessage({ speaker, text, streaming, testId }: StreamingMessageProps) {
  const { theme, motion, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme, speaker), [theme, speaker]);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!streaming || reduceMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withTiming(0.2, {
        duration: motion.duration.slow,
        easing: Easing.bezier(...motion.easing.standard),
      }),
      -1,
      true,
    );
  }, [streaming, reduceMotion, motion, opacity]);

  const cursorStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const speakerLabel = speaker === "assistant" ? "Pi" : "You";

  const shimmer = useSharedValue(0);
  useEffect(() => {
    if (!streaming || reduceMotion) {
      shimmer.value = 0;
      return;
    }
    shimmer.value = withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION_MS, easing: Easing.linear }),
      -1,
      true,
    );
  }, [streaming, reduceMotion, shimmer]);
  const captionStyle = useAnimatedStyle(() => ({
    color: interpolateColor(shimmer.value, [0, 1], [theme.colors["ink-3"], theme.colors.ink]),
  }));

  return (
    <View
      style={styles.wrapper}
      accessible
      accessibilityLabel={`${speakerLabel}${streaming ? " (responding)" : ""}: ${text}`}
      testID={testId}
    >
      <Text style={styles.speaker}>{speakerLabel}</Text>
      <View style={styles.textRow}>
        <Text style={styles.text}>{text}</Text>
        {streaming ? (
          <Animated.View style={[styles.cursor, cursorStyle]} accessibilityElementsHidden />
        ) : null}
      </View>
      {streaming ? (
        <Animated.Text style={[styles.caption, reduceMotion ? null : captionStyle]}>
          Pi is still responding
        </Animated.Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"], speaker: "assistant" | "user") {
  return StyleSheet.create({
    wrapper: {
      gap: theme.spacing[1],
      padding: theme.spacing[3],
      borderRadius: theme.radii.control,
      backgroundColor: speaker === "assistant" ? theme.colors.canvas : theme.colors.surface,
      borderWidth: speaker === "user" ? 1 : 0,
      borderColor: theme.colors.line,
    },
    speaker: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    textRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" },
    text: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      lineHeight: theme.typography.variant.body.lineHeight,
    },
    cursor: {
      width: 8,
      height: 16,
      marginLeft: theme.spacing[1],
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radii.chip,
    },
    caption: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default StreamingMessage;
