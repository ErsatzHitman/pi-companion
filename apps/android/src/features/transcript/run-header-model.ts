/**
 * Run header — view model (W4-RUNFOLD; plan.md §9.3, §10.4, §10.5).
 *
 * Every turn `.t` in the confirmed Android design opens with a small
 * tappable row — `.runhead` — that summarises the run and, on tap,
 * collapses the whole turn to that one line. Quoted verbatim from the
 * design's own committed CSS:
 *
 *   .runhead { display:inline-flex; align-items:center; gap:6px;
 *              margin:4px 0 0; padding:4px 6px; border-radius:8px;
 *              font:12.5px/1 Inter,system-ui,sans-serif; color:var(--ink-2);
 *              font-variant-numeric:tabular-nums }
 *   .thead:hover, .runhead:hover { background:var(--hover) }
 *   .runhead svg { transition:transform .2s }
 *   .t.runfold .runhead svg { transform:rotate(-90deg) }
 *   .t.runfold>.blk, .t.runfold>.lbl { display:none }
 *
 * and its own interaction script, `runheadTap`, quoted verbatim:
 *
 *   function runheadTap(h){
 *    const t=h.parentElement, on=t.classList.toggle('runfold');
 *    if(!h.dataset.txt) h.dataset.txt=h.querySelector('span').textContent;
 *    h.querySelector('span').textContent=on?h.dataset.txt+' · hidden':h.dataset.txt;
 *    say(on?'Run collapsed to its header':'Run expanded');
 *   }
 *
 * This module is PURE — no React, no `react-native` — mirroring every
 * other `*-model.ts` in this directory (`header-model.ts`,
 * `thinking-row-model.ts`, `tool-call-row-model.ts`, …): it owns the
 * summary string, the collapsed suffix, the announced sentence, the
 * pluralisation, and the chevron's two rotation angles. `RunHeader.tsx`
 * is a thin native view over it.
 *
 * ## The separator is a middle dot, not a dash
 *
 * The design's own sample text, `<span>6 tool calls · 1 message</span>`,
 * and `runheadTap`'s own `' · hidden'` suffix both use the same
 * character. Read directly out of the design's raw bytes (not assumed
 * from how a dash-shaped mojibake artifact might render in a lossy
 * terminal): it is U+00B7 MIDDLE DOT, surrounded by one space on each
 * side — never a hyphen, en dash or em dash. `RUN_HEADER_SEPARATOR` below
 * is that exact three-character string, and both `buildRunHeaderSummary`
 * and `buildRunHeaderDisplayText` join with it.
 *
 * ## What a "tool call" and a "message" count
 *
 * The run collapses everything BELOW the turn's own user prompt — the
 * assistant's tool-call blocks and its own reply text — never the
 * user's message itself, which stays visible outside the fold the same
 * way the design's chat convention keeps every prompt on screen. So the
 * count is derived from `TranscriptEntry.kind`: `"tool-call"` entries are
 * tool calls, `"assistant-message"` entries are messages. `"user-message"`
 * and `"thinking"` entries in the same run are deliberately not counted
 * here — the former is the prompt the run answers, never part of what
 * folds away; the latter already has its own disclosure
 * (`ThinkingSection`/`thinking-row.tsx`) and is not summarised a second
 * time by this header.
 *
 * ## Zero tool calls never reads "0 tool calls"
 *
 * A run's summary omits a zero-valued clause entirely rather than
 * printing it: a run with only a reply and no tool use reads "1 message",
 * not "0 tool calls · 1 message" — the same "never print a zero count
 * clause" shape a reader would expect from any natural-language count
 * sentence. The one edge no real run should ever reach — both counts
 * zero — still cannot be allowed to fall through to an empty string
 * (a tappable row with no visible label), so it reads the named
 * `RUN_HEADER_EMPTY_SUMMARY` constant instead. See
 * `run-header-model.test.ts`'s "never reads 0 tool calls" suite for the
 * pinned proof.
 */
/**
 * The minimal shape this module needs of a run's entries — deliberately
 * generic over `timeline.TranscriptEntry` (only `kind` is read), the same
 * "smallest shape a module actually uses" convention
 * `transcript-window-model.ts`'s `TranscriptWindowEntry` already
 * establishes for this directory.
 */
export interface RunHeaderEntry {
  readonly kind: string;
}

export interface RunHeaderCounts {
  readonly toolCallCount: number;
  readonly messageCount: number;
}

/**
 * Counts a run's own tool calls and assistant messages from its real
 * entries — see this module's doc comment for exactly which
 * `TranscriptEntry.kind` values count and which are deliberately
 * excluded.
 */
