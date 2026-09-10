/**
 * `tool-call` transcript entry — render model (T33A4; plan.md §11.1, §11.6).
 *
 * Mirrors `apps/web/src/features/transcript/tool-call-row.tsx`'s pure
 * helpers one for one where the concept transfers (status text/tone,
 * duration formatting, edit-diff derivation, bounded-text truncation) so a
 * fixture that renders one tool-call card on web renders the equivalent
 * card here. Kept free of any React or React Native import (this
 * directory's established pattern — see `./message-row-model.ts`'s and
 * `./thinking-row-model.ts`'s doc comments for the identical reasoning),
 * so it is unit-testable under this workspace's plain `vitest` setup
 * without an emulator. `tool-call-row.tsx` is a thin native view over this
 * module.
 *
 * **The one deliberate difference from web**: the safe generic card here
 * does not just bound and stringify `GenericToolCallViewModel.collapsibleInput`
 * / `.result` — it *redacts* key- and value-shaped secrets first
 * (`redactValue`/`boundedRedactedSummary`). §11.6's generic-card bullets
 * ("collapsible validated input … result or error") are satisfied by a
 * redacted, bounded summary rather than a verbatim dump: an arbitrary
 * plugin's arguments may legitimately carry paths, tokens, or file
 * contents that should never land in a transcript row unredacted, so this
 * is a stricter bar than the "already JSON-safe, just bound the length"
 * treatment `collapsibleInput` gets on web today.
 */
import { security, type timeline, type tools } from "@picompanion/frontend-core";

import {
  DEFAULT_DIFF_CHANGE_LINE_CAP,
  countDiffLines,
  parseUnifiedDiffLines,
} from "../extensions/renderers/diff-model";
// Imported from the model module directly, never through
// `../../ui/recipes`'s barrel: that barrel re-exports `.tsx` files,
// and pulling React Native into this module would make it
// unloadable under this workspace's plain `vitest` setup — the
// whole reason the logic lives in an RN-free model in the first
// place.
import { toneForDiffKind, type DiffLineInput } from "../../ui/recipes/diff-lines-model";

export type ToolCallTranscriptEntry = Extract<timeline.TranscriptEntry, { kind: "tool-call" }>;

export function isToolCallEntry(entry: timeline.TranscriptEntry): entry is ToolCallTranscriptEntry {
  return entry.kind === "tool-call";
}

/** Filters a mixed `TranscriptEntry[]` down to the rows this component
 * renders, mirroring `message-row.tsx`'s `filterCoreMessageEntries` and
 * `thinking-row.tsx`'s `filterThinkingEntries`. */
export function filterToolCallEntries(
  entries: readonly timeline.TranscriptEntry[],
): ToolCallTranscriptEntry[] {
  return entries.filter(isToolCallEntry);
}

/**
 * Visible status text (plan.md §11.6/§10.5 acceptance: "tool status is
 * conveyed in text as well as colour" — colour, via `STATUS_TONE` below,
 * is never the only carrier). Byte-for-byte the same wording as web's
 * `STATUS_TEXT` (`apps/web/src/features/transcript/tool-call-row.tsx`).
 */
