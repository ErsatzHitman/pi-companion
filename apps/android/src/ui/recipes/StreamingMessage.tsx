import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  BLOCK_PADDING_HORIZONTAL,
  BLOCK_PADDING_VERTICAL,
  BLOCK_RADIUS,
  blockRing,
  blockSurface,
} from "../theme/block-shape";
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
 * This only ports the `is-streaming` half: while `streaming` is true the
 * caret renders as a plain, unanimated `View` (opacity 1, no shared
 * value at all — "no animation" needs none). The "blinks at rest" half
 * (`../theme/expressive-motion.ts`'s own `EXPRESSIVE_CARET_BLINK_DURATION_MS`
 * records the artifact's `1s` cycle for whichever file eventually wires
 * it) is deliberately NOT reproduced: the artifact keeps exactly one
 * live caret across the whole transcript and blinks it only until the
 * NEXT turn starts streaming (`type()`'s own `settle()` in
 * `android-spec.html`), which is a fact about which turn is most
 * recently settled — session/transcript state this per-turn recipe does
 * not have and should not reach for. This component simply stops
 * showing a caret once its own turn finishes, which is the same
 * behaviour this file already had before this change.
 *
 * **`fade-up` (the artifact's `.t>*` turn entrance) is deliberately NOT
 * wired up here either**, though `../theme/expressive-motion.ts` records
 * its numbers (`EXPRESSIVE_FADE_UP_*`). Wiring it would have made this
 * file call a Reanimated timing helper directly while owning a duration
 * outside the shared `motion.duration` table — exactly the shape
 * `./ShimmerText.tsx` already has, and that shape is only sound today
 * because `../recipes/recipe-accessibility.test.ts` (outside this
 * package's file list) states it explicitly as `MOTION_TOKEN_EXEMPT`.
 * Doing the same for this file's own `withTiming` calls without a
 * matching entry there would leave that shared, cross-cutting test
 * failing for a reason invisible to anyone reading only this file. See
 * this package's own final report for the exact addition that test
 * needs before a future task wires this up.
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
  testId,
}: StreamingMessageProps) {
  const { theme, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme, speaker), [theme, speaker]);
  const speakerLabel = speaker === "assistant" ? "Pi" : "You";

  return (
    <View
      style={styles.wrapper}
      accessible
      accessibilityLabel={`${speakerLabel}${streaming ? " (responding)" : ""}: ${text}`}
      testID={testId}
    >
      {showSpeakerLabel ? <Text style={styles.speaker}>{speakerLabel}</Text> : null}
      <View style={styles.textRow}>
        <Text style={styles.text}>{text}</Text>
        {streaming ? (
          // `.stream-caret.is-streaming{animation:none}` — solid, not
          // blinking, while the turn is live. See this file's own doc
          // comment for the direction this used to have and why the
          // "blinks at rest" phase is deliberately not ported.
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
