// T104 — a small, generic plan.md markdown-table parser, plus a thin
// §11.7-specific wrapper on top of it.
//
// Two sites (`fixtures/extensions/extensions.test.ts` and apps/web's
// `extension-fixture-renderers.test.tsx`, T40A2/T40A3) previously drove
// their §11.7 coverage assertions from a hand-copied list of extension
// names/UI descriptions. The list was correct on the day it was written,
// but nothing tied it back to plan.md itself: a thirteenth row added to
// §11.7's "First-class UI through bridge elements" table would fail
// nothing. This module parses that table for real, so both sites assert
// against the actual spec, not a snapshot of it.
//
// Deliberately narrow: a generic single-table extractor
// (`extractMarkdownTableAfterHeading`) plus one concrete wrapper for
// §11.7's table. This is not a general plan-parsing framework — see
// docs/issues-from-plan.md's T104 section ("do not let this grow into a
// plan-parsing framework"). T38A5 (§11.1, same wave) can reuse
// `extractMarkdownTableAfterHeading` for its own table without needing
// anything added here.
//
// Deliberately pure (markdown text in, rows out — no `node:fs`/`node:url`):
// this file is NOT a `.test.ts` file, so it is part of this package's real
// `tsc` build (`tsconfig.json`'s `include: ["src/**/*"]`, `exclude` only
// drops `src/**/*.test.ts`) and that build's `"types": []` deliberately
// excludes `@types/node`'s ambient module declarations (so no workspace's
// hoisted `@types/*` leaks into this platform-neutral package — see this
// file's sibling `../import-guard.test.ts` and `../.oxlintrc.json`), so a
// `node:fs`/`node:path`/`node:url` import here would fail `tsc` outright,
// not just look out of place. Each caller (a `*.test.ts`/`*.test.tsx` file,
// which — unlike this file — is excluded from that strict build and is
// free to use Node builtins, as `../import-guard.test.ts` and half a dozen
// other colocated tests already do) is responsible for reading plan.md off
// disk itself and handing this module the text.

/** One row of a parsed two-column markdown table. */
export type MarkdownTableRow = string[];

/**
 * Finds the markdown table immediately following the first occurrence of
 * `headingMarker` in `markdown` (the heading text itself, e.g.
 * `"**First-class UI through bridge elements:**"` — matched as a literal
 * substring, not a regex). Returns each data row (header and separator
 * rows excluded) as an array of trimmed cell strings.
 *
 * Throws — loudly, by design — when:
 * - `headingMarker` does not occur in `markdown` at all;
 * - the heading occurs but no `|`-prefixed table line follows it before
 *   other non-blank content;
 * - the line after the header is not a markdown table separator row
 *   (`| --- | --- |`);
 * - the table has a header and separator but zero data rows.
 *
 * A parser that returns `[]` on any of these is a vacuous pass dressed up
 * as rigor — worse than a hard-coded list, because it looks checked. This
 * one refuses to return an empty result silently.
 */
export function extractMarkdownTableAfterHeading(
  markdown: string,
  headingMarker: string,
): MarkdownTableRow[] {
  const headingIndex = markdown.indexOf(headingMarker);
  if (headingIndex === -1) {
    throw new Error(
      `extractMarkdownTableAfterHeading: heading ${JSON.stringify(headingMarker)} was not found in the given markdown`,
    );
  }

  const afterHeading = markdown.slice(headingIndex + headingMarker.length);
  const lines = afterHeading.split("\n");

  const tableLines: string[] = [];
  let sawTableStart = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!sawTableStart) {
      if (line === "") continue;
      if (line.startsWith("|")) {
        sawTableStart = true;
        tableLines.push(line);
        continue;
      }
      // Non-blank, non-table content appeared before any table row — the
      // heading exists but nothing that looks like a table follows it.
      break;
    }
    if (line.startsWith("|")) {
      tableLines.push(line);
    } else {
      break;
    }
  }

  if (tableLines.length === 0) {
    throw new Error(
      `extractMarkdownTableAfterHeading: heading ${JSON.stringify(headingMarker)} was found, but no markdown table (a line starting with "|") followed it`,
    );
  }

  const [headerLine, separatorLine, ...dataLines] = tableLines;
  if (headerLine === undefined || separatorLine === undefined) {
    throw new Error(
      `extractMarkdownTableAfterHeading: heading ${JSON.stringify(headingMarker)}'s table has no header/separator row pair (found ${tableLines.length} table line(s))`,
    );
  }
  if (!/^\|?[\s:|-]+\|?$/.test(separatorLine)) {
    throw new Error(
      `extractMarkdownTableAfterHeading: expected a markdown table separator row ("| --- | --- |") on the line after the header, got ${JSON.stringify(separatorLine)}`,
    );
  }
  if (dataLines.length === 0) {
    throw new Error(
      `extractMarkdownTableAfterHeading: heading ${JSON.stringify(headingMarker)}'s table has a header row but zero data rows`,
    );
  }

  return dataLines.map(splitMarkdownTableRow);
}

function splitMarkdownTableRow(line: string): MarkdownTableRow {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/** One row of plan.md §11.7's "First-class UI through bridge elements" table. */
export interface Section117BridgeElementRow {
  /** The extension name, e.g. `"loop"` (backticks stripped). */
  extension: string;
  /** The row's "Required UI" cell, verbatim. */
  requiredUi: string;
}

const SECTION_117_TABLE_HEADING = "**First-class UI through bridge elements:**";

/**
 * Parses plan.md §11.7's "First-class UI through bridge elements" table out
 * of already-loaded plan.md content. Pure — takes markdown text, not a file
 * path — so callers can also feed it a synthetic fixture (e.g. to prove it
 * throws on a missing table) without touching a filesystem.
 */
export function parseSection117BridgeElementsTable(
  planMarkdown: string,
): Section117BridgeElementRow[] {
  const rows = extractMarkdownTableAfterHeading(planMarkdown, SECTION_117_TABLE_HEADING);
  return rows.map((cells, index) => {
    const [extensionCell, requiredUiCell] = cells;
    if (extensionCell === undefined || requiredUiCell === undefined) {
      throw new Error(
        `parseSection117BridgeElementsTable: row ${index} does not have both an Extension and a Required UI cell: ${JSON.stringify(cells)}`,
      );
    }
    const match = /^`([^`]+)`$/.exec(extensionCell);
    if (!match) {
      throw new Error(
        `parseSection117BridgeElementsTable: row ${index}'s Extension cell is not wrapped in backticks: ${JSON.stringify(extensionCell)}`,
      );
    }
    return { extension: match[1]!, requiredUi: requiredUiCell };
  });
}
