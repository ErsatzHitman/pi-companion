import { useLayoutEffect, useMemo, useRef } from "react";
import {
  measureElement as measureElementDefault,
  observeElementRect,
  useVirtualizer,
} from "@tanstack/react-virtual";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { timeline } from "@picompanion/frontend-core";

import { EmptyState } from "../../ui/primitives/index.js";
import { isCompactionEntry, TranscriptCompactionRow } from "./compaction-row.js";
import { canEditFromHere } from "./edit-from-here-target.js";
import type { EditFromHereTargetIndex } from "./edit-from-here-target.js";
import { isCoreMessageEntry, TranscriptMessageRow } from "./message-row.js";
import type { ResolveImageSrc } from "./message-attachments.js";
import { isThinkingEntry, TranscriptThinkingRow } from "./thinking-row.js";
import { isToolCallEntry, TranscriptToolCallRow } from "./tool-call-row.js";
import "./transcript.css";

type RenderableEntry = Extract<
  timeline.TranscriptEntry,
  | { kind: "user-message" }
  | { kind: "assistant-message" }
  | { kind: "thinking" }
  | { kind: "tool-call" }
  | { kind: "compaction" }
>;

function isRenderableEntry(entry: timeline.TranscriptEntry): entry is RenderableEntry {
  return (
    isCoreMessageEntry(entry) ||
    isThinkingEntry(entry) ||
    isToolCallEntry(entry) ||
    isCompactionEntry(entry)
  );
}

export interface TranscriptProps {
  /** The framework-neutral entries `buildTranscriptEntries`/`buildTranscriptView`
   * (T28A1, `@picompanion/frontend-core`) project from `TimelineState`. */
  entries: readonly timeline.TranscriptEntry[];
  /** `id` of the entry currently receiving live streaming deltas, or
   * `null`/omitted when no turn is in flight. See `TranscriptMessageRow`'s
   * doc comment for why this is an explicit prop rather than derived
   * here. */
  streamingEntryId?: string | null;
  /** Forwarded to every `TranscriptMessageRow` (T52A3). See
   * `message-attachments.tsx`'s module doc comment for what this seam is
   * for and why no caller wires a real one yet. */
  resolveImageSrc?: ResolveImageSrc;
  /**
   * T105: per-message edit-from-here eligibility, from
   * `edit-from-here-target.ts`'s `buildEditFromHereTargets`. Omit to
   * render no "Edit from here" affordance at all — every existing
   * caller, unaffected.
   */
  editFromHereTargets?: EditFromHereTargetIndex;
  /**
   * T105: called with a user message's `id` when its "Edit from here"
   * button is activated. Forwarded straight through to
   * `TranscriptMessageRow` unchanged (never wrapped in a fresh closure
   * here) so it stays comparable by reference for that row's own
   * memoization.
   */
  onEditFromHere?: (messageId: string) => void;
  testId?: string;
}

/**
 * Rough seed height (px) the virtualizer uses for a row it has not
 * measured yet — every renderable row kind varies wildly (a one-line
 * message vs. a diff-bearing tool call), so this only affects the very
 * first paint's scroll math before `measureElement`'s `ResizeObserver`
 * reports each row's real height; it is not a layout constraint on any
 * row.
 */
const ESTIMATED_ROW_HEIGHT_PX = 96;

/**
 * Below this many renderable rows, every row renders — `overscan` is set
 * to the row count itself, which `defaultRangeExtractor` clamps to
 * `[0, count - 1]` regardless of scroll offset, so the visible range
 * always covers the whole list. A normal session's turn count sits
 * nowhere near this, so the common case pays no windowing cost or
 * follow-tail scroll-position churn at all; only a session that actually
 * approaches the §14.5 "10,000 timeline items" budget crosses into real
 * windowing, at `BOUNDED_OVERSCAN` below.
 */
const FULL_RENDER_THRESHOLD = 300;

/**
 * Overscan used once a transcript crosses `FULL_RENDER_THRESHOLD`: rows
 * this many indices above and below the visible range stay mounted, so a
 * small scroll or the next follow-tail jump never flashes empty space
 * before `measureElement` catches up. `2 * BOUNDED_OVERSCAN + 1` rendered
 * rows is still far below the 10,000-item budget this exists to hold to
 * (plan.md §14.5).
 */
const BOUNDED_OVERSCAN = 16;

/**
 * How close to the bottom (px) the user has to be for a newly appended
 * or still-streaming row to keep auto-scrolling into view. Scrolled past
 * this, `Transcript` stops following so reading earlier history is never
 * yanked out from under the reader by an unrelated live update.
 */
