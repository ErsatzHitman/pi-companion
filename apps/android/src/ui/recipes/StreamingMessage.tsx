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

import {
  BLOCK_PADDING_HORIZONTAL,
  BLOCK_PADDING_VERTICAL,
  BLOCK_RADIUS,
  blockSurface,
} from "../theme/block-shape";
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

/** §7.2's caret width. See this component's doc comment for the phase the artifact has and this app does not. */
const CARET_WIDTH = 2;

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
 *
 * **T356: the turn is now the redesign's `.blk`** — the one block shape
 * the whole session screen draws in (`../theme/block-shape.ts`). A user
 * turn is `.usr` on `field`; the model's own prose is deliberately
 * UNFILLED, which is what `blockSurface("assistant")` returning `null`
 * means and why this file branches on it rather than picking a second
 * fill. The artifact boxes the user's prompts, the tool calls and the
 * extension elements precisely so the model's prose reads as the page
 * itself; filling it too would make the transcript a wall of boxes and
 * spend the contrast the boxes exist to create.
 *
 * The caret is 2px wide (§7.2), not the 8px block it used to be. §7.2
 * describes it as "solid while streaming then blinking", which belongs
 * to the artifact's character-by-character reveal: solid while the
 * reveal is behind the text, blinking once it catches up. Android
 * receives already-coalesced text and runs no reveal, so there is no
 * first phase to be solid during — the caret blinks for as long as the
 * turn is streaming, and that is stated here rather than faked with a
 * timer that would mean nothing.
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
  const surface = blockSurface(speaker === "user" ? "user" : "assistant");
  return StyleSheet.create({
    wrapper: {
      gap: theme.spacing[1],
      paddingVertical: BLOCK_PADDING_VERTICAL,
      paddingHorizontal: BLOCK_PADDING_HORIZONTAL,
      borderRadius: BLOCK_RADIUS,
      // `null` is the unfilled `assistant` case — see this file's own
      // T356 paragraph. `"transparent"` rather than `canvas` so the
      // block inherits whatever the transcript is drawn on.
      backgroundColor: surface === null ? "transparent" : theme.colors[surface],
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
    // §7.2's 2px caret. A rule, not a block: at 8px wide it read as a
    // highlight sitting after the text rather than as the place the
    // next character lands.
    cursor: {
      width: CARET_WIDTH,
      height: theme.typography.variant.body.lineHeight,
      marginLeft: theme.spacing[1],
      backgroundColor: theme.colors.accent,
    },
    caption: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default StreamingMessage;
