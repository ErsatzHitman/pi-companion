import { memo, useRef } from "react";
import { timeline } from "@picompanion/frontend-core";

import { Button } from "../../ui/primitives/index.js";
import { StreamingMessage } from "../../ui/recipes/index.js";
import { MessageAttachments } from "./message-attachments.js";
import type { ResolveImageSrc } from "./message-attachments.js";
import { TranscriptMeta } from "./transcript-meta.js";

/** The subset of `timeline.TranscriptEntry` this task renders (plan.md
 * §11.1's "assistant text" and user-message lifecycle states). Sibling
 * files in this same directory add row renderers for the remaining
 * `TranscriptEntry` kinds — `thinking-row.tsx` (T28A3), then later tasks
 * for tool calls, todo, error, compaction, extension snapshots, and the
 * `unknown` fallback.
 *
 * **Image content (T52A3).** T28A5 ("Render images, attachments, and
 * diffs") found that a `user-message`/`assistant-message`
 * `TranscriptEntry` carried only `text` — the wire protocol dropped
 * every image block before it ever reached the timeline
 * (`PiHistoryMapper.mapUserMessage`'s `getUserMessageText` helper read
 * only `PiTextContent` blocks out of the prompt content array). T52A1
 * fixed that mapper to also extract and materialize image blocks, and
 * T52A2 threaded the result onto `TranscriptEntry.images`
 * (`AgentTimelineImageRef[]`, declared in `packages/protocol/src/agent-types.ts`).
 * This file renders that field through `MessageAttachments` below.
 * `AgentAttachment` (forge/GitHub issue and PR references, uploaded
 * files, review comments) is a *separate* shape from an image block and
 * remains flattened to text before Pi ever sees it (T52A1's finding,
 * unchanged) — see `message-attachments.tsx`'s module doc comment for
 * the full citation of what that means for what can render here. */
export type CoreMessageEntry = Extract<
  timeline.TranscriptEntry,
  { kind: "user-message" } | { kind: "assistant-message" }
>;

export function isCoreMessageEntry(entry: timeline.TranscriptEntry): entry is CoreMessageEntry {
  return entry.kind === "user-message" || entry.kind === "assistant-message";
}

export interface TranscriptMessageRowProps {
  entry: CoreMessageEntry;
  /** `true` while this entry is the one currently receiving live
   * `message_update` deltas. Sourced by the caller — this domain has no
   * turn-lifecycle state of its own yet (plan.md §11.1 lists agent/turn
   * start/end/settled as a separate, not-yet-built frontend-core domain;
   * see `transcript-view.ts`'s module doc). */
  streaming: boolean;
  /** Resolves a message image to a browser-fetchable URL. Forwarded
   * unchanged to `MessageAttachments` — see that file's module doc
   * comment for what renders when this is omitted or returns
   * `undefined` for a given image. CORRECTED at T284: this used to say
   * no caller could supply one yet. `host-session-screen.tsx` now does,
   * via `features/transcript/attachment-image-resolver.ts`'s
   * `useAttachmentImageResolver`. */
  resolveImageSrc?: ResolveImageSrc;
  /**
   * T105 (plan.md §11.1's edit-from-here shortcut, T38A1b's frontend-core
   * model). Renders an "Edit from here" button on this row only when
   * `entry.kind === "user-message"` — omitted entirely for an assistant
   * row or when this prop itself is omitted (every existing caller,
   * unaffected). The caller (`transcript.tsx`) passes this straight
   * through unchanged rather than binding a fresh closure per row, so it
   * stays comparable by reference in `areRowPropsEqual` below; the row
   * itself supplies `entry.id` when calling it.
   */
  onEditFromHere?: (messageId: string) => void;
  /**
   * Whether `entry.id` currently has a valid edit-from-here fork point
   * (a previous message to keep) — see
   * `edit-from-here-target.ts`'s `canEditFromHere`. `false` disables
   * rather than hides the button, mirroring `InvalidEditFromHereTarget
   * Error`'s own "reasoned rejection, not a hidden affordance" design
   * (`tree-edit-shortcut.ts`'s module doc): the first message in a
   * session visibly offers no predecessor to branch from, rather than
   * silently having no button at all.
   */
  canEditFromHere?: boolean;
  /**
   * T395 (plan.md §4.2 "Workspace checkpoint snapshots"): renders a
   * "Rewind to here" button on this row only when
   * `entry.kind === "user-message"` — omitted entirely for an assistant
   * row or when this prop itself is omitted (every existing caller,
   * unaffected). The row supplies `entry.id` when calling it; the
   * caller's hook resolves that row's daemon message id (see
   * `rewind/use-rewind-to-here.ts`). Like `onEditFromHere` this is passed
   * straight through from `transcript.tsx` (never wrapped in a fresh
   * closure per row) so it stays comparable by reference.
   */
  onRewindToHere?: (messageId: string) => void;
  /**
   * `true` disables the rewind button (no daemon connection, or the
   * caller otherwise cannot rewind). A row whose user message has no
   * daemon id to target disables itself regardless — there is nothing to
   * rewind to.
   */
  rewindToHereDisabled?: boolean;
  testId?: string;
}

