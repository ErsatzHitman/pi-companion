/**
 * `diff` kind render model (plan.md §11.3, §11.7; T34B3) — "Unified
 * changes", the shape a review-style extension surfaces before a
 * proposed patch lands (`packages/protocol/src/fixtures/pi-ui-bridge/
 * diff.json`'s own `description`: "Unified diff view of proposed
 * changes").
 *
 * `PiUiDiffPayloadSchema` (authoritative; `packages/protocol/src/pi-ui-
 * bridge/payload.ts`) carries one `unifiedDiff` string plus optional
 * `filePath`/`language` — no pre-computed hunk/line-count structure, so
 * every add/remove count and every rendered line here is derived by
 * parsing that string, the same way `apps/web/src/features/extensions/
 * renderers/diff.tsx` (T29B3) does for its own full diff view.
 *
 * plan.md §11.3's kind table names web's treatment "full diff view" and
 * Android's "compact diff then full screen" — this module is what
 * "compact" means concretely: `buildDiffRenderModel` counts every
 * `+`/`-` line in the *entire* parsed diff (so `added`/`removed` are
 * always correct, never just the visible slice's own count) but only
 * ever hands the view the changed (`+`/`-`) lines themselves — hunk
 * headers (`@@ ... @@`), `diff --git`/`index`/`---`/`+++` metadata, and
 * unchanged context lines are parsed (so they don't get misclassified as
 * changes) but never mounted. A phone screen has far less room than a
 * browser tab for the context lines a full diff view relies on to orient
 * the reader, so the compact form drops them and leans on `DiffSummary`
 * (`ui/recipes/DiffSummary.tsx`) plus each line's own file path/title
 * for orientation instead.
 *
 * Bounded: `DEFAULT_DIFF_CHANGE_LINE_CAP` caps how many changed lines are
 * ever mounted, with a visible, named truncation notice carrying the true
 * total — mirroring `log-model.ts`'s own tail cap and its reasoning for
 * why the cap is smaller than a browser tab could get away with (a
 * bounded native list view is the scarcer resource on a phone screen).
 * 200 is chosen to match `log-model.ts`'s own default tail exactly, for
 * the same reason: this is a *compact* element, not a bounded-but-still-
 * generous browser view like the web renderer's 2000-line cap.
 *
 * Kept free of any React Native import so it is unit testable in this
 * workspace (see `status-model.ts`'s note and `../registry.test.ts`).
 */
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiPayloadForKind } from "../registry";
import { humanizeNamespace } from "./tone";

export type PiUiDiffLineKind = "add" | "remove" | "context" | "hunk" | "meta";

export interface PiUiDiffLine {
  kind: PiUiDiffLineKind;
  /** The line with its leading `+`/`-`/` ` marker stripped for `add`/`remove`/`context`; verbatim otherwise. */
  content: string;
  /** The marker character this line carried on the wire; empty for `hunk`/`meta` lines. */
  marker: "+" | "-" | " " | "";
}

/** File-metadata line prefixes that are never mistaken for a `+`/`-` change (matches the web renderer's list). */
const DIFF_META_PREFIXES = [
  "diff --git",
  "index ",
  "new file mode",
  "deleted file mode",
  "similarity index",
  "rename from",
  "rename to",
  "old mode",
  "new mode",
  "Binary files",
];

function classifyDiffLine(raw: string): PiUiDiffLine {
  if (raw.startsWith("+++ ") || raw.startsWith("--- ")) {
    return { kind: "meta", content: raw, marker: "" };
  }
  if (DIFF_META_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
    return { kind: "meta", content: raw, marker: "" };
  }
  if (raw.startsWith("@@")) {
    return { kind: "hunk", content: raw, marker: "" };
  }
  if (raw.startsWith("+")) {
    return { kind: "add", content: raw.slice(1), marker: "+" };
  }
  if (raw.startsWith("-")) {
    return { kind: "remove", content: raw.slice(1), marker: "-" };
  }
  if (raw.startsWith(" ")) {
    return { kind: "context", content: raw.slice(1), marker: " " };
  }
  // A context line with no leading space (some generators omit it on
  // blank context lines) is still context, not metadata.
  return { kind: "context", content: raw, marker: " " };
}

