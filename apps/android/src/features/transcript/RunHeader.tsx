/**
 * RunHeader (W4-RUNFOLD; plan.md §9.3, §10.4, §10.5) — thin native view
 * over `./run-header-model.ts`'s pure view model, mirroring this
 * directory's established "all logic in a `-model.ts`, the `.tsx` only
 * wires it into the render tree" architecture (`ThinkingSection.tsx` over
 * `thinking-row-model.ts`'s `shouldAnimateShimmer`, `header.tsx` over
 * `header-model.ts`, …).
 *
 * ## UNWIRED — no caller mounts this component yet
 *
 * This is a known, disclosed gap, not an oversight (the same shape this
 * task's brief names for `SegmentedControl`). `git grep -n "runhead"
 * apps/android/src` returns only this file, `run-header-model.ts` and
 * their own tests. Wiring it needs a host that groups a session's flat,
 * time-ordered `TranscriptEntry[]` into per-turn runs — one run per
 * assistant response, spanning from just after a `"user-message"` entry
 * to just before the next one — and this repository does not have one:
 * `transcript-window-model.ts`'s `TranscriptWindow` bounds *how many*
 * entries are mounted (a render-count budget) and has no concept of a
 * turn boundary at all; `transcript-message-batcher.ts` hands a caller a
 * flat `CoreMessageEntry[]`/`TranscriptEntry[]` on every applied batch,
 * again with no grouping. Neither file is in this task's file list, so
 * neither was touched.
 *
 * **The exact wiring a future task needs:** group
 * `TranscriptWindowList`'s `entries` prop (in `transcript-window.tsx`) by
 * run before handing rows to `renderRow`, mount one `RunHeader` per group
 * (passing that group's own entries and a piece of per-run `collapsed`
 * state the host owns — see `RunHeaderProps` below for why this
 * component does not own that state itself), and when a run is collapsed
 * skip rendering that group's own rows entirely — the RN equivalent of
 * the design's `.t.runfold>.blk,.t.runfold>.lbl{display:none}`, since RN
 * has no CSS and nothing here can reach sibling list rows to hide them.
 * That grouping function belongs beside `transcript-window-model.ts` or
 * as a new sibling model, not inside this file's exclusive list.
 *
 * ## Why `collapsed` is a controlled prop, not local state
 *
 * `ThinkingSection.tsx`'s disclosure is uncontrolled (`useState` inside
 * the component) because collapsing it only ever hides ITS OWN children.
 * A run's fold hides SIBLING rows elsewhere in the transcript's list —
 * rows this component cannot see or reach — so the fold decision has to
 * live with whatever host owns that list (see above) and reach this
 * component as a prop, with taps reported back up through
 * `onToggleCollapsed`.
 *
 * ## Hover ported as pressed
 *
 * React Native has no `:hover`. The design's
 * `.thead:hover, .runhead:hover { background:var(--hover) }` becomes the
 * `Pressable`'s pressed-state background here, reusing the same
 * `theme.colors.hover` token `ScreenBar.tsx` and `IconButton.tsx` already
 * use for their own `:hover`→pressed port.
 *
 * ## Motion
 *
 * The design's `.runhead svg{transition:transform .2s}` is 200ms. Before
 * adding a new constant, `../../ui/theme/expressive-motion.ts` (this
 * package's OTHER, Android-only motion language) was checked for a
 * matching named duration; none exists there for this rule (only a
 * coincidentally-equal 200ms value, `EXPRESSIVE_POP_IN_DURATION_MS.pill`,
 * which names a completely different keyframe — the attachment pill's
 * pop-in scale, not a rotation — and reusing it here would misattribute
 * that citation). The shared Beautiful UI `motion.duration.moderate`
 * token (`packages/design-tokens`) already holds exactly 200, and is
 * already the theme-resolved, reduced-motion-aware value
 * `ThinkingSection.tsx` reaches for via the identical `useTheme().motion`
 * — under `AccessibilityInfo`'s `reduceMotionChanged`,
 * `theme-context.tsx`'s `getNativeMotion(reduceMotion)` already collapses
 * every duration in that table to near-instant, so no separate
 * `reduceMotion` branch is written here, matching how
 * `ThinkingSection.tsx`'s own chevron rotation gets the same guarantee.
 */
