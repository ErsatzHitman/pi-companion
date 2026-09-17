import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import {
  BLOCK_PADDING_HORIZONTAL,
  BLOCK_PADDING_VERTICAL,
  BLOCK_RADIUS,
  blockRing,
  blockSurface,
} from "../theme/block-shape";
import {
  EXPRESSIVE_CARET_BLINK_DURATION_MS,
  EXPRESSIVE_STREAM_TAIL_CHAR_COUNT,
  EXPRESSIVE_STREAM_TAIL_FADE_STOPS,
  type ExpressiveStreamTailFadeStop,
} from "../theme/expressive-motion";
import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import { ShimmerText } from "./ShimmerText";

/** §7.2's caret width. See this component's doc comment for the phase the artifact has and this app does not. */
const CARET_WIDTH = 2;
/**
 * The transcript line's own mono metrics: `.ln { font-size: 12px;
 * line-height: 1.62 }`. The code variant is 11px/1.625, one px below
 * the transcript's size, so this is stated here rather than borrowed.
 */
const LINE_FONT_SIZE = 12;
const LINE_HEIGHT = LINE_FONT_SIZE * 1.62;

/** Half of `caret-blink`'s own 1s cycle — one hold, in either state. */
const CARET_BLINK_HALF_MS = EXPRESSIVE_CARET_BLINK_DURATION_MS / 2;
/**
 * `step-end` snaps instantly at the end of its hold rather than
 * interpolating toward it — a `withTiming` of this duration, reached
 * only after a `withDelay(CARET_BLINK_HALF_MS, ...)` hold, is what makes
 * the flip a hard edge instead of a fade.
 */
const CARET_BLINK_INSTANT_MS = 0;

/**
 * Linear-interpolates the artifact's `mask-image` gradient
 * (`EXPRESSIVE_STREAM_TAIL_FADE_STOPS`) at one point along its axis.
 * `offset` below the first stop or above the last one clamps to that
 * stop's own opacity, matching how a CSS gradient holds its end colours
 * flat outside its declared stops.
 */
function interpolateStreamTailOpacity(
  offset: number,
  stops: readonly ExpressiveStreamTailFadeStop[],
): number {
  if (offset <= stops[0].offset) return stops[0].opacity;
  for (let i = 1; i < stops.length; i++) {
    const previous = stops[i - 1];
    const current = stops[i];
    if (offset <= current.offset) {
      const span = current.offset - previous.offset;
      const t = span === 0 ? 1 : (offset - previous.offset) / span;
      return previous.opacity + (current.opacity - previous.opacity) * t;
    }
  }
  return stops[stops.length - 1].opacity;
}

/**
 * The `.stream-tail`'s trailing characters of `text`, each paired with
 * the opacity the artifact's mask gradient gives that character's own
 * midpoint — sampled per character rather than per pixel, since React
 * Native has no sub-glyph gradient to lean on.
 */
function streamTailFadeChars(text: string): readonly { char: string; opacity: number }[] {
  const tailLength = Math.min(EXPRESSIVE_STREAM_TAIL_CHAR_COUNT, text.length);
  if (tailLength === 0) return [];
  const tail = text.slice(text.length - tailLength);
  return tail.split("").map((char, index) => ({
    char,
    opacity: interpolateStreamTailOpacity(
      (index + 0.5) / tailLength,
      EXPRESSIVE_STREAM_TAIL_FADE_STOPS,
    ),
  }));
}

/**
 * The artifact's `.stream-caret` with no `.is-streaming` class: a hard
 * on/off square wave at `caret-blink 1s step-end infinite`. Rendered
 * only when `showRestingCaret` is set and motion is not reduced — see
 * this file's own doc comment.
 */
function RestingCaret({ style }: { style: StyleProp<ViewStyle> }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withDelay(CARET_BLINK_HALF_MS, withTiming(0, { duration: CARET_BLINK_INSTANT_MS })),
        withDelay(CARET_BLINK_HALF_MS, withTiming(1, { duration: CARET_BLINK_INSTANT_MS })),
      ),
      -1,
      false,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[style, animatedStyle]} accessibilityElementsHidden />;
}