function speakerFor(entry: CoreMessageEntry): "assistant" | "user" {
  return entry.kind === "assistant-message" ? "assistant" : "user";
}

/**
 * A pathological message (a runaway generation loop, a pasted log dump)
 * can run to megabytes. `StreamingMessage` renders `text` as plain,
 * unparsed content — there is no markdown parser in this row today — so
 * an unbounded string cannot be *mis*-rendered as markup, but building
 * and diffing a many-megabyte single text node on every streaming delta
 * can still freeze the tab (T28A5 acceptance: "a very large markdown
 * message degrades to plain text rather than freezing the renderer";
 * "oversized payloads are bounded, not dropped silently"). Bounding what
 * this row renders — never what `frontend-core` stores — keeps one row's
 * DOM cost constant regardless of payload size, the same trade-off
 * `thinking-row.tsx`'s `MAX_BODY_CHARS` already makes for reasoning text.
 */
const MAX_TEXT_CHARS = 20_000;
const TRUNCATION_SUFFIX = "\n\n… (truncated for display)";

function boundedText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) {
    return text;
  }
  return `${text.slice(0, Math.max(0, MAX_TEXT_CHARS - TRUNCATION_SUFFIX.length))}${TRUNCATION_SUFFIX}`;
}

/**
 * Renders one `user-message`/`assistant-message` transcript entry by
 * composing the `StreamingMessage` recipe (T28A2, plan.md §10.4). The
 * visible speaker distinction now lives above the block in
 * `TranscriptMeta` (`you`/`pi`, the mockup's `.meta` treatment) rather
 * than inside the bubble, exactly as the design reference draws it; the
 * bubble's own `role="group"` `aria-label` remains the accessible name,
 * so speaker identity is still never colour-only. The recipe supplies the
 * reduced-motion-safe streaming treatment; this component only maps the
 * framework-neutral `TranscriptEntry` onto that recipe's props.
 *
 * Memoized on the fields that actually change a rendered row (`text`,
 * `corrected`, `pending`, `streaming`) so a live update to the newest
 * message — the common case while a turn is streaming — re-renders only
 * that one row, not every row already settled in the transcript (T28A2
 * acceptance: "streaming text updates incrementally without re-rendering
 * the whole list").
 */