export const STATUS_TEXT: Record<tools.ToolCallViewStatus, string> = {
  running: "Running",
  blocked: "Waiting for approval",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

export function statusTextFor(status: tools.ToolCallViewStatus): string {
  return STATUS_TEXT[status];
}

export type ToolStatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/** Same tone mapping as web's `STATUS_TONE` — the colour half of the
 * text-and-colour pairing `StatusIndicator` renders both halves of. */
export const STATUS_TONE: Record<tools.ToolCallViewStatus, ToolStatusTone> = {
  running: "info",
  blocked: "warning",
  completed: "success",
  failed: "danger",
  canceled: "neutral",
};

export const MAX_BODY_CHARS = 4000;
export const BODY_TRUNCATION_SUFFIX = "\n\n… (truncated for display)";

/** Bounds arbitrary display text (shell output, file content, logs) to
 * `MAX_BODY_CHARS`, leaving a visible truncation note rather than either
 * freezing the row on a pathological payload or silently dropping the
 * rest — same bound/suffix shape as `thinking-row-model.ts`'s `truncate`. */
export function truncateBody(text: string, max: number = MAX_BODY_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - BODY_TRUNCATION_SUFFIX.length))}${BODY_TRUNCATION_SUFFIX}`;
}

export function formatToolDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Card-selection logic (plan.md §11.6): which family of purpose-built
 * card a call renders as. Trivially `tool.family` today, but named and
 * exported so the .tsx never re-derives "which card" logic of its own —
 * every branch it takes is traceable to this one function.
 */
export type ToolCardKind = tools.ToolCallViewModel["family"];

export function cardKindFor(tool: tools.ToolCallViewModel): ToolCardKind {
  return tool.family;
}

export type KnownToolCallViewModel = Exclude<
  tools.ToolCallViewModel,
  tools.GenericToolCallViewModel
>;

/** True for every family `buildToolCallViewModel` recognizes
 * (`tools.KNOWN_TOOL_CALL_FAMILIES`); false only for the safe generic
 * fallback. */
export function isKnownToolCall(tool: tools.ToolCallViewModel): tool is KnownToolCallViewModel {
  return tool.family !== "generic";
}

// --- Edit family: diff derivation (mirrors web's tool-call-row.tsx) ---
//
// T33A5: counting and classifying `+`/`-` lines is not re-derived here —
// `parseUnifiedDiffLines`/`countDiffLines`
// (`../extensions/renderers/diff-model.ts`, T34B3) already parse a
// unified-diff string into classified lines and reduce them to
// added/removed totals; this module only supplies the diff *text*
// (verbatim, or synthesized from `edits`) and reuses those two functions
// rather than re-parsing `+`/`-` markers a second time.

export function resolvedEdits(
  tool: tools.EditToolCallViewModel,
): ReadonlyArray<{ oldString: string; newString: string }> {
  return (
    tool.edits ??
    (tool.oldString !== undefined || tool.newString !== undefined
      ? [{ oldString: tool.oldString ?? "", newString: tool.newString ?? "" }]
      : [])
  );
}

function syntheticDiffText(edits: ReadonlyArray<{ oldString: string; newString: string }>): string {
  return edits
    .map(({ oldString, newString }) => {
      const removed = oldString ? oldString.split("\n").map((line) => `-${line}`) : [];
      const added = newString ? newString.split("\n").map((line) => `+${line}`) : [];
      return [...removed, ...added].join("\n");
    })
    .join("\n");
}

/** The raw diff text a card would render before bounding — either the
 * call's own `unifiedDiff`, or one synthesized from `edits`/`oldString`+
 * `newString` when no unified string was built. `undefined` when there is
 * nothing to show at all (no `unifiedDiff` and no edits). */
function diffSourceText(tool: tools.EditToolCallViewModel): string | undefined {
  const edits = resolvedEdits(tool);
  return tool.unifiedDiff ?? (edits.length > 0 ? syntheticDiffText(edits) : undefined);
}

/** Add/remove totals for the compact `DiffSummary` badge's mono tabular
 * figures (plan.md §10.4/§11.6) — always computed over the *full* diff
 * text, never the bounded/visible slice `diffLinesFor` returns, so the
 * badge stays correct even when the line list beneath it is truncated.
 * Delegates to T34B3's shared parser (`countDiffLines`/
 * `parseUnifiedDiffLines`) rather than re-counting `+`/`-` markers. */
export function diffCounts(tool: tools.EditToolCallViewModel): { added: number; removed: number } {
  const text = diffSourceText(tool);
  if (text === undefined) {
    return { added: 0, removed: 0 };
  }
  return countDiffLines(parseUnifiedDiffLines(text));
}

/** Ceiling on how many diff-text lines (including any `@@`/`---`/`+++`
 * header and context lines the raw diff text carries — this counts
 * *lines rendered*, a broader set than `diff-model.ts`'s own
 * changed-line-only cap) one edit card ever mounts in its `CodeBlock`.
 * Reuses T34B3's `DEFAULT_DIFF_CHANGE_LINE_CAP` value (200) rather than
 * picking an unrelated number, so a diff of the same rough size renders
 * the same rough length everywhere in this app; see that module's doc
 * comment for why 200 (not web's more generous 2000-line cap) is right
 * for a bounded native list view on a phone screen. */
export const DIFF_LINE_CAP = DEFAULT_DIFF_CHANGE_LINE_CAP;

export interface DiffLinesModel {
  /** Already bounded to `DIFF_LINE_CAP` lines — every line here is
   * mounted, verbatim (including any leading `+`/`-`/` ` marker). */
  text: string;
  totalLines: number;
  visibleLines: number;
  /** How many trailing lines were dropped by the cap; `0` when none were. */
  hiddenLines: number;
  /** e.g. "Showing first 200 of 240 diff lines (40 more lines hidden)."
   * `undefined` when nothing was hidden — this is the *visible, named*
   * truncation notice (never a silent cut) `EditBody` renders as its own
   * line beneath the `CodeBlock`. */
  truncatedNotice: string | undefined;
}

/** The diff lines a card should render, bounded by `DIFF_LINE_CAP` with a
 * visible, named truncation notice rather than either freezing the row on
 * a pathological diff or cutting it off with no indication.
 * `undefined` when there is nothing to show at all (mirrors the old
 * `diffTextFor`'s `undefined` case). Tested at the exact boundary
 * (`DIFF_LINE_CAP` lines: untruncated; `DIFF_LINE_CAP + 1`: truncated by
 * exactly one line) in `tool-call-row-model.test.ts`. */
export function diffLinesFor(tool: tools.EditToolCallViewModel): DiffLinesModel | undefined {
  const text = diffSourceText(tool);
  if (text === undefined) {
    return undefined;
  }
  const allLines = text.split("\n");
  const visible = allLines.length > DIFF_LINE_CAP ? allLines.slice(0, DIFF_LINE_CAP) : allLines;
  const hiddenLines = allLines.length - visible.length;
  return {
    text: visible.join("\n"),
    totalLines: allLines.length,
    visibleLines: visible.length,
    hiddenLines,
    truncatedNotice:
      hiddenLines > 0
        ? `Showing first ${visible.length} of ${allLines.length} diff lines (${hiddenLines} more ${
            hiddenLines === 1 ? "line" : "lines"
          } hidden).`
        : undefined,
  };
}

// --- Search family ---

/** The compact "N files, M matches[, truncated]" meta line, or
 * `undefined` when the call carries neither count. */
/**
 * The same bounded slice `diffLinesFor` returns, classified into the
 * redesign's own `.dl add|rem|ctx` bands (T358).
 *
 * Built on top of `diffLinesFor` rather than beside it so there is one
 * cap and one truncation notice: two independent bounds on the same
 * diff would eventually disagree, and the notice would then be
 * describing a slice the reader is not looking at.
 *
 * `hunk` and `meta` lines are dropped rather than given a tone.
 * `@@ -1,4 +1,6 @@` and `--- a/Button.tsx` both begin with a marker
 * character, and colouring a file path as a deletion is worse than not
 * showing the header at all — `DiffSummary` above the list already
 * names the file and the counts.
 */
export function diffLineInputsFor(tool: tools.EditToolCallViewModel): DiffLineInput[] {
  const model = diffLinesFor(tool);
  if (model === undefined) {
    return [];
  }
  const inputs: DiffLineInput[] = [];
  parseUnifiedDiffLines(model.text).forEach((line, index) => {
    const tone = toneForDiffKind(line.kind);
    if (tone === null) return;
    inputs.push({
      key: String(index),
      tone,
      marker: line.marker === "" ? " " : line.marker,
      content: line.content,
    });
  });
  return inputs;
}

/** How many matched lines a search card shows before it stops. */
export const SEARCH_MATCH_LINE_CAP = 20;

/**
 * The matched lines a search card highlights, bounded (T358).
 *
 * A grep result arrives as one blob of text in `content`; the redesign
 * draws each line separately so the query can be marked inside it
 * (`mark.hit`). Blank lines are dropped — a highlighted empty row is
 * just a gap the reader has to account for — and the whole list is
 * capped, because `truncateBody`'s 4000-character bound still allows
 * hundreds of lines and this list sits inside a transcript that is
 * already scrolling.
 */
export function searchMatchLines(content: string, cap: number = SEARCH_MATCH_LINE_CAP): string[] {
  return content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(0, cap);
}

export function searchCountsLine(tool: tools.SearchToolCallViewModel): string | undefined {
  const parts = [
    tool.numFiles !== undefined ? `${tool.numFiles} files` : null,
    tool.numMatches !== undefined ? `${tool.numMatches} matches` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(", ");
}

// --- Worktree-setup family ---

export type WorktreeCommandStepStatus = "complete" | "active" | "upcoming" | "error";

const WORKTREE_COMMAND_STEP_STATUS: Record<
  tools.WorktreeSetupCommandView["status"],
  WorktreeCommandStepStatus
> = {
  running: "active",
  completed: "complete",
  failed: "error",
};

export function worktreeCommandStepStatus(
  status: tools.WorktreeSetupCommandView["status"],
): WorktreeCommandStepStatus {
  return WORKTREE_COMMAND_STEP_STATUS[status];
}

// --- The safe generic card: redaction + bounded summaries ---

/**
 * Secret-shaped key/value detection is centralized in
 * `@picompanion/frontend-core`'s `security` domain (T60A) — this module
 * no longer keeps its own pattern list. See `packages/frontend-core/src/
 * security/secret-shape.ts`'s doc comment for what "secret-shaped" means
 * here, and for the "defence in depth, not a security boundary" caveat
 * that applies to every redaction this file performs.
 */

const REDACTED = "[redacted]";
const MAX_REDACT_DEPTH = 6;
const MAX_ARRAY_ITEMS = 20;

/**
 * Recursively redacts secret-shaped strings from an arbitrary JSON-safe
 * value, by key name or by value shape (`security.isSecretShaped`,
 * `@picompanion/frontend-core`) — whichever hint is present. Never throws:
 * an unexpected shape (a class instance, a `Map`, a value with a
 * `toJSON` that throws) degrades to a placeholder string rather than
 * propagating. Bounded to `MAX_REDACT_DEPTH`/`MAX_ARRAY_ITEMS` so a
 * pathological or cyclical-looking (but JSON-safe, already-cloned) input
 * cannot walk forever.
 */
export function redactValue(value: unknown, keyHint?: string, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) {
    return "[max depth exceeded]";
  }
  if (typeof value === "string") {
    if (security.isSecretShaped(value, keyHint)) {
      return REDACTED;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const bounded = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactValue(item, keyHint, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      bounded.push(`… ${value.length - MAX_ARRAY_ITEMS} more items not shown`);
    }
    return bounded;
  }
  if (value !== null && typeof value === "object") {
    try {
      const entries = Object.entries(value as Record<string, unknown>);
      const out: Record<string, unknown> = {};
      for (const [key, entryValue] of entries) {
        out[key] = redactValue(entryValue, key, depth + 1);
      }
      return out;
    } catch {
      return "[unable to inspect]";
    }
  }
  // number | boolean | null | undefined | bigint | symbol | function — none
  // of these can carry a secret string, and every one is either
  // JSON-serializable as-is or intentionally omitted by JSON.stringify.
  return value;
}

export const MAX_PAYLOAD_CHARS = 2000;

/** Redacts, then JSON-stringifies and bounds, an arbitrary payload —
 * the one function every generic-card summary goes through, so no path
 * to that card can hand a caller the raw value. Never throws. */
export function boundedRedactedSummary(value: unknown, max: number = MAX_PAYLOAD_CHARS): string {
  if (value === undefined) {
    return "(none)";
  }
  let redacted: unknown;
  try {
    redacted = redactValue(value);
  } catch {
    return "(unable to display this payload)";
  }
  let text: string;
  try {
    text = JSON.stringify(redacted, null, 2) ?? "(none)";
  } catch {
    return "(unable to display this payload)";
  }
  return truncateBody(text, max);
}

/** The generic card's "Input" panel content — always redacted and
 * bounded, never `tool.collapsibleInput` verbatim. */
export function genericInputSummary(tool: tools.GenericToolCallViewModel): string {
  return boundedRedactedSummary(tool.collapsibleInput);
}

/** The generic card's "Result"/"Error" panel content — `rawError` for a
 * failed call, `result` otherwise, both redacted and bounded. */
export function genericResultSummary(tool: tools.GenericToolCallViewModel): string {
  return boundedRedactedSummary(tool.status === "failed" ? tool.rawError : tool.result);
}

/** The generic card's identifying meta line: "Unrecognized tool from
 * <source>: <toolName>", or without the source clause when none was
 * detected — mirrors web's identical sentence. */
export function unrecognizedToolMeta(tool: tools.GenericToolCallViewModel): string {
  return `Unrecognized tool${tool.source ? ` from ${tool.source}` : ""}: ${tool.toolName}`;
}

export interface TranscriptToolCallRowProps {
  entry: ToolCallTranscriptEntry;
  testId?: string;
}

/** Wraps `TranscriptToolCallRow` in `memo` so a live streaming update to
 * one call does not re-render every already-settled tool-call row already
 * in the list — same comparator shape as `message-row-model.ts`'s
 * `areMessageRowPropsEqual` and `thinking-row-model.ts`'s
 * `areThinkingRowPropsEqual`, compared by value on the one field that
 * actually changes across an upsert (`tool`). */
export function areToolCallRowPropsEqual(
  previous: TranscriptToolCallRowProps,
  next: TranscriptToolCallRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.testId === next.testId &&
    JSON.stringify(previous.entry.tool) === JSON.stringify(next.entry.tool)
  );
}
