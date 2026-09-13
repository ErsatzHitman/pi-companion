/**
 * Transcript search model — plain-text find over transcript entries.
 *
 * A minimal, honest slice: case-insensitive-by-default substring search
 * over the visible text of every `TranscriptEntry`, reporting one match
 * per occurrence (entry identity plus offsets into that entry's
 * searchable text), plus the tiny pure navigation helpers (`next`/`prev`
 * with wrap) and the one count label both apps render. No regex, no
 * filters, no persistence — anything beyond plain-text find is a later
 * task, not a hidden option here.
 *
 * Deliberately stateless and pure (same convention as
 * `./transcript-view.ts`): matching is a fresh scan of its input, and
 * the reader's query/cursor position stays host state (`apps/web` holds
 * it in `transcript.tsx`, `apps/android` in
 * `transcript-search-model.ts`), so both platforms navigate the same
 * match list the same way.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
import type { ToolCallViewModel } from "../tools/types.js";
import { transcriptEntryListKey } from "./transcript-view.js";
import type { TranscriptEntry } from "./transcript-view.js";

export interface TranscriptSearchOptions {
  /**
   * Match case-sensitively. Default `false`: the query and every entry's
   * searchable text are compared lowercased. Positions are still reported
   * against the entry's own searchable text — lowercasing only affects
   * comparison, except for the rare script where it changes string
   * length, where an offset may point one code unit off.
   */
  readonly caseSensitive?: boolean;
}

/** One occurrence of the query inside one entry's searchable text. */
export interface TranscriptSearchMatch {
  /** Same identity as the source entry's `id`. */
  readonly entryId: string;
  /**
   * The entry's stable renderer-facing list key
   * (`transcriptEntryListKey`) — what a virtualized/windowed list uses
   * to scroll to this match, since it keys rows by this, never by index.
   */
  readonly entryKey: string;
  /** Index of the entry in the array that was searched. */
  readonly entryIndex: number;
  /** Offset of this occurrence within the entry's searchable text. */
  readonly start: number;
  /** Always `query.length` — plain-text search matches the whole query. */
  readonly length: number;
}

function pushText(parts: string[], value: unknown): void {
  if (typeof value === "string" && value.length > 0) {
    parts.push(value);
  } else if (typeof value === "number" && Number.isFinite(value)) {
    parts.push(String(value));
  }
}

function toolCallSearchableText(tool: ToolCallViewModel): string {
  const parts: string[] = [];
  pushText(parts, tool.toolName);
  pushText(parts, tool.displayName);
  pushText(parts, tool.summary);
  pushText(parts, tool.errorText);
  switch (tool.family) {
    case "shell":
      pushText(parts, tool.command);
      pushText(parts, tool.cwd);
      pushText(parts, tool.output);
      pushText(parts, tool.exitCode);
      break;
    case "read":
      pushText(parts, tool.filePath);
      pushText(parts, tool.content);
      pushText(parts, tool.offset);
      pushText(parts, tool.limit);
      break;
    case "edit":
      pushText(parts, tool.filePath);
      pushText(parts, tool.oldString);
      pushText(parts, tool.newString);
      pushText(parts, tool.unifiedDiff);
      for (const edit of tool.edits ?? []) {
        pushText(parts, edit.oldString);
        pushText(parts, edit.newString);
      }
      break;
    case "write":
      pushText(parts, tool.filePath);
      pushText(parts, tool.content);
      break;
    case "search":
      pushText(parts, tool.query);
      pushText(parts, tool.searchToolName);
      pushText(parts, tool.content);
      for (const filePath of tool.filePaths ?? []) {
        pushText(parts, filePath);
      }
      for (const result of tool.webResults ?? []) {
        pushText(parts, result.title);
        pushText(parts, result.url);
      }
      for (const annotation of tool.annotations ?? []) {
        pushText(parts, annotation);
      }
      pushText(parts, tool.numFiles);
      pushText(parts, tool.numMatches);
      break;
    case "fetch":
      pushText(parts, tool.url);
      pushText(parts, tool.prompt);
      pushText(parts, tool.result);
      pushText(parts, tool.code);
      pushText(parts, tool.codeText);
      break;
    case "worktree_setup":
      pushText(parts, tool.worktreePath);
      pushText(parts, tool.branchName);
      pushText(parts, tool.log);
      for (const command of tool.commands) {
        pushText(parts, command.command);
        pushText(parts, command.cwd);
        pushText(parts, command.log);
      }
      break;
    case "sub_agent":
      pushText(parts, tool.subAgentType);
      pushText(parts, tool.description);
      pushText(parts, tool.childSessionId);
      pushText(parts, tool.log);
      for (const action of tool.actions ?? []) {
        pushText(parts, action.toolName);
        pushText(parts, action.summary);
      }
      break;
    case "plan":
      pushText(parts, tool.text);
      break;
    case "plain_text":
      pushText(parts, tool.label);
      pushText(parts, tool.text);
      break;
    case "generic":
      pushText(parts, tool.source);
      pushText(parts, tool.copyPayload);
      pushText(parts, tool.reportPayload.reason);
      pushText(parts, tool.reportPayload.status);
      pushText(parts, tool.reportPayload.toolName);
      pushText(parts, tool.reportPayload.rawDetailType);
      break;
  }
  return parts.join("\n");
}