function TranscriptMessageRowImpl({
  entry,
  streaming,
  resolveImageSrc,
  onEditFromHere,
  canEditFromHere,
  onRewindToHere,
  rewindToHereDisabled,
  testId,
}: TranscriptMessageRowProps) {
  // Render-count instrumentation for the memoization guarantee above.
  // Cheap (one ref increment), invisible (a `data-*` attribute has no
  // visual or accessible-tree effect), and exists so a test — or a future
  // audit — can prove a settled row was not re-rendered, rather than only
  // inferring it from DOM node identity, which key-based reconciliation
  // would preserve even without memoization.
  const renderCount = useRef(0);
  renderCount.current += 1;

  return (
    <div data-render-count={renderCount.current}>
      {/* The mockup's `.meta` line, above the block rather than inside it:
          the visible speaker (`you`/`pi`) plus this row's own time. The
          bubble below keeps its `role="group"` `aria-label` as the
          accessible name, so nothing here is colour- or label-only. */}
      <TranscriptMeta
        who={entry.kind === "assistant-message" ? "pi" : "you"}
        timestamp={entry.timestamp}
        testId={testId}
      />
      <StreamingMessage
        speaker={speakerFor(entry)}
        text={boundedText(entry.text)}
        streaming={streaming}
        testId={testId}
      />
      {entry.images && entry.images.length > 0 ? (
        <MessageAttachments
          images={entry.images}
          entryId={entry.id}
          speaker={speakerFor(entry)}
          resolveImageSrc={resolveImageSrc}
          testId={testId ? `${testId}-attachments` : undefined}
        />
      ) : null}
      {entry.kind === "user-message" && onEditFromHere ? (
        <Button
          kind="secondary"
          disabled={!canEditFromHere}
          onClick={() => onEditFromHere(entry.id)}
          data-testid={testId ? `${testId}-edit-from-here` : undefined}
        >
          Edit from here
        </Button>
      ) : null}
      {entry.kind === "user-message" && onRewindToHere ? (
        <Button
          kind="secondary"
          disabled={!(entry.messageId ?? entry.clientMessageId) || rewindToHereDisabled === true}
          onClick={() => onRewindToHere(entry.id)}
          data-testid={testId ? `${testId}-rewind-to-here` : undefined}
        >
          Rewind to here
        </Button>
      ) : null}
    </div>
  );
}

/** Cheap, order-and-length-sensitive comparison for `images` — avoids a
 * `JSON.stringify` on every row compare (this domain's arrays are tiny,
 * but a per-row string build on every transcript re-render is needless
 * work) while still catching an add/remove/reorder. `AgentTimelineImageRef`
 * fields (`path`, `mimeType`, `bytes`) are only ever set once by the
 * history mapper, never mutated in place, so comparing `path` alone per
 * slot is sufficient to detect a real change. */
function imagesEqual(
  previous: ReadonlyArray<{ path: string }> | undefined,
  next: ReadonlyArray<{ path: string }> | undefined,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return previous === next;
  if (previous.length !== next.length) return false;
  return previous.every((image, index) => image.path === next[index]?.path);
}

function areRowPropsEqual(
  previous: TranscriptMessageRowProps,
  next: TranscriptMessageRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.entry.text === next.entry.text &&
    // T308: this row renders `timestamp`, so the comparator has to read it.
    // A comparator that ignores a field its component displays is the
    // classic stale-render bug, and it would show here as a reconciled row
    // keeping the optimistic local time it was created with.
    previous.entry.timestamp === next.entry.timestamp &&
    previous.entry.pending === next.entry.pending &&
    previous.entry.stale === next.entry.stale &&
    (previous.entry.kind === "assistant-message" && next.entry.kind === "assistant-message"
      ? previous.entry.corrected === next.entry.corrected
      : true) &&
    imagesEqual(previous.entry.images, next.entry.images) &&
    previous.streaming === next.streaming &&
    previous.resolveImageSrc === next.resolveImageSrc &&
    previous.onEditFromHere === next.onEditFromHere &&
    previous.canEditFromHere === next.canEditFromHere &&
    previous.onRewindToHere === next.onRewindToHere &&
    previous.rewindToHereDisabled === next.rewindToHereDisabled &&
    previous.testId === next.testId
  );
}

export const TranscriptMessageRow = memo(TranscriptMessageRowImpl, areRowPropsEqual);