import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { VectorIcon } from "../../ui/primitives/vector-icons";
import { useTheme } from "../../ui/theme/theme-context";
import {
  buildRunHeaderViewModel,
  RUN_HEADER_CHEVRON_COLLAPSED_ROTATION_DEG,
  type RunHeaderEntry,
} from "./run-header-model";

export interface RunHeaderProps {
  /** The run's own entries — tool calls and the assistant's reply —
   * used only to derive the summary count. See `run-header-model.ts`'s
   * doc comment for exactly which `kind`s count. */
  entries: readonly RunHeaderEntry[];
  /** Host-owned fold state — see this file's doc comment for why this
   * is controlled rather than internal. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  testId?: string;
}

/** `.runhead svg` is drawn at `width="12" height="12"`. */
const CHEVRON_SIZE = 12;
/** `.runhead { gap:6px }` — no spacing token holds 6 (the scale steps
 * 4 -> 8), the same gap this directory's `ThinkingSection.tsx` already
 * hits for its own `.thead { gap:6px }` (`THEAD_GAP`). */
const RUNHEAD_GAP = 6;
/** `.runhead { padding:4px 6px }`. Vertical uses `theme.spacing[1]` (4);
 * horizontal has no matching token, so it is this component's own
 * literal, same treatment as `RUNHEAD_GAP`. */
const RUNHEAD_PADDING_HORIZONTAL = 6;
/** `.runhead { margin:4px 0 0 }` — the gap above the row, from whatever
 * sits before it in the turn. */
const RUNHEAD_MARGIN_TOP = 4;
/** `.runhead { font:12.5px/1 ... }` — no typography token holds 12.5. */
const RUNHEAD_FONT_SIZE = 12.5;
/** `font:12.5px/1` — a line-height of exactly 1x the font size. */
const RUNHEAD_LINE_HEIGHT = RUNHEAD_FONT_SIZE;

export function RunHeader({
  entries,
  collapsed,
  onToggleCollapsed,
  testId = "run-header",
}: RunHeaderProps) {
  const { theme, motion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const viewModel = useMemo(
    () => buildRunHeaderViewModel(entries, collapsed),
    [entries, collapsed],
  );

  // `.runhead svg{transition:transform .2s}` — see this file's doc
  // comment for why `motion.duration.moderate` (200ms, already
  // reduced-motion-aware) is the number used rather than a fresh literal.
  const progress = useSharedValue(collapsed ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(collapsed ? 1 : 0, {
      duration: motion.duration.moderate,
      easing: Easing.bezier(...motion.easing.standard),
    });
  }, [collapsed, motion, progress]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * RUN_HEADER_CHEVRON_COLLAPSED_ROTATION_DEG}deg` }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={viewModel.accessibilityLabel}
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLiveRegion="polite"
      onPress={onToggleCollapsed}
      hitSlop={4}
      style={({ pressed }) => [styles.runhead, pressed ? styles.runheadPressed : null]}
      testID={testId}
    >
      <Animated.View style={chevronStyle} accessibilityElementsHidden>
        <VectorIcon name="chevron-down" size={CHEVRON_SIZE} color={theme.colors["ink-2"]} />
      </Animated.View>
      <Text style={styles.summary} testID={testId ? `${testId}-summary` : undefined}>
        {viewModel.displayText}
      </Text>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    runhead: {
      flexDirection: "row",
      alignItems: "center",
      gap: RUNHEAD_GAP,
      marginTop: RUNHEAD_MARGIN_TOP,
      paddingVertical: theme.spacing[1],
      paddingHorizontal: RUNHEAD_PADDING_HORIZONTAL,
      // `.runhead { border-radius:8px }` == the shared `control` radius
      // (`packages/design-tokens` `radii.control`), already reused this
      // way by `transcript-window.tsx`'s own `searchActive` style.
      borderRadius: theme.radii.control,
      // Beautiful UI's touch-target minimum, the same 48dp
      // `ThinkingSection.tsx`'s own disclosure trigger reserves.
      minHeight: 48,
    },
    // `.thead:hover, .runhead:hover { background:var(--hover) }` ported
    // as the pressed state — see this file's doc comment.
    runheadPressed: { backgroundColor: theme.colors.hover },
    summary: {
      color: theme.colors["ink-2"],
      fontSize: RUNHEAD_FONT_SIZE,
      lineHeight: RUNHEAD_LINE_HEIGHT,
      // `font-variant-numeric:tabular-nums` — RN's equivalent.
      fontVariant: ["tabular-nums"],
    },
  });
}

export default RunHeader;
