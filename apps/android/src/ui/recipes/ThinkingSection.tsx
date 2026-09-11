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
 *
 * **The artifact's own `.think` column.** Quoting the artifact's CSS:
 * `.think { border-left: 2px solid var(--line-strong); padding: 1px 0
 * 1px 11px }`, `.thead { font-size: 11.5px; color: var(--ink-3) }`,
 * `.think .ln { color: var(--ink-3); font-style: italic }`, where `.ln`
 * is the transcript's mono 12px/1.62. The rule and its inset sit on
 * this component's WRAPPER, so the head and the body share the one
 * column the design draws — the body used to carry the rule by itself,
 * which left the head floating outside the mark.
 */
/** The artifact's `.thead { font-size: 11.5px; color: var(--ink-3) }`. */
const HEAD_FONT_SIZE = 11.5;
const SPARKLE_SIZE = 14;
const CHEVRON_SIZE = 11;
/** `.think { border-left: 2px solid var(--line-strong) }`. */
const THINK_RULE_WIDTH = 2;
/** `.think { padding: 1px 0 1px 11px }`. */
const THINK_PADDING_VERTICAL = 1;
const THINK_PADDING_LEFT = 11;
/** `.ln { font-size: 12px; line-height: 1.62 }` — the transcript line's own mono metrics. */
const LINE_FONT_SIZE = 12;
const LINE_HEIGHT = LINE_FONT_SIZE * 1.62;

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

  // `.thead { color: var(--ink-3) }` — one resting tint, expanded or not.
  const headTint = theme.colors["ink-3"];

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
        <View>
          <Text style={styles.bodyText}>{body}</Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    // `.think`'s own rule and inset: the reasoning column is marked once
    // around everything it contains, head included, rather than around
    // the body only.
    wrapper: {
      gap: theme.spacing[1],
      borderLeftWidth: THINK_RULE_WIDTH,
      borderLeftColor: theme.colors["line-strong"],
      paddingVertical: THINK_PADDING_VERTICAL,
      paddingLeft: THINK_PADDING_LEFT,
    },
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
    bodyText: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: LINE_FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      fontStyle: "italic",
    },
  });
}

export default ThinkingSection;
