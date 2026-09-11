import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { VectorIcon } from "../primitives/vector-icons";
import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { ShimmerText } from "./ShimmerText";

export interface ThinkingSectionProps {
  /**
   * The head's own visible words — "Thinking" while live, "Thought for
   * N seconds" once settled (T357). The caller builds it; this recipe
   * has no clock. See `features/transcript/thinking-row-model.ts`'s
   * `thinkingHeadline`.
   */
  headline: string;
  /** The announced label for the disclosure. Richer than `headline`: it carries a preview of the reasoning itself. */
  summary: string;
  body: string;
  durationLabel: string;
  /**
   * `true` to shimmer the head. Named for the treatment, not for the
   * state, because the caller — not this recipe — owns the decision:
   * `features/transcript/thinking-row-model.ts`'s
   * `shouldAnimateShimmer(live, reduceMotion)` is the tested gate, and
   * a recipe in `ui/` may not import a feature's model to re-derive
   * it. Reduced motion therefore arrives here as a plain `false`.
   */
  shimmer?: boolean;
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
 *
 * ## T357: the head is the artifact's `.thead`
 *
 * Three things changed, all of them from `HANDOFF.md` §7.2's own
 * description of that row.
 *
 * **A filled sparkle and a stroked chevron, both real vector paths.**
 * They come from `../primitives/vector-icons.tsx`, which already holds
 * the artifact's literal `d` attributes and stroke widths. The chevron
 * used to be the text glyph `›` rotated 180°, which is a different
 * drawing at a different weight on every OEM font fallback, and which
 * pointed the wrong way at rest for a `chevron-down` disclosure.
 *
 * **The head shimmers, and the shimmer moved here from the row.** The
 * caller used to render a second visible "Still thinking" caption
 * beneath the disclosure, because this recipe had no `live` prop and
 * could not be edited by the task that needed one. It can now, so the
 * treatment sits where the design puts it: on the head's own words.
 * T359 moved the animation itself one file over, to
 * `./ShimmerText.tsx`, when the bash block needed the same treatment
 * for its "Running…" label; this recipe passes `active` and the
 * colour it rests at, and owns nothing of the loop.
 * That caption is gone rather than kept alongside — the head now reads
 * the literal word "Thinking", so the state is still carried in text
 * with the animation off, which is the requirement the caption existed
 * to satisfy (plan.md §10.5). Reduced motion arrives as
 * `shimmer={false}` and leaves the settled colour, exactly as
 * `./StreamingMessage.tsx` does.
 *
 * **The duration is in the words once it is final.** While live, the
 * mono `durationLabel` ticks on the right and the head says "Thinking".
 * Once settled the head says "Thought for N seconds" and the caller
 * stops passing a `durationLabel`, so the number appears once rather
 * than in two places disagreeing about rounding.
 */
/** The artifact's `.thead` sizes. */
const HEAD_FONT_SIZE = 12.5;
const SPARKLE_SIZE = 14;
const CHEVRON_SIZE = 11;

export function ThinkingSection({
  headline,
  summary,
  body,
  durationLabel,
  shimmer: shimmerEnabled = false,
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

  const headTint = expanded ? theme.colors["ink-2"] : theme.colors["ink-3"];

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
        <VectorIcon name="sparkle" size={SPARKLE_SIZE} color={headTint} />
        <ShimmerText
          active={shimmerEnabled}
          settled={headTint}
          style={styles.headline}
          testId={testId ? `${testId}-headline` : undefined}
        >
          {headline}
        </ShimmerText>
        {durationLabel.length > 0 ? <Text style={styles.duration}>{durationLabel}</Text> : null}
        <Animated.View style={chevronStyle} accessibilityElementsHidden>
          <VectorIcon name="chevron-down" size={CHEVRON_SIZE} color={headTint} />
        </Animated.View>
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
    headline: {
      flex: 1,
      fontSize: HEAD_FONT_SIZE,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    // Elapsed-time readout: the mono family with tabular figures — the
    // rule docs/beautiful-ui-reference.md gives for a mono elapsed-time
    // readout. Shown only while the reasoning is still arriving; once it
    // settles the number is in the headline's own words instead.
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
