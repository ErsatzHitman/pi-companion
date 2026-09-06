/**
 * plan.md §9.3/§11.1 transcript thinking row (T33A3) — renders one
 * `thinking` `TranscriptEntry` in the compact layout's `transcript` slot.
 *
 * A thin native view over `thinking-row-model.ts`, mirroring
 * `apps/web/src/features/transcript/thinking-row.tsx`'s architecture:
 * all text-mapping logic (`summaryFor`/`bodyFor`/`formatElapsedDuration`/
 * `shouldAnimateShimmer`) lives in the RN-free model module (unit tested
 * there). This file composes the already-built `ThinkingSection` recipe
 * (`../../ui/recipes/index.ts`, read but never forked or edited per this
 * task's brief) for the disclosure itself — its `Pressable` already sets
 * `accessibilityRole="button"`, `accessibilityState={{ expanded }}`, and
 * `accessibilityLabel={summary}` (see that file), so passing it a
 * `live`-aware `summary` is what makes "the announced label changes with
 * the state" true: the same entry announces "Thinking: …" while live and
 * "Thought: …" once settled.
 *
 * **Live shimmer**: `ThinkingSection` (android) has no `live`/shimmer
 * prop — unlike its web counterpart, which shimmers the summary text
 * itself via CSS `background-clip: text` (docs/beautiful-ui-reference.md
 * signature trait 3). React Native has no equivalent for clipping a
 * gradient to arbitrary text, and this task must not fork or edit the
 * shared recipe to add one. This instead follows the RN precedent this
 * codebase already established for exactly this treatment —
 * `../../ui/recipes/StreamingMessage.tsx`'s live caption ("Pi is still
 * responding"), which shimmers via `interpolateColor` between `ink-3`
 * and `ink` over a linear cycle, gated by `reduceMotion` — and renders a
 * second, visible "Still thinking" caption beneath the disclosure while
 * `live` is true. Unlike web's `pc-visually-hidden` announcement, this
 * caption is visible text (RN has no cheap CSS-only visually-hidden
 * primitive here), which only strengthens the "never colour/animation
 * alone" requirement.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import type { timeline } from "@picompanion/frontend-core";

import { ThinkingSection } from "../../ui/recipes";
import { useTheme } from "../../ui/theme/theme-context";
import {
  areThinkingRowPropsEqual,
  bodyFor,
  formatElapsedDuration,
  isThinkingEntry,
  shouldAnimateShimmer,
  summaryFor,
  type ThinkingTranscriptEntry,
  type TranscriptThinkingRowProps,
} from "./thinking-row-model";

export type { ThinkingTranscriptEntry, TranscriptThinkingRowProps } from "./thinking-row-model";
export { isThinkingEntry } from "./thinking-row-model";

/**
 * Beautiful UI's shimmer-gradient text, RN equivalent (see this file's
 * doc comment and `StreamingMessage.tsx`'s identical constant/citation):
 * docs/beautiful-ui-reference.md's "1.4s linear" has no corresponding
 * named token in `@picompanion/design-tokens` (its `motion.duration`
 * table tops out at `entrance` = 600ms), so — exactly as the existing,
 * already-landed `StreamingMessage` recipe does for the same treatment —
 * this stays a named, cited local constant rather than an unexplained
 * literal. Every *gate* on whether it runs at all (`shouldAnimateShimmer`)
 * and its easing curve still come from shared tokens/logic, never a
 * hardcoded animation decision.
 */
const SHIMMER_DURATION_MS = 1400;

/**
 * Ticks a live "Ns"/"Nm Ss" elapsed readout for as long as `live` stays
 * true, freezes it the instant `live` turns false, and reports no
 * duration for an entry that was already settled the first time this
 * client observed it — same semantics as web's `useElapsedLabel`
 * (`apps/web/src/features/transcript/thinking-row.tsx`). Kept in this
 * file (not the RN-free model) because it is a React effect/timer hook;
 * `formatElapsedDuration`, the pure formatting it delegates to, is what
 * `thinking-row-model.test.ts` proves.
 */
function useElapsedLabel(timestamp: string, live: boolean): string {
  const startMs = useMemo(() => Date.parse(timestamp), [timestamp]);
  const wasLiveRef = useRef(false);
  const frozenMsRef = useRef<number | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!live) {
      return undefined;
    }
    const intervalId = setInterval(() => forceTick((count) => count + 1), 1000);
    return () => clearInterval(intervalId);
  }, [live]);

  if (live) {
    wasLiveRef.current = true;
    frozenMsRef.current = null;
    return formatElapsedDuration(Date.now() - startMs);
  }
  if (wasLiveRef.current && frozenMsRef.current === null) {
    frozenMsRef.current = Date.now() - startMs;
  }
  return frozenMsRef.current === null ? "" : formatElapsedDuration(frozenMsRef.current);
}

function TranscriptThinkingRowImpl({ entry, live, testId }: TranscriptThinkingRowProps) {
  const { theme, reduceMotion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const durationLabel = useElapsedLabel(entry.timestamp, live);
  const animate = shouldAnimateShimmer(live, reduceMotion);

  const shimmer = useSharedValue(0);
  useEffect(() => {
    if (!animate) {
      shimmer.value = 0;
      return;
    }
    shimmer.value = withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION_MS, easing: Easing.linear }),
      -1,
      true,
    );
  }, [animate, shimmer]);
  const shimmerStyle = useAnimatedStyle(() => ({
    color: interpolateColor(shimmer.value, [0, 1], [theme.colors["ink-3"], theme.colors.ink]),
  }));

  return (
    <View style={styles.wrapper}>
      <ThinkingSection
        summary={summaryFor(entry, live)}
        body={bodyFor(entry)}
        durationLabel={durationLabel}
        testId={testId}
      />
      {live ? (
        <Animated.Text style={[styles.liveCaption, animate ? shimmerStyle : null]}>
          Still thinking
        </Animated.Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { gap: theme.spacing[1] },
    liveCaption: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export const TranscriptThinkingRow = memo(TranscriptThinkingRowImpl, areThinkingRowPropsEqual);

/** Re-exported so a caller can filter a mixed `TranscriptEntry[]` down to
 * the rows this component renders without importing the model module
 * directly — mirrors `message-row.tsx`'s `filterCoreMessageEntries`. */
export function filterThinkingEntries(
  entries: readonly timeline.TranscriptEntry[],
): ThinkingTranscriptEntry[] {
  return entries.filter(isThinkingEntry);
}