const FOLLOW_TAIL_THRESHOLD_PX = 96;

function isNearBottom(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_TAIL_THRESHOLD_PX
  );
}

/**
 * `@tanstack/virtual-core`'s `calculateRange` treats a `0`-height
 * viewport as "not laid out yet" and renders nothing at all (not even
 * `FULL_RENDER_THRESHOLD`'s "render everything" case reaches its own
 * logic — the empty-viewport guard short-circuits first). A container
 * can genuinely measure `0` for a tick: before its flex ancestor has
 * committed layout, or — every test in this codebase — under `jsdom`,
 * which never computes real layout at all (`offsetHeight` stays `0`
 * unless a test explicitly mocks it). Flooring the observed height to a
 * sane minimum keeps the transcript rendering something useful in both
 * cases instead of going dark until a later resize fires; a real, laid
 * out viewport still reports its true (larger, in practice) height and
 * this floor never applies.
 */
const FALLBACK_VIEWPORT_HEIGHT_PX = 480;

function observeElementRectWithFallback(
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
  cb: (rect: { width: number; height: number }) => void,
): void | (() => void) {
  return observeElementRect(instance, (rect) =>
    cb({
      width: rect.width,
      height: rect.height > 0 ? rect.height : FALLBACK_VIEWPORT_HEIGHT_PX,
    }),
  );
}

/**
 * Same reasoning as `observeElementRectWithFallback`, applied to each
 * row: the default strategy's synchronous fallback (used on a row's
 * first mount, before its `ResizeObserver` entry arrives) reads
 * `element.offsetHeight` directly, which is `0` under `jsdom` — there is
 * no polyfill for real layout, so every row would "measure" to `0` on
 * mount. That is not just a display bug: shrinking every mounted row's
 * height toward `0` lets far more of them satisfy `calculateRangeImpl`'s
 * "does the next item still fit before the viewport limit" check on the
 * very next range recalculation, which mounts more rows, which measure
 * to `0` too, expanding the visible range further — an unbounded
 * feedback loop that both defeats `BOUNDED_OVERSCAN` and trips React's
 * nested-update-depth guard. Treating a non-positive measurement as "not
 * yet measurable" and keeping the seeded estimate instead breaks that
 * loop while leaving genuine dynamic remeasurement (any real, positive
 * height a row's actual content produces, in a real browser) unchanged.
 */
function measureRowElement(
  element: HTMLDivElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
): number {
  const measured = measureElementDefault(element, entry, instance);
  if (measured > 0) {
    return measured;
  }
  return instance.options.estimateSize(instance.indexFromElement(element));
}

/**
 * Scrolls `instance.scrollElement` by writing `scrollTop` directly and
 * dispatching a synthetic `scroll` event, rather than the virtualizer's
 * default `elementScroll` (`Element.scrollTo`).
 *
 * Two reasons, both load-bearing:
 *
 * 1. **Reduced motion, by construction.** A direct property write has no
 *    animation to disable — there is no `behavior: "smooth"` path to gate
 *    behind `prefers-reduced-motion` at all (plan.md §10.5), which also
 *    avoids compounding a `smooth` scroll animation on top of itself
 *    every time another streaming delta arrives a frame later.
 * 2. **Deterministic offset tracking.** The virtualizer only learns a new
 *    scroll offset from a native `scroll` event (`observeElementOffset`);
 *    a real browser fires one asynchronously when `scrollTop` is
 *    assigned, but `jsdom` — this app's test environment — fires neither
 *    that event nor implements `Element.scrollTo` at all. Dispatching the
 *    event ourselves, synchronously, makes follow-tail scrolling behave
 *    identically (and immediately, with no extra render pass) in a real
 *    browser and under test.
 */
function instantScrollTo(
  offset: number,
  { adjustments }: { adjustments?: number },
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
): void {
  const element = instance.scrollElement;
  if (!element) {
    return;
  }
  const next = Math.max(0, offset + (adjustments ?? 0));
  element.scrollTop = next;
  element.dispatchEvent(new Event("scroll"));
}