export function countRunHeaderEntries(entries: readonly RunHeaderEntry[]): RunHeaderCounts {
  let toolCallCount = 0;
  let messageCount = 0;
  for (const entry of entries) {
    if (entry.kind === "tool-call") {
      toolCallCount += 1;
    } else if (entry.kind === "assistant-message") {
      messageCount += 1;
    }
  }
  return { toolCallCount, messageCount };
}

/** U+00B7 MIDDLE DOT, with one space on each side — see this module's doc
 * comment for how this was read out of the design's raw bytes rather
 * than assumed. Joins both the summary's own clauses ("6 tool calls · 1
 * message") and the collapsed suffix ("… · hidden"). */
export const RUN_HEADER_SEPARATOR = " · ";

/** `runheadTap`'s own literal collapsed-suffix word. */
export const RUN_HEADER_HIDDEN_SUFFIX = "hidden";

/** The one summary a run with no tool calls and no messages reads —
 * never "0 tool calls · 0 messages". See this module's doc comment. */
export const RUN_HEADER_EMPTY_SUMMARY = "Empty run";

/** `runheadTap`'s own two `say(...)` sentences, quoted verbatim. */
export const RUN_HEADER_COLLAPSE_ANNOUNCEMENT = "Run collapsed to its header";
export const RUN_HEADER_EXPAND_ANNOUNCEMENT = "Run expanded";

/** `.t.runfold .runhead svg{transform:rotate(-90deg)}`. */
export const RUN_HEADER_CHEVRON_COLLAPSED_ROTATION_DEG = -90;
/** The chevron's resting angle — the design draws no rotation at all
 * (`transform` is only set inside the `.runfold` rule), i.e. 0deg. */
export const RUN_HEADER_CHEVRON_EXPANDED_ROTATION_DEG = 0;

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The count sentence itself, e.g. `"6 tool calls · 1 message"` — the
 * design's own sample, pinned exactly by
 * `run-header-model.test.ts`. Never the collapsed suffix; see
 * `buildRunHeaderDisplayText` for that.
 */
export function buildRunHeaderSummary(counts: RunHeaderCounts): string {
  const parts: string[] = [];
  if (counts.toolCallCount > 0) {
    parts.push(pluralize(counts.toolCallCount, "tool call", "tool calls"));
  }
  if (counts.messageCount > 0) {
    parts.push(pluralize(counts.messageCount, "message", "messages"));
  }
  if (parts.length === 0) {
    return RUN_HEADER_EMPTY_SUMMARY;
  }
  return parts.join(RUN_HEADER_SEPARATOR);
}

/**
 * The text the row actually shows: `summary` unchanged while expanded,
 * or `summary` plus `runheadTap`'s own `' · hidden'` suffix while
 * collapsed — exactly the `h.dataset.txt+' · hidden'` the design's script
 * performs, quoted in this module's doc comment.
 */
export function buildRunHeaderDisplayText(summary: string, collapsed: boolean): string {
  return collapsed ? `${summary}${RUN_HEADER_SEPARATOR}${RUN_HEADER_HIDDEN_SUFFIX}` : summary;
}

/** `runheadTap`'s own `say(on?'Run collapsed to its header':'Run expanded')`. */
export function runHeaderAnnouncement(collapsed: boolean): string {
  return collapsed ? RUN_HEADER_COLLAPSE_ANNOUNCEMENT : RUN_HEADER_EXPAND_ANNOUNCEMENT;
}

export interface RunHeaderViewModel {
  /** The bare count sentence, never the "hidden" suffix. */
  readonly summaryText: string;
  /** What the row's own `<span>` shows — `summaryText`, or that plus the
   * collapsed suffix. */
  readonly displayText: string;
  /** `runheadTap`'s own announced sentence for the CURRENT `collapsed`
   * value passed in — i.e. what a tap that just produced this state
   * would have announced. */
  readonly announcement: string;
  /** One combined sentence for the live-region label: `displayText` (so
   * a reader landing on the control for the first time hears what it
   * shows) followed by `announcement` — the same "one sentence covers
   * both the resting content and the state" shape
   * `header-model.ts`'s `buildTranscriptHeaderViewModel` already uses for
   * this feature's other live region. */
  readonly accessibilityLabel: string;
  readonly chevronRotationDeg: number;
}

export function buildRunHeaderViewModel(
  entries: readonly RunHeaderEntry[],
  collapsed: boolean,
): RunHeaderViewModel {
  const summaryText = buildRunHeaderSummary(countRunHeaderEntries(entries));
  const displayText = buildRunHeaderDisplayText(summaryText, collapsed);
  const announcement = runHeaderAnnouncement(collapsed);
  return {
    summaryText,
    displayText,
    announcement,
    accessibilityLabel: `${displayText}. ${announcement}.`,
    chevronRotationDeg: collapsed
      ? RUN_HEADER_CHEVRON_COLLAPSED_ROTATION_DEG
      : RUN_HEADER_CHEVRON_EXPANDED_ROTATION_DEG,
  };
}
