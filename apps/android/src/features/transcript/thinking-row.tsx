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
 * **Live shimmer (CORRECTED at T357).** This doc used to say
 * "`ThinkingSection` (android) has no `live`/shimmer prop" and that
 * "this task must not fork or edit the shared recipe to add one",
 * which is why this row rendered a second visible "Still thinking"
 * caption beneath the disclosure. Both statements were true when
 * written and T357 changed the recipe: it takes `live` now and
 * shimmers the head's own words, which is where `HANDOFF.md` §7.2
 * puts the treatment. The extra caption is gone rather than kept
 * beside it — the head reads the literal word "Thinking", so the
 * state survives with the animation off, which is the requirement the
 * caption existed to satisfy. `shouldAnimateShimmer` still lives in
 * the model and is still what gates it, unchanged.
 *
 * **T357 also splits the head's words from the announced label.**
 * `thinkingHeadline` gives the head two words and a duration;
 * `summaryFor` keeps the reasoning preview a screen reader benefits
 * from. Both flip on `live`, so seen and heard state move together.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
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
  thinkingHeadline,
  type ThinkingTranscriptEntry,
  type TranscriptThinkingRowProps,
} from "./thinking-row-model";

export type { ThinkingTranscriptEntry, TranscriptThinkingRowProps } from "./thinking-row-model";
export { isThinkingEntry } from "./thinking-row-model";

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
function useElapsedLabel(
  timestamp: string,
  live: boolean,
): { label: string; elapsedMs: number | null } {
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
    const elapsedMs = Date.now() - startMs;
    return { label: formatElapsedDuration(elapsedMs), elapsedMs };
  }
  if (wasLiveRef.current && frozenMsRef.current === null) {
    frozenMsRef.current = Date.now() - startMs;
  }
  // T357: the settled row shows its duration in the headline's own
  // words, so the mono readout is emptied rather than frozen — the
  // same number twice, rounded two different ways, is how the two
  // disagree.
  return { label: "", elapsedMs: frozenMsRef.current };
}

function TranscriptThinkingRowImpl({ entry, live, testId }: TranscriptThinkingRowProps) {
  const { reduceMotion } = useTheme();
  const { label, elapsedMs } = useElapsedLabel(entry.timestamp, live);

  return (
    <ThinkingSection
      headline={thinkingHeadline(live, elapsedMs)}
      summary={summaryFor(entry, live)}
      body={bodyFor(entry)}
      durationLabel={label}
      shimmer={shouldAnimateShimmer(live, reduceMotion)}
      testId={testId}
    />
  );
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