function renderEntryRow(
  entry: RenderableEntry,
  streamingEntryId: string | null,
  resolveImageSrc?: ResolveImageSrc,
  editFromHereTargets?: EditFromHereTargetIndex,
  onEditFromHere?: (messageId: string) => void,
) {
  const rowTestId = `transcript-row-${entry.id}`;
  if (isThinkingEntry(entry)) {
    return (
      <TranscriptThinkingRow
        entry={entry}
        live={entry.id === streamingEntryId}
        testId={rowTestId}
      />
    );
  }
  if (isToolCallEntry(entry)) {
    return <TranscriptToolCallRow entry={entry} testId={rowTestId} />;
  }
  if (isCompactionEntry(entry)) {
    return <TranscriptCompactionRow entry={entry} testId={rowTestId} />;
  }
  return (
    <TranscriptMessageRow
      entry={entry}
      streaming={entry.id === streamingEntryId}
      resolveImageSrc={resolveImageSrc}
      onEditFromHere={onEditFromHere}
      canEditFromHere={editFromHereTargets ? canEditFromHere(editFromHereTargets, entry.id) : false}
      testId={rowTestId}
    />
  );
}

/**
 * Transcript feature (T28A2/T28A3/T28A4/T28A6/T28A7, plan.md §8.3
 * "center: transcript and composer"): renders the
 * `user-message`/`assistant-message`/`thinking`/`tool-call`/`compaction`
 * entries of a `TranscriptView` as a chronological, live, virtualized
 * transcript.
 *
 * The two core message kinds (T28A2), collapsible `thinking` sections
 * (T28A3), `tool-call` rows (T28A4, extended by T28A5 with full
 * diff-line and image-result rendering), and `compaction` markers
 * (T28A7, `compaction-row.tsx`) are rendered here — the remaining
 * `TranscriptEntry` kinds (`todo`, `error`, `extension-snapshot`,
 * `unknown`) are still out of this directory's built scope, with no
 * further task currently scheduled to add them (see
 * `docs/issues-from-plan.md`'s T28A family). Silently skipping them
 * here — rather than rendering nothing meaningful or guessing at a
 * shape — keeps this task's surface exactly what it claims.
 *
 * **No `"retry"` row exists, and cannot yet exist here.** T28A7's other
 * half — "retry markers" — has no `TranscriptEntry` kind to render:
 * `compaction-row.tsx`'s doc comment has the full citation trail
 * (`packages/protocol/src/agent-types.ts:419`'s `pi_retry` is a
 * top-level `AgentStreamEvent`, never folded into an
 * `AgentTimelineItem`, and `packages/frontend-core/src/timeline/
 * reducer.ts:281-284`'s `ingestAgentStreamMessage` drops every
 * non-`"timeline"` event as a documented no-op) — so no retry data ever
 * reaches this component's `entries` prop. This is a frontend-core gap
 * outside every file `apps/web/src/features/transcript/` owns, not a
 * choice made here; closing it needs a small core change (a `pi_retry`
 * branch in the sessions/turn-state domain, or a new
 * `AgentTimelineItem`/`TranscriptEntry` "retry" case) this task does not
 * own. The gap is left visible — no fabricated entry kind, no dead
 * component wired to nothing — rather than silently dropped.
 *
 * There is no dedicated `TranscriptEntry` kind for "image" or
 * "attachment": a message's images live on the existing `user-message`/
 * `assistant-message` kinds' optional `images` field instead (T52A2),
 * rendered by `TranscriptMessageRow` composing `MessageAttachments`
 * (T52A3) — see `message-row.tsx`'s doc comment for how that field
 * reached the entry, and `message-attachments.tsx`'s for exactly what
 * can and cannot render from it today. `tool-call-row.tsx`'s `EditBody`
 * (diffs) and `ReadBody`/`WriteBody`/`UnknownToolCard` (image results
 * detected in a tool's own text/result field) remain T28A5's separate
 * "images, attachments, and diffs" surface for tool calls, composed here
 * unchanged through `TranscriptToolCallRow`.
 *
 * **Virtualization (T28A6, plan.md §14.5 "transcript: 10,000 timeline
 * items without rendering more than a bounded window").** Rows are laid
 * out with `@tanstack/react-virtual`'s `useVirtualizer` — the render
 * list below `FULL_RENDER_THRESHOLD` mounts every row (so a normal
 * session behaves exactly as before this task), and only a transcript
 * that actually grows large windows down to `BOUNDED_OVERSCAN` rows
 * around the visible range, regardless of total entry count.
 *
 * A `useLayoutEffect` re-anchors the scroll position to the newest row
 * (`scrollToIndex(..., { align: "end" })`) whenever the entry count or
 * the tail entry's own identity changes (a streaming delta on the last
 * row is a new object per plan.md §7.4's delta-based-end-to-end
 * contract). It follows unconditionally the first time a transcript
 * mounts (a freshly opened session should open scrolled to its most
 * recent message, like any chat surface), and afterwards only while the
 * container's own current scroll geometry says the reader is still at or
 * near the bottom (`isNearBottom`, read fresh from the DOM at the start
 * of each anchor attempt — deliberately not tracked reactively through a
 * `scroll` listener, since this component's own `scrollToFn` dispatches
 * a synthetic `scroll` event for the virtualizer's own offset tracking
 * (see `instantScrollTo`), and a listener cannot tell that dispatch
 * apart from a genuine user gesture). Scrolling up to read earlier
 * history is therefore never overridden by a live update elsewhere in
 * the transcript.
 *
 * **Payload bounding is a separate, already-covered concern.** This
 * component only bounds what it *renders*; what the daemon *sends* on
 * resume is already bounded upstream by
 * `features/sessions/daemon-session-resume-client.ts`'s
 * `INITIAL_TIMELINE_OPTIONS` (`direction: "tail", limit: 200`) and the
 * timeline reducer's gap-backfill paging (`planGapBackfillRequest`,
 * `@picompanion/frontend-core`, `limit: 200` per page) — a long session
 * is paged on the wire, not sent whole, before this component ever sees
 * it.
 *
 * `role="log"`: an ARIA live region whose implicit `aria-live="polite"`
 * and `aria-relevant="additions"` announce newly appended messages to
 * assistive tech without re-announcing settled rows on every keystroke of
 * a streaming update (plan.md §10.5). Virtualizing this region's content
 * is an explicit, plan-sanctioned trade-off (plan.md §8.4 "virtualized
 * transcript and logs" is listed as a web-specific strength) — a row
 * scrolled far out of view is unmounted like any other virtualized list,
 * not kept alive purely for a hypothetical assistive-technology replay.
 */