/** Parses a `unifiedDiff` string into one classified line per input line. Exported for tests. */
export function parseUnifiedDiffLines(unifiedDiff: string): PiUiDiffLine[] {
  if (unifiedDiff.length === 0) return [];
  return unifiedDiff.split("\n").map(classifyDiffLine);
}

export interface PiUiDiffCounts {
  added: number;
  removed: number;
}

/** `add`/`remove` totals across every parsed line — always the *full* diff, never just the bounded/visible slice. Exported for tests. */
export function countDiffLines(lines: readonly PiUiDiffLine[]): PiUiDiffCounts {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "remove") removed += 1;
  }
  return { added, removed };
}

type PiUiDiffChangeLine = PiUiDiffLine & { kind: "add" | "remove"; marker: "+" | "-" };

function isDiffChangeLine(line: PiUiDiffLine): line is PiUiDiffChangeLine {
  return line.kind === "add" || line.kind === "remove";
}

/** Cap applied to how many changed (`+`/`-`) lines are ever mounted (see module doc comment). */
export const DEFAULT_DIFF_CHANGE_LINE_CAP = 200;

export interface PiUiDiffLineModel {
  /** Changed lines have no stable identity on the wire; positional index within the visible slice. */
  key: number;
  kind: "add" | "remove";
  marker: "+" | "-";
  content: string;
}

export interface PiUiDiffRenderModel {
  title: string;
  /** `DiffSummary`'s own `path` prop — the payload's `filePath` when present, else this element's title. */
  path: string;
  added: number;
  removed: number;
  /** Always `0` — the schema carries no structured "modified" concept, matching the web renderer. */
  modified: number;
  /** Already capped to `changeLineCap` — every line here is mounted. */
  visibleChangeLines: PiUiDiffLineModel[];
  totalChangeLines: number;
  /** How many changed lines were dropped by the cap; `0` when none were. */
  hiddenCount: number;
  /** e.g. "Showing first 200 of 240 changed lines (40 more lines hidden)." Absent when nothing was hidden. */
  truncatedNotice: string | undefined;
  /** Shown instead of the line list when the diff carries no changes at all. */
  emptyText: string | undefined;
  actionsAccessibilityLabel: string;
}

export function buildDiffRenderModel(
  element: Pick<PiUiElement, "ns" | "title">,
  payload: PiUiPayloadForKind<"diff">,
  changeLineCap: number = DEFAULT_DIFF_CHANGE_LINE_CAP,
): PiUiDiffRenderModel {
  const title = element.title ?? humanizeNamespace(element.ns);
  const lines = parseUnifiedDiffLines(payload.unifiedDiff);
  const { added, removed } = countDiffLines(lines);
  const changeLines = lines.filter(isDiffChangeLine);
  const totalChangeLines = changeLines.length;
  const visible =
    totalChangeLines > changeLineCap ? changeLines.slice(0, changeLineCap) : changeLines;
  const hiddenCount = totalChangeLines - visible.length;

  return {
    title,
    path: payload.filePath ?? title,
    added,
    removed,
    modified: 0,
    visibleChangeLines: visible.map((line, index) => ({
      key: index,
      kind: line.kind,
      marker: line.marker,
      content: line.content,
    })),
    totalChangeLines,
    hiddenCount,
    truncatedNotice:
      hiddenCount > 0
        ? `Showing first ${visible.length} of ${totalChangeLines} changed lines (${hiddenCount} more ${
            hiddenCount === 1 ? "line" : "lines"
          } hidden).`
        : undefined,
    emptyText: totalChangeLines === 0 ? "No changes to show." : undefined,
    actionsAccessibilityLabel: `${title} actions`,
  };
}
