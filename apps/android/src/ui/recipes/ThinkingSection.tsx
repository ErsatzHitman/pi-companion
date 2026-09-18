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
 * **The artifact's own `.think` column — corrected (AND-THINK).** This
 * paragraph used to quote `.think { border-left: 2px solid
 * var(--line-strong); padding: 1px 0 1px 11px }`, `.thead { font-size:
 * 11.5px; color: var(--ink-3) }` and `.think .ln { color: var(--ink-3);
 * font-style: italic }`. None of those three rules exists in the
 * confirmed spec — grepped directly this session with
 * `grep -oE '\.think\{[^}]{0,200}\}'` (and the equivalent for `.thead`
 * and `.think .ln`) against
 * `C:/Users/aksha/Downloads/pi-ui-goal/android-spec.html`
 * (md5 `498c3bd38ac8da0636e0bc05b705a7be`), not assumed. The rules that
 * are actually there:
 *
 * ```css
 * .think{padding:2px 2px 0;font:italic 12.5px/1.6 Inter,system-ui,sans-serif;color:var(--ink-2)}
 * .thead{display:flex;align-items:center;gap:7px;margin:0 0 4px -4px;padding:3px 6px;
 *   border-radius:8px;font:500 12.5px/1 Inter,system-ui,sans-serif;font-style:normal;
 *   color:var(--ink-3)}
 * ```
 *
 * `.think .ln` declares nothing (confirmed empty by the same grep): the
 * italic, `ink-2` body treatment comes from `.think` itself and is
 * inherited, not a rule on a nested `.ln`. `.thead`'s own `font-style:
 * normal` is what keeps the head upright against that inherited italic.
 * Removing the 2px `line-strong` rule is a real, visible design change,
 * not a refinement — the confirmed `.think` declares no `border` of any
 * kind. The rule and its inset still sit on this component's WRAPPER
 * (now padding only, no border), so the head and the body still share
 * the one column the design draws.
 *
 * The body's mono family was also wrong: `.think` names
 * `Inter,system-ui,sans-serif`, the same sans role `PromptBar.tsx`'s own
 * doc comment identifies as `theme.typography.variant.body.fontFamily`
 * (native Android resolves it to the registered `Inter_400Regular`
 * face). `.thead` is the same family at weight 500, which in this theme
 * is `theme.typography.variant.label.fontFamily` — `packages/design-
 * tokens/src/native.ts`'s `buildTypeStyle` call for the `label` variant
 * passes weight `"medium"`, and `tokens.ts` maps `medium` to `500` — so
 * the headline now reads that variant's `fontFamily` alongside the
 * `fontWeight` it already read.
 */
/** `.thead { font: 500 12.5px/1 Inter,system-ui,sans-serif; color: var(--ink-3) }`. */
const HEAD_FONT_SIZE = 12.5;
const SPARKLE_SIZE = 14;
const CHEVRON_SIZE = 11;
/**
 * `.think { padding: 2px 2px 0 }` — CSS's 3-value shorthand: top 2px,
 * left+right 2px, bottom 0 (no named constant for a bare 0).
 */
const THINK_PADDING_TOP = 2;
const THINK_PADDING_HORIZONTAL = 2;
/**
 * `.think { font: italic 12.5px/1.6 ... }` governs the body text.
 * `.ln` — the transcript-line selector this constant used to cite —
 * declares no font of its own (`grep -oE` for `.ln{...}` returns
 * `white-space`/`display` rules only, confirmed empty of any font
 * property). The transcript's OWN line font, `.t`, is `12.5px/1.62` —
 * a different ratio this component does not use.
 */
const LINE_FONT_SIZE = 12.5;
const LINE_HEIGHT = LINE_FONT_SIZE * 1.6;
/**
 * `.thead { gap: 7px }`. No spacing token holds 7 (the scale steps
 * 4 -> 8), so it stays a literal, the same treatment this file's other
 * artifact-only figures already get. UI-X8 replaced this trigger row's
 * 8px spacing token with a literal 6, reading the number off the wrong
 * document; the non-token decision was right, the digit was not.
 * Corrected here (AND-THINK) to 7, measured against the confirmed
 * `android-spec.html` above.
 */
const THEAD_GAP = 7;
/**
 * The same `.thead` rule's `padding: 3px 6px` and `border-radius: 8px`
 * — a pill the trigger row did not draw before. Landed here because
 * both map cleanly onto RN `padding`/`borderRadius`. NOT landed:
 * `margin: 0 0 4px -4px`. RN accepts a negative `marginLeft`
 * syntactically, but nothing in this session measured how pulling the
 * whole trigger row 4px left would interact with the wrapper's own left
 * padding or the 48dp touch floor `plan.md` §9.3 requires here, so it
 * is left undrawn rather than approximated silently.
 */
const THEAD_PADDING_VERTICAL = 3;
const THEAD_PADDING_HORIZONTAL = 6;
const THEAD_BORDER_RADIUS = 8;

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
    // `.think`'s own inset: the reasoning column is marked once around
    // everything it contains, head included, rather than around the
    // body only. No border — the confirmed `.think` declares none.
    wrapper: {
      gap: theme.spacing[1],
      paddingTop: THINK_PADDING_TOP,
      paddingHorizontal: THINK_PADDING_HORIZONTAL,
      paddingBottom: 0,
    },
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: THEAD_GAP,
      paddingVertical: THEAD_PADDING_VERTICAL,
      paddingHorizontal: THEAD_PADDING_HORIZONTAL,
      borderRadius: THEAD_BORDER_RADIUS,
      minHeight: 48,
    },
    headline: {
      flex: 1,
      fontSize: HEAD_FONT_SIZE,
      fontFamily: theme.typography.variant.label.fontFamily,
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
    // `.think { font: italic 12.5px/1.6 Inter,system-ui,sans-serif;
    // color: var(--ink-2) }` — sans, not mono; ink-2, not ink-3.
    bodyText: {
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.body.fontFamily,
      fontSize: LINE_FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      fontStyle: "italic",
    },
  });
}

export default ThinkingSection;
