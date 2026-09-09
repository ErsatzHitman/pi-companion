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
import { timeline } from "@picompanion/frontend-core";

import type { ResolveImageUri } from "./message-attachments";

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
 * The local wall-clock label for one message row, or `null` when the entry
 * carries no usable timestamp and the row should show nothing.
 *
 * A one-line delegation to `frontend-core`'s `formatMessageTimestamp` rather
 * than a second implementation: the whole point of putting that function in
 * the shared package is that this app and `apps/web` cannot drift on how a
 * time is written. It is re-exported through the model module (not called
 * straight from the `.tsx`) to keep this file the single RN-free home for
 * everything the view maps, matching how `speakerFor` and `boundedText`
 * are already arranged.
 *
 * `options` exists for tests, which must pin `timeZone`/`locale` to stay
 * machine-independent; production callers pass nothing and get the device's
 * own clock and locale.
 */
export function timestampLabelFor(
  entry: CoreMessageEntry,
  options?: timeline.MessageTimestampOptions,
): timeline.MessageTimestampLabel | null {
  return timeline.formatMessageTimestamp(entry.timestamp, options);
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
  /** Resolves a message image to a native-fetchable `uri`. Forwarded
   * unchanged to `MessageAttachments` — see that file's `ResolveImageUri`
   * doc comment for what renders when this is omitted or returns
   * `undefined` for a given image. T284: the session route
   * (`app/h/[serverId]/session/[agentId]/index.tsx`) now supplies a real
   * one via `use-attachment-image-resolver.ts`'s
   * `useAttachmentImageResolver`. */
  resolveImageUri?: ResolveImageUri;
  testId?: string;
}

/**
 * Byte-for-byte the same comparator fields as web's `areRowPropsEqual`
 * (`apps/web/src/features/transcript/message-row.tsx`), now including
 * `resolveImageUri` (T284). CORRECTED at T284: this used to say "minus
 * the `images`/`resolveImageSrc` comparisons — neither field is read by
 * this module's view yet" — false even before this task for `images`,
 * which `message-row.tsx`'s `TranscriptMessageRowImpl` has read since
 * T33A5 and which the comparator below already compared (by reference,
 * sufficient because every upsert this app's timeline layer produces
 * hands a fresh `CoreMessageEntry` object, never a mutated one — the same
 * assumption every other compared field here relies on). `resolveImageUri`
 * is compared by reference too, the same as web's `resolveImageSrc`: a
 * caller passing a fresh closure every render would defeat this memo
 * entirely, which is exactly why `use-attachment-image-resolver.ts`
 * returns its resolver via `useCallback`. Used to wrap
 * `TranscriptMessageRow` in `memo` so a live update to the newest
 * streaming row does not re-render every already-settled row in the
 * list — the render-level half of "streaming text updates incrementally
 * without full re-render"; the data-batching half is
 * `transcript-message-batcher.ts`'s `TimelineCoalescer` composition.
 */
export function areMessageRowPropsEqual(
  previous: TranscriptMessageRowProps,
  next: TranscriptMessageRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.entry.text === next.entry.text &&
    // T308: the row renders `timestamp`, so the comparator has to read it.
    // A comparator that ignores a field its component displays is the
    // classic stale-render bug, and it would show here as a reconciled row
    // keeping the optimistic local time it was created with.
    previous.entry.timestamp === next.entry.timestamp &&
    previous.entry.pending === next.entry.pending &&
    previous.entry.stale === next.entry.stale &&
    previous.entry.images === next.entry.images &&
    (previous.entry.kind === "assistant-message" && next.entry.kind === "assistant-message"
      ? previous.entry.corrected === next.entry.corrected
      : true) &&
    previous.streaming === next.streaming &&
    previous.resolveImageUri === next.resolveImageUri &&
    previous.testId === next.testId
  );
}