export interface StreamingMessageProps {
  speaker: "assistant" | "user";
  text: string;
  streaming: boolean;
  /**
   * Draws a visible "You"/"Pi" caption above the turn. Defaults to
   * `false` (UI-A3): the mockup's `.blk`/`.blk.usr`
   * (`docs/ui-reference/pi-companion-app.html`) distinguishes a turn's
   * speaker by tint alone and draws no label at all, and every shipped
   * caller composes this recipe over that same transcript. TalkBack is
   * unaffected either way — `accessibilityLabel` always states the
   * speaker, whether or not this prop also draws it as visible text.
   */
  showSpeakerLabel?: boolean;
  /**
   * Draws the artifact's `.stream-caret` (no `.is-streaming`) once this
   * turn has settled — a hard, un-eased blink at `caret-blink 1s
   * step-end infinite`. Defaults to `false`, and — exactly like
   * `showSpeakerLabel` above — a caller decision this recipe cannot make
   * for itself: the artifact keeps exactly ONE live caret across the
   * whole transcript, blinking on whichever turn is the most recently
   * settled one, which is session/transcript state this per-turn recipe
   * does not have (see this component's own doc comment). No shipped
   * caller passes `true` yet; see `../theme/expressive-motion.ts`'s own
   * doc comment for what wiring one would need.
   */
  showRestingCaret?: boolean;
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
 * (not just the caret) so the state survives without colour or animation.
 *
 * **UI-A3: no visible "You"/"Pi" caption by default.** This recipe used
 * to draw one above every turn unconditionally; the mockup's `.blk`/
 * `.blk.usr` draws no such label anywhere — tint alone tells a user turn
 * from the model's own prose. `showSpeakerLabel` (default `false`) is
 * the caller-opt-in escape hatch this task's brief asked for "only if
 * some caller genuinely needs it"; none does today, so it stays unset
 * everywhere this recipe is mounted. `accessibilityLabel` is unaffected
 * either way — it is built from the same `speakerLabel` regardless of
 * whether this prop also renders it as text.
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
 * The caret is 2px wide (§7.2), not the 8px block it used to be. The
 * artifact's `.stream-caret` blinks at rest (`caret-blink 1s step-end
 * infinite`) but goes SOLID while streaming
 * (`.stream-caret.is-streaming{animation:none}` — confirmed by reading
 * `android-spec.html` directly, not assumed): the caret is a fixed point
 * next to text that is actively changing, and a blink competing with
 * that change read as noise. A prior version of this file had the two
 * states backwards — blinking while streaming, solid at rest — which is
 * the same direction error the web recipe had until it was corrected the
 * wave before this one; verifying the direction here rather than
 * copying it is what caught it.
 *
 * While `streaming` is true the caret renders as a plain, unanimated `View`
 * (opacity 1, no shared value at all — "no animation" needs none). The
 * "blinks at rest" half is now ported too (A-MOTION-2), behind
 * `showRestingCaret` (see this file's own prop doc comment): the artifact
 * keeps exactly one live caret across the whole transcript and blinks it
 * only until the NEXT turn starts streaming (`type()`'s own `settle()` in
 * `android-spec.html`), which is a fact about which turn is most
 * recently settled — session/transcript state this per-turn recipe still
 * does not have and should not reach for, which is why the prop is an
 * explicit opt-in rather than something this file infers from `streaming`
 * alone. With `showRestingCaret` false (every shipped caller today) this
 * component behaves exactly as it did before: it simply stops showing a
 * caret once its own turn finishes. The blink itself is a hard on/off
 * square wave — `caret-blink 1s step-end infinite` holds each opacity
 * value for the full half-cycle and then snaps, rather than fading —
 * built from two `withDelay`+`withTiming(..., {duration:
 * CARET_BLINK_INSTANT_MS})` holds rather than one eased `withTiming`
 * across the whole cycle, which is the one shape that cannot produce a
 * hard edge. Reduced motion draws the same plain, unanimated `View` the
 * streaming case already uses — solid, not hidden, matching the
 * artifact's own reduced-motion behaviour (its blanket
 * `*{animation:none!important}` leaves `.stream-caret` at its un-animated
 * base opacity of 1, not removed) — so no information is lost.
 *
 * **The streaming tail's opacity fade is ported too (A-MOTION-2), the
 * reachable half of `.stream-tail{filter:blur(1.6px);mask-image:
 * linear-gradient(to right,#000 20%,rgba(0,0,0,.2))}`.** React Native has
 * neither a `filter` nor a `mask-image` — no `expo-blur` or
 * `MaskedView` dependency exists in this app, and this task adds none —
 * so the blur is dropped and ONLY the fade is ported, as a per-character
 * opacity ramp over the trailing
 * `../theme/expressive-motion.ts`'s own `EXPRESSIVE_STREAM_TAIL_CHAR_COUNT`
 * (`6`, the artifact's own `TAIL` constant) characters, sampled from
 * `EXPRESSIVE_STREAM_TAIL_FADE_STOPS` (the mask gradient's own stops) at
 * each character's midpoint. It only plays while `streaming` is true and
 * only when motion is not reduced, matching the artifact's own
 * `@media(prefers-reduced-motion:reduce){.stream-tail{filter:none;
 * mask-image:none}}` override exactly (full opacity, no ramp).
 *
 * **`fade-up` (the artifact's `.t>*` turn entrance) is deliberately NOT
 * wired up here**, though `../theme/expressive-motion.ts` records its
 * numbers (`EXPRESSIVE_FADE_UP_*`). Wiring it would add a THIRD
 * Reanimated concern to this file with a duration outside the shared
 * `motion.duration` table, which `../recipes/recipe-accessibility.test.ts`
 * (outside this package's file list) only tolerates for a name explicitly
 * listed in its own `MOTION_TOKEN_EXEMPT` set — this file is now in that
 * set for the resting-caret blink, so adding `fade-up` here is a smaller
 * step than it was, but it is still a distinct capability nothing in
 * this task's brief asked for and no caller needs yet.
 *
 * **Mono transcript text, as the artifact draws it.** The design
 * draws prose in the same mono face, at the same 12px/1.62, as tool
 * output and reasoning — the transcript is one continuous terminal-
 * flavoured column, not a sans document with mono code inside it. The
 * body size (12.5, sans) this used to read was the app's own habit, not
 * the artifact's rule. A filled block other than `.usr` now also draws
 * the artifact's 1px `line` ring (`.blk`'s hairline), so a tool-tinted
 * block is a box rather than a floating tint; `usr` is the one kind the
 * artifact turns that ring off for.
 */
export function StreamingMessage({
  speaker,
  text,
  streaming,
  showSpeakerLabel = false,
  showRestingCaret = false,
  testId,
}: StreamingMessageProps) {
  const { theme, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme, speaker), [theme, speaker]);
  const speakerLabel = speaker === "assistant" ? "Pi" : "You";
  // `.stream-tail` only ever appears on the live line, and never under
  // reduced motion — see this file's own doc comment.
  const tailFadeChars = streaming && !reduceMotion ? streamTailFadeChars(text) : [];
  const headText =
    tailFadeChars.length > 0 ? text.slice(0, text.length - tailFadeChars.length) : text;

  return (
    <View
      style={styles.wrapper}
      accessible
      accessibilityLabel={`${speakerLabel}${streaming ? " (responding)" : ""}: ${text}`}
      testID={testId}
    >
      {showSpeakerLabel ? <Text style={styles.speaker}>{speakerLabel}</Text> : null}
      <View style={styles.textRow}>
        <Text style={styles.text}>
          {headText}
          {tailFadeChars.map(({ char, opacity }, index) => (
            <Text key={index} style={{ opacity }}>
              {char}
            </Text>
          ))}
        </Text>
        {streaming ? (
          // `.stream-caret.is-streaming{animation:none}` — solid, not
          // blinking, while the turn is live. See this file's own doc
          // comment for the direction this used to have.
          <View style={styles.cursor} accessibilityElementsHidden />
        ) : showRestingCaret && !reduceMotion ? (
          <RestingCaret style={styles.cursor} />
        ) : showRestingCaret ? (
          <View style={styles.cursor} accessibilityElementsHidden />
        ) : null}
      </View>
      {streaming ? (
        <ShimmerText active={!reduceMotion} style={styles.caption}>
          Pi is still responding
        </ShimmerText>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"], speaker: "assistant" | "user") {
  const surface = blockSurface(speaker === "user" ? "user" : "assistant");
  const ring = blockRing(speaker === "user" ? "user" : "assistant");
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
      borderWidth: ring === null ? 0 : 1,
      borderColor: ring === null ? "transparent" : theme.colors[ring],
    },
    speaker: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    textRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" },
    text: {
      color: theme.colors.ink,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: LINE_FONT_SIZE,
      lineHeight: LINE_HEIGHT,
    },
    // §7.2's 2px caret. A rule, not a block: at 8px wide it read as a
    // highlight sitting after the text rather than as the place the
    // next character lands.
    cursor: {
      width: CARET_WIDTH,
      height: LINE_HEIGHT,
      marginLeft: theme.spacing[1],
      backgroundColor: theme.colors.accent,
    },
    // No `color` here: `ShimmerText` owns the caption's colour (it
    // interpolates between `ink-3` and `ink` on its own), so setting one
    // here would be dead weight `ShimmerText`'s own inline style always
    // overrides.
    caption: {
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default StreamingMessage;