/**
 * The plain text `findTranscriptSearchMatches` scans for one entry: the
 * same words a reader sees in that row. An `extension-snapshot` entry
 * has no stable text of its own (it renders a live extension element,
 * not a string), so it contributes nothing and never matches — stated
 * here rather than discovered by surprise. An `unknown` entry
 * contributes only its `rawType`, so a reader can still find the
 * forward-compatibility fallback row itself, never its raw payload.
 */
export function extractTranscriptSearchableText(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case "user-message":
    case "assistant-message":
    case "thinking":
      return entry.text;
    case "error":
      return entry.message;
    case "todo":
      return entry.items.map((item) => item.text).join("\n");
    case "tool-call":
      return toolCallSearchableText(entry.tool);
    case "compaction": {
      const parts: string[] = [];
      pushText(parts, entry.status);
      pushText(parts, entry.trigger);
      pushText(parts, entry.summary);
      pushText(parts, entry.preTokens);
      pushText(parts, entry.estimatedTokensAfter);
      for (const file of entry.filesRead ?? []) {
        pushText(parts, file);
      }
      for (const file of entry.filesModified ?? []) {
        pushText(parts, file);
      }
      return parts.join("\n");
    }
    case "extension-snapshot":
      return "";
    case "unknown":
      return entry.rawType;
  }
}

/**
 * Finds every non-overlapping occurrence of `query` across `entries` in
 * order: entries in source order, occurrences within an entry in text
 * order. An empty query matches nothing (a blank search box is "not
 * searching", not "everything matches"). Pure: the same entries and
 * query always produce the same matches.
 */
export function findTranscriptSearchMatches(
  entries: readonly TranscriptEntry[],
  query: string,
  options: TranscriptSearchOptions = {},
): TranscriptSearchMatch[] {
  if (query.length === 0) {
    return [];
  }
  const caseSensitive = options.caseSensitive === true;
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TranscriptSearchMatch[] = [];
  entries.forEach((entry, entryIndex) => {
    const text = extractTranscriptSearchableText(entry);
    if (text.length === 0) {
      return;
    }
    const haystack = caseSensitive ? text : text.toLowerCase();
    let from = 0;
    for (;;) {
      const start = haystack.indexOf(needle, from);
      if (start < 0) {
        return;
      }
      matches.push({
        entryId: entry.id,
        entryKey: transcriptEntryListKey(entry),
        entryIndex,
        start,
        length: query.length,
      });
      from = start + Math.max(1, needle.length);
    }
  });
  return matches;
}

/** Distinct entries that hold at least one match — the "N entries" half
 * of a result summary, alongside `matches.length`'s occurrence count. */
export function countTranscriptSearchMatchedEntries(matches: readonly TranscriptSearchMatch[]): number {
  let count = 0;
  let lastKey: string | null = null;
  for (const match of matches) {
    if (match.entryKey !== lastKey) {
      count += 1;
      lastKey = match.entryKey;
    }
  }
  return count;
}

/**
 * Next match index with wrap (`-1`, "no current match", starts at the
 * first match). Returns `-1` when there is nothing to navigate to.
 */
export function nextTranscriptSearchIndex(currentIndex: number, totalCount: number): number {
  if (totalCount <= 0) {
    return -1;
  }
  if (currentIndex < 0) {
    return 0;
  }
  return (currentIndex + 1) % totalCount;
}

/** Previous match index with wrap — the mirror of `nextTranscriptSearchIndex`. */
export function previousTranscriptSearchIndex(currentIndex: number, totalCount: number): number {
  if (totalCount <= 0) {
    return -1;
  }
  if (currentIndex < 0) {
    return 0;
  }
  return (currentIndex - 1 + totalCount) % totalCount;
}

/**
 * The one count label both apps render beside the search field: `""`
 * while no query is entered (the bar shows its placeholder instead),
 * `"No matches"` for a query with no hits, otherwise `"N of M"`.
 */
export function formatTranscriptSearchCount(
  currentIndex: number,
  totalCount: number,
  query: string,
): string {
  if (query.length === 0) {
    return "";
  }
  if (totalCount === 0) {
    return "No matches";
  }
  return `${currentIndex + 1} of ${totalCount}`;
}
