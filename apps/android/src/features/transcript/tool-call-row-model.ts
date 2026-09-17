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

/**
 * The `.tchip` text for a tool's header — the one path or argument that
 * names WHAT this particular call touched, so a transcript of twenty
 * `read`s is scannable without expanding any of them.
 *
 * `undefined` for the families whose header has no such single fact
 * (`plan`'s text is the whole body, `sub_agent`'s description is a
 * sentence rather than a path, `plain_text`/`generic` carry nothing this
 * can name without guessing). A chip is drawn only when this returns a
 * non-empty string, so an absent fact simply draws no chip rather than
 * an empty box.
 */
export function toolHeaderChipLabel(tool: tools.ToolCallViewModel): string | undefined {
  switch (tool.family) {
    case "read":
    case "write":
    case "edit":
      return tool.filePath;
    case "search":
      return tool.query;
    case "fetch":
      return tool.url;
    case "shell":
      return tool.command;
    case "worktree_setup":
      return tool.branchName;
    default:
      return undefined;
  }
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
 * Whether a shell call draws the artifact's dim `.bash-dim` variant
 * rather than its green one (T359).
 *
 * Green says "this is a command that ran". A call that was cancelled,
 * or that is still blocked on a permission prompt and has therefore not
 * run at all, has produced nothing, and colouring it like a command
 * with output is the same mistake `toolBlockKind` avoids one level up
 * by refusing to colour a running call as finished.
 *
 * A FAILED command is deliberately NOT dim: it ran, it printed
 * something, and its output is the most interesting thing on the
 * screen. The card around it already carries `tool-error-bg` and a red
 * outline, so the failure is stated without dimming the one part the
 * reader came for.
 */
export function shellBlockIsDimmed(status: tools.ToolCallViewStatus): boolean {
  return status === "canceled" || status === "blocked";
}

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

// --- The `.xbtn` expand affordance (W4-TOOLBLOCK) ---
//
// android-spec.html: `.xbtn{position:absolute;right:8px;top:7px;width:26px;
// height:26px;border-radius:var(--r-full);...background:color-mix(in
// oklab,var(--ink) 9%,transparent);color:var(--ink-2);transition:transform
// .28s cubic-bezier(.34,1.56,.64,1),background .15s}` plus
// `.blk:hover .xbtn{background:color-mix(in oklab,var(--ink) 15%,
// transparent)}` and `.blk.hasx.open .xbtn,.blk[data-r]:not(.fold)
// .xbtn{transform:rotate(180deg)}`. There is no `:hover` on Android, so the
// hover step is ported as the PRESSED state instead (`tool-call-row.tsx`'s
// own doc comment says so again at the call site, where the theme is).
//
// The geometry constants (26px size, 8px/7px offset, the 11px icon, the
// hitSlop that clears the 48dp touch floor) are NOT here: they are RN
// layout literals with no meaning outside a `StyleSheet`, and
// `ui/primitives/touch-targets.test.ts` (T376) can only resolve a
// dimension it finds as a literal or a same-file `const NAME = <int>;` in
// `tool-call-row.tsx` itself — an imported identifier resolves to nothing
// there. They are pinned directly in that file instead, the same split
// `TOOL_CHIP_RADIUS`/`TOOL_CHIP_PADDING_HORIZONTAL` already use for the
// `.tchip` box below.

/**
 * `color-mix(in oklab, var(--ink) 9%, transparent)` / `... 15% ...`.
 *
 * Mixing ANY opaque colour with the `transparent` keyword in CSS Color 4
 * does not blend toward black the way naively premultiplying two RGBA
 * values would: a colour with 0% alpha is defined to carry forward the
 * OTHER colour's hue/lightness/chroma for interpolation purposes (the
 * "powerless component" rule CSS Color 4 added specifically to fix the old
 * `rgba(0,0,0,0)`-gradient grey-halo bug). The result of mixing `ink` with
 * `transparent` at a given percentage is therefore just `ink` at that
 * percentage as its ALPHA — not a flat pre-composited hex the way
 * `packages/design-tokens/src/tokens.ts`'s A-PIROLES roles are (those mix
 * two OPAQUE colours, which really does need the oklab math that file's
 * comments show). No oklab conversion is needed here; only alpha changes.
 */
export const TOOL_XBTN_BACKGROUND_ALPHA_REST = 0.09;
export const TOOL_XBTN_BACKGROUND_ALPHA_PRESSED = 0.15;

/** Parses a `#rrggbb` hex colour and returns it as an `rgba(...)` string at
 * `alpha` — the mechanism `TOOL_XBTN_BACKGROUND_ALPHA_REST`/`_PRESSED`'s
 * own doc comment describes, applied to whichever hex `theme.colors.ink`
 * resolves to for the active theme (this module never imports
 * `@picompanion/design-tokens` itself — the caller, which already has the
 * theme, supplies the hex). Never throws on a malformed input; returns the
 * input unchanged so a caller sees the mistake rather than a crash. */
export function inkOverlayColor(inkHex: string, alpha: number): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(inkHex);
  if (match === null) {
    return inkHex;
  }
  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** `transition:transform .28s cubic-bezier(.34,1.56,.64,1)` — the artifact's
 * own spring for this one control. Not `EXPRESSIVE_PRESS_SPRING_EASING`
 * (`../../ui/theme/expressive-motion.ts`'s `cubic-bezier(.34,1.7,.5,1)`,
 * checked directly and confirmed distinct — different duration, different
 * curve): that file has no matching entry today, and it is outside this
 * package's exclusive file list, so this is recorded here rather than
 * there. See this task's report for the exact addition a future task could
 * migrate into that file instead. */
export const TOOL_XBTN_ROTATION_DURATION_MS = 280;

/** `cubic-bezier(.34,1.56,.64,1)` as a plain 4-tuple, the same shape
 * `../../ui/theme/expressive-motion.ts`'s own `CubicBezier` type uses (not
 * imported — this module stays RN- and theme-free — but named the same way
 * on purpose). */
export type ToolXbtnRotationEasing = readonly [number, number, number, number];
export const TOOL_XBTN_ROTATION_EASING: ToolXbtnRotationEasing = [0.34, 1.56, 0.64, 1];

/** `.blk.hasx.open .xbtn,.blk[data-r]:not(.fold) .xbtn{transform:rotate(
 * 180deg)}` — the open/expanded rotation target; `0` is the resting,
 * collapsed angle. */
export const TOOL_XBTN_ROTATION_OPEN_DEG = 180;
export const TOOL_XBTN_ROTATION_CLOSED_DEG = 0;

/**
 * Whether a known family already has a collapsible result sitting on its
 * own view model, using only fields/helpers that already exist for that
 * family's `*Body` component in `tool-call-row.tsx` — no new field is
 * added anywhere. Only called for `running`/`blocked` calls
 * (`toolCardHasExpandButton` below never reaches this for a finished
 * status), which is exactly where "has this call already produced
 * something?" cannot be answered by status alone.
 *
 * Five families only: `read`/`write`/`edit`/`search`/`fetch` — the same
 * five families whose FINISHED (`completed`/`failed`) frames in
 * android-spec.html are the ones `toolCardHasExpandButton`'s own doc
 * comment counts as always carrying `data-r`. Every other family
 * (`shell`, `worktree_setup`, `sub_agent`, `plan`, `plain_text`) returns
 * `false` here unconditionally, unchanged from before this task — see
 * that same doc comment for why.
 */
function foldableFamilyAlreadyHasResult(tool: KnownToolCallViewModel): boolean {
  switch (tool.family) {
    case "read":
    case "write":
      return tool.content !== undefined && tool.content.length > 0;
    case "edit":
      // Reuses the same cap-aware helper `EditBody` itself calls to decide
      // whether it has a diff to draw — one owner for "does this edit have
      // a diff", not a second, possibly-disagreeing check.
      return diffLinesFor(tool) !== undefined;
    case "search":
      // Mirrors exactly what `SearchBody` itself would draw as content:
      // matched lines, a file list, or web results.
      return (
        (tool.content !== undefined && searchMatchLines(tool.content).length > 0) ||
        (tool.filePaths !== undefined && tool.filePaths.length > 0) ||
        (tool.webResults !== undefined && tool.webResults.length > 0)
      );
    case "fetch":
      return tool.result !== undefined && tool.result.length > 0;
    default:
      return false;
  }
}

/**
 * Whether a tool call's header draws the `.xbtn` affordance at all.
 *
 * android-spec.html's own evidence, re-counted directly against the file
 * rather than assumed (W5-PEND): ten `<div class="blk pend...">` frames
 * total. Exactly ONE carries `data-r`: a still-running `write` whose body
 * is already a collapsed "187 lines" summary
 * (`<div class="blk pend" data-r>`). The other NINE carry no `data-r`
 * and draw no `.xbtn` at all — a running `edit` whose frame is a bare
 * header line with no body at all, a running `read`
 * (`tsconfig.base.json`), a running `grep` search, two waiting
 * `ask_user` prompts, a running `advisor` sub-agent call, a
 * provider-retry countdown
 * (`<div class="blk pend cd" data-n="8" data-act="retry">`), the
 * auto-compaction notice, and one frame that is not a tool call at all
 * (the reasoning-effort chip row) — none of them has anything
 * resolved yet. Of those nine, the running `edit` is the one that
 * matters most to the five families below: it is an `edit` with no
 * diff yet, which is exactly the case
 * `foldableFamilyAlreadyHasResult` reports `false` for.
 *
 * Separately, every `<div class="blk ok...">`/`<div class="blk err...">`
 * frame that names a real tool (`ls`, `find`, two `read`s, three `edit`s,
 * one `peer_message`) also carries `data-r` — EIGHT such frames, with no
 * finished frame among them contradicting it. (The artifact also draws
 * `.blk.ok.hasx` frames that carry an `.xbtn` but no `data-r`: those are
 * frames shown already EXPANDED, printing their lines inline, so the
 * collapsed summary `data-r` carries has nothing to hold. They are not
 * counterexamples to the button; they are the same button, opened.) `shell`
 * (the artifact's `.bash` blocks), `worktree_setup`, `sub_agent`, `plan`
 * and `plain_text` never carry `data-r` anywhere in the artifact, in ANY
 * status, finished or not.
 *
 * So the artifact's real rule is about the RESULT, not the status word: a
 * block earns `.xbtn` once it HAS something collapsible, whether or not
 * the call itself has finished — the previous wave's status-only version
 * (`completed || failed`) was a proxy for that which held everywhere
 * except the one running-with-a-result frame above. For `completed`/
 * `failed` the proxy is exact in every evidenced case (a finished call
 * always has either real content or its `errorText` to show — see
 * `toolBodyIsVisible`'s own override for why a *failed* call's `.xbtn`
 * shows even though its body is never actually collapsed), so this keeps
 * using it there rather than re-deriving per-family content rules the
 * spec gives no reason to need. `canceled` keeps returning `false`
 * unconditionally: it is the one *finished* status that, by definition,
 * produced nothing to collapse (the artifact's own "ctrl+c aborted" frame
 * carries no tool name and no `.xbtn` either).
 *
 * `running`/`blocked` cannot use "finished" as that proxy — there is no
 * finished outcome to fall back on — so those two statuses ask the call's
 * own view model instead (`foldableFamilyAlreadyHasResult`), which is
 * what makes the one running-`write`-with-content frame get a button
 * while the running-`read`-with-nothing-yet frame beside it does not.
 *
 * `shell`/`worktree_setup`/`sub_agent`/`plan`/`plain_text` and the
 * `generic` fallback are deliberately left exactly as they were before
 * this task for EVERY status, including `running`/`blocked` (still always
 * `false` there): the spec gives zero evidence either way for changing
 * those families' `running`/`blocked` behaviour, and whether their
 * FINISHED behaviour should also stop being status-only is a separate
 * question this task's own file list does not license answering — see
 * this task's report.
 */
export function toolCardHasExpandButton(tool: tools.ToolCallViewModel): boolean {
  if (tool.status === "completed" || tool.status === "failed") {
    return true;
  }
  if (tool.status === "canceled") {
    return false;
  }
  // running | blocked — no finished outcome to lean on; ask the view
  // model itself whether a result is already there.
  return isKnownToolCall(tool) && foldableFamilyAlreadyHasResult(tool);
}

/**
 * Whether a tool call's collapsible body renders, given the caller's own
 * local `expanded` toggle state.
 *
 * android-spec.html's own words for this rule, quoted directly from its
 * "collapsed" frame label: "renderResult returns "" unless expanded or
 * errored". `failed` is therefore a standing OVERRIDE, independent of
 * `expanded` — an error result is never hidden behind the fold, even
 * while the block's own toggle is still in its collapsed default — which
 * is also why `../../ui/recipes` never re-derives this decision: the two
 * conditions are genuinely independent (a caller could press the button
 * on an already-visible error body and nothing would change), not one
 * flag standing in for the other.
 *
 * The third clause is the one that keeps this honest, and it was added at
 * the P10-W4 merge gate after the first version shipped without it: a
 * call that draws NO expand button always shows its body. Without that
 * clause `running`, `blocked` and `canceled` rendered no body and offered
 * no control to reveal one, so a running shell command's streaming output
 * became unreachable at the moment it matters most. `data-r` marks a
 * block that HAS a collapsible result, and every block carrying it
 * carries a button; a block with neither is not collapsed, it simply has
 * nothing to fold.
 *
 * W5-PEND closed the one gap the P10-W4 comment above named and
 * deliberately left open: `toolCardHasExpandButton` no longer keys off
 * `status` alone, so a still-running call whose view model already has a
 * result (android-spec.html's one `<div class="blk pend" data-r>` write
 * frame) now gets the same button, and defaults to the same collapsed
 * state, as any finished call — see that function's own doc comment for
 * the full frame count this rests on. This function's own three-clause
 * shape did not need to change to make that true: it was already asking
 * `toolCardHasExpandButton`, not `status`, for the "is there a control"
 * question.
 */
export function toolBodyIsVisible(tool: tools.ToolCallViewModel, expanded: boolean): boolean {
  return expanded || tool.status === "failed" || !toolCardHasExpandButton(tool);
}

/**
 * The design's own frame label for an expanded read reads "expanded —
 * syntax-highlighted, capped at 10 lines". This is that cap.
 */
export const HIGHLIGHT_LINE_CAP = 10;

export interface CappedHighlightLines {
  /** Already bounded to at most `cap` entries. */
  readonly visible: readonly string[];
  readonly totalLines: number;
  /** How many trailing lines were dropped by the cap; `0` when none were. */
  readonly hiddenLines: number;
  /** Same phrasing as `diffLinesFor`'s truncation notice — one wording for
   * "there is more, and here is exactly how much" across this feature,
   * rather than a second string shape for the identical idea. `undefined`
   * when nothing was hidden. */
  readonly truncatedNotice: string | undefined;
}

/** Bounds `lines` to `cap` (default `HIGHLIGHT_LINE_CAP`) entries, with a
 * visible, named truncation notice rather than a silent cut — the same
 * shape `diffLinesFor` already uses for the diff line cap, applied here to
 * the highlighted-body cap. */
export function capHighlightedLines(
  lines: readonly string[],
  cap: number = HIGHLIGHT_LINE_CAP,
): CappedHighlightLines {
  const visible = lines.length > cap ? lines.slice(0, cap) : lines.slice();
  const hiddenLines = lines.length - visible.length;
  return {
    visible,
    totalLines: lines.length,
    hiddenLines,
    truncatedNotice:
      hiddenLines > 0
        ? `Showing first ${visible.length} of ${lines.length} lines (${hiddenLines} more ${
            hiddenLines === 1 ? "line" : "lines"
          } hidden).`
        : undefined,
  };
}

/** The `.xbtn`'s `aria-label`, which the design flips between the two
 * states it announces — `accessibilityLabel` on Android plays the
 * identical role. */
export function toolExpandButtonAccessibilityLabel(expanded: boolean): "Expand" | "Collapse" {
  return expanded ? "Collapse" : "Expand";
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
