/**
 * User/assistant message row — render model (T33A2; plan.md §9.3, §11.1).
 *
 * Mirrors `apps/web/src/features/transcript/message-row.tsx`'s
 * `CoreMessageEntry`/`isCoreMessageEntry`/`speakerFor`/`MAX_TEXT_CHARS`+
 * `TRUNCATION_SUFFIX`/`areRowPropsEqual` one for one — same entry subset,
 * same truncation bound and suffix, same memo comparator fields — so a
 * fixture that produces one rendered row on web produces the equivalent
 * row here. Kept free of any React Native import (this repository's
 * frontend rule; see `../composer/composer-model.ts`'s doc comment for
 * the identical reasoning) so it is unit-testable under this workspace's
 * plain `vitest` setup without an emulator. `message-row.tsx` is a thin
 * native view over this module, exactly as `Composer.tsx` is over
 * `composer-model.ts`.
 *
 * **T33A5 update**: `entry.images` is now rendered — `message-row.tsx`
 * composes `./message-attachments.tsx`'s `MessageAttachments` beneath
 * `StreamingMessage`, driven by `./message-attachments-model.ts` (kept in
 * its own module, not this one, so a diff-only reader of this file still
 * sees the same message-text mapping this module has always owned).
 * `areMessageRowPropsEqual` below now compares `entry.images` by
 * reference — sufficient because every upsert this app's timeline layer
 * produces hands a fresh `CoreMessageEntry` object, not a mutated one, the
 * same assumption every other compared field here already relies on.
 */
import type { timeline } from "@picompanion/frontend-core";

export type CoreMessageEntry = Extract<
  timeline.TranscriptEntry,
  { kind: "user-message" } | { kind: "assistant-message" }
>;

export function isCoreMessageEntry(entry: timeline.TranscriptEntry): entry is CoreMessageEntry {
  return entry.kind === "user-message" || entry.kind === "assistant-message";
}

export function speakerFor(entry: CoreMessageEntry): "assistant" | "user" {
  return entry.kind === "assistant-message" ? "assistant" : "user";
}

/**
 * Same bound and suffix as web's `message-row.tsx` (see that file's doc
 * comment for the full rationale: a pathological message must not freeze
 * the renderer, and `StreamingMessage` renders `text` as unparsed plain
 * content on both platforms, so bounding it here cannot mis-render markup
 * that never existed).
 */
export const MAX_TEXT_CHARS = 20_000;
export const TRUNCATION_SUFFIX = "\n\n… (truncated for display)";

export function boundedText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) {
    return text;
  }
  return `${text.slice(0, Math.max(0, MAX_TEXT_CHARS - TRUNCATION_SUFFIX.length))}${TRUNCATION_SUFFIX}`;
}

/**
 * The non-colour affordance that distinguishes a row's speaker (plan.md
 * §9.3/§10.5: a role must never be conveyed by colour alone). The
 * visible label — "Pi" / "You" — is the invariant shared with web
 * (`apps/web/src/ui/recipes/StreamingMessage.tsx`'s identical
 * `speaker === "assistant" ? "Pi" : "You"` text). Android's
 * `StreamingMessage` recipe (`../../ui/recipes/StreamingMessage.tsx`,
 * built in an earlier wave, not owned by this task) additionally renders
 * a border on user rows and none on assistant rows
 * (`borderWidth: speaker === "user" ? 1 : 0`) — a second, Android-only
 * shape cue with no web equivalent (web instead varies alignment/background
 * via its `pc-message--${speaker}` CSS class). This function documents
 * both cues as data so a caller — or a test — can assert the affordance
 * without rendering RN; `message-row-model.test.ts` mutation-checks the
 * claim against the actual recipe source.
 */
export interface RoleAffordance {
  speaker: "assistant" | "user";
  /** Visible text naming the speaker, independent of any colour token. */
  speakerLabel: string;
  /** Whether the shared `StreamingMessage` recipe additionally renders a
   * border for this speaker (Android-only shape cue; see doc comment). */
  hasBorder: boolean;
}

export function roleAffordanceFor(entry: CoreMessageEntry): RoleAffordance {
  const speaker = speakerFor(entry);
  return {
    speaker,
    speakerLabel: speaker === "assistant" ? "Pi" : "You",
    hasBorder: speaker === "user",
  };
}

export interface TranscriptMessageRowProps {
  entry: CoreMessageEntry;
  /** `true` while this entry is the one currently receiving live
   * `agent_stream` deltas. Sourced by the caller, exactly as on web —
   * this module has no turn-lifecycle state of its own. */
  streaming: boolean;
  testId?: string;
}

/**
 * Byte-for-byte the same comparator fields as web's `areRowPropsEqual`
 * (`apps/web/src/features/transcript/message-row.tsx`), minus the
 * `images`/`resolveImageSrc` comparisons — neither field is read by this
 * module's view yet (see the module doc comment's "deliberate
 * difference" note). Used to wrap `TranscriptMessageRow` in `memo` so a
 * live update to the newest streaming row does not re-render every
 * already-settled row in the list — the render-level half of "streaming
 * text updates incrementally without full re-render"; the data-batching
 * half is `transcript-message-batcher.ts`'s `TimelineCoalescer`
 * composition.
 */
export function areMessageRowPropsEqual(
  previous: TranscriptMessageRowProps,
  next: TranscriptMessageRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.entry.text === next.entry.text &&
    previous.entry.pending === next.entry.pending &&
    previous.entry.stale === next.entry.stale &&
    previous.entry.images === next.entry.images &&
    (previous.entry.kind === "assistant-message" && next.entry.kind === "assistant-message"
      ? previous.entry.corrected === next.entry.corrected
      : true) &&
    previous.streaming === next.streaming &&
    previous.testId === next.testId
  );
}