export function Transcript({
  entries,
  streamingEntryId = null,
  resolveImageSrc,
  editFromHereTargets,
  onEditFromHere,
  testId,
}: TranscriptProps) {
  const renderable = useMemo(() => entries.filter(isRenderableEntry), [entries]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Becomes `true` after the first successful tail-anchor, so an
   * as-yet-unmounted transcript always opens at its most recent message
   * (see this component's doc comment) regardless of the container's
   * current — not yet meaningful — scroll geometry. */
  const hasAnchoredTailRef = useRef(false);

  const overscan =
    renderable.length <= FULL_RENDER_THRESHOLD ? Math.max(renderable.length, 1) : BOUNDED_OVERSCAN;

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: renderable.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan,
    getItemKey: (index) => renderable[index]?.id ?? `transcript-index-${index}`,
    scrollToFn: instantScrollTo,
    observeElementRect: observeElementRectWithFallback,
    measureElement: measureRowElement,
    // The default `flushSync`-on-mount path fights React 19's own commit
    // phase when the virtualizer's `_didMount` effect synchronously
    // notifies during the same `act()`/render pass that mounted it (a
    // console warning, and — worse — a first paint with zero virtual
    // items until a later tick). A plain dispatch still lands inside the
    // same batched commit; it just does not fight React for it.
    useFlushSync: false,
  });

  const lastIndex = renderable.length - 1;
  const tailEntry = lastIndex >= 0 ? renderable[lastIndex] : null;

  useLayoutEffect(() => {
    if (lastIndex < 0) {
      return;
    }
    const element = containerRef.current;
    const shouldFollow = !hasAnchoredTailRef.current || !element || isNearBottom(element);
    if (!shouldFollow) {
      return;
    }
    hasAnchoredTailRef.current = true;
    rowVirtualizer.scrollToIndex(lastIndex, { align: "end" });
    // `tailEntry` (not just `lastIndex`) is a dependency deliberately: a
    // streaming delta on the last row changes that row's object identity
    // without changing the count, and still needs to re-anchor scroll as
    // the row grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastIndex, tailEntry, rowVirtualizer]);

  if (renderable.length === 0) {
    return (
      <EmptyState
        title="No messages yet"
        description="Send a message to start the conversation."
        testId={testId}
      />
    );
  }

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      className="pc-transcript"
      role="log"
      aria-label="Conversation transcript"
      data-testid={testId}
    >
      <div className="pc-transcript__sizer" style={{ height: rowVirtualizer.getTotalSize() }}>
        {virtualItems.map((virtualRow) => {
          const entry = renderable[virtualRow.index];
          if (!entry) {
            return null;
          }
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              className="pc-transcript__row"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderEntryRow(
                entry,
                streamingEntryId,
                resolveImageSrc,
                editFromHereTargets,
                onEditFromHere,
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Transcript;
