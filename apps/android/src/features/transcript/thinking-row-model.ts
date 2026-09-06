/**
 * `thinking` transcript entry — render model (T33A3; plan.md §9.3, §11.1,
 * §10.4 "ThinkingSection").
 *
 * Mirrors `apps/web/src/features/transcript/thinking-row.tsx`'s pure
 * helpers (`truncate`/`firstLine`/`summaryFor`/`bodyFor`/`formatElapsed`)
 * one for one — same bounds, same suffixes, same "Thinking: …" vs
 * "Thought: …" prefix — so a fixture that produces one rendered thinking
 * row on web produces the equivalent row here. Kept free of any React or
 * React Native import (this repository's frontend rule; see
 * `./message-row-model.ts`'s doc comment for the identical reasoning) so
 * it is unit-testable under this workspace's plain `vitest` setup without
 * an emulator. `thinking-row.tsx` is a thin native view over this module,
 * composing the already-built `ThinkingSection` recipe
 * (`../../ui/recipes/ThinkingSection.tsx`) — read, not forked, per this
 * task's brief.
 */
import type { timeline } from "@picompanion/frontend-core";

export type ThinkingTranscriptEntry = Extract<timeline.TranscriptEntry, { kind: "thinking" }>;

export function isThinkingEntry(entry: timeline.TranscriptEntry): entry is ThinkingTranscriptEntry {
  return entry.kind === "thinking";
}

/**
 * Same bound as web (`thinking-row.tsx`'s identical constant + doc
 * comment): reasoning can run to many thousands of characters over a long
 * turn, so this bounds what one row *renders* — never what
 * `frontend-core` stores — to keep the row's native view tree bounded.
 */
export const MAX_BODY_CHARS = 4000;
export const MAX_SUMMARY_CHARS = 80;
export const BODY_TRUNCATION_SUFFIX = "\n\n… (truncated for display)";
export const SUMMARY_TRUNCATION_SUFFIX = "…";

export function truncate(text: string, max: number, suffix: string): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

export function firstLine(text: string): string {
  const trimmed = text.trim();
  const newlineIndex = trimmed.indexOf("\n");
  return newlineIndex === -1 ? trimmed : trimmed.slice(0, newlineIndex);
}

/**
 * The disclosure trigger's visible summary text — also `ThinkingSection`'s
 * `accessibilityLabel`, since the recipe sets `accessibilityLabel={summary}`
 * verbatim (see that file). The "Thinking: …"/"Thought: …" prefix is the
 * mechanism by which "the announced label changes with the state": the
 * same entry announces differently the instant `live` flips from `true`
 * to `false`, with no dependency on colour or animation.
 */
export function summaryFor(entry: ThinkingTranscriptEntry, live: boolean): string {
  const preview = truncate(firstLine(entry.text), MAX_SUMMARY_CHARS, SUMMARY_TRUNCATION_SUFFIX);
  if (preview.length === 0) {
    return live ? "Thinking…" : "Thought";
  }
  return live ? `Thinking: ${preview}` : `Thought: ${preview}`;
}

export function bodyFor(entry: ThinkingTranscriptEntry): string {
  const trimmed = entry.text.trim();
  if (trimmed.length === 0) {
    return "…";
  }
  return truncate(trimmed, MAX_BODY_CHARS, BODY_TRUNCATION_SUFFIX);
}

export function formatElapsedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Gates the shimmer-gradient live-state treatment (docs/
 * beautiful-ui-reference.md signature trait 3; RN equivalent per
 * `../../ui/recipes/StreamingMessage.tsx`'s `interpolateColor`
 * precedent): the caption shimmers only while both `live` is true *and*
 * reduced motion is off. `reduceMotion` is an injected boolean — sourced
 * by the caller from `useTheme().reduceMotion`
 * (`../../ui/theme/theme-context.tsx`, which itself resolves
 * `AccessibilityInfo.isReduceMotionEnabled`) — so this stays a plain,
 * deterministic function with no `react-native` import: reduced motion
 * does not mean the caption disappears, only that it stops animating (it
 * still renders, statically, at the settled `ink` colour).
 */
export function shouldAnimateShimmer(live: boolean, reduceMotion: boolean): boolean {
  return live && !reduceMotion;
}

export interface TranscriptThinkingRowProps {
  entry: ThinkingTranscriptEntry;
  /** `true` while this entry is the one currently receiving live
   * reasoning deltas — same source/shape as `TranscriptMessageRow`'s
   * `streaming` prop (`./message-row-model.ts`). */
  live: boolean;
  testId?: string;
}

/**
 * Same comparator shape as `./message-row-model.ts`'s
 * `areMessageRowPropsEqual`: wraps `TranscriptThinkingRow` in `memo` so a
 * live update to the newest streaming/thinking row does not re-render
 * every already-settled thinking row already in the list.
 */
export function areThinkingRowPropsEqual(
  previous: TranscriptThinkingRowProps,
  next: TranscriptThinkingRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.entry.text === next.entry.text &&
    previous.entry.timestamp === next.entry.timestamp &&
    previous.live === next.live &&
    previous.testId === next.testId
  );
}
