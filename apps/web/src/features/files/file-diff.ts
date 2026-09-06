/**
 * Line-based text diff for the file editor's changed-file view (T30B6,
 * plan.md §12.4, §14.5). Pure, DOM-free computation — `FileDiffView`
 * (`file-diff-view.tsx`) dynamically imports this module on mount so it
 * lands in its own bundle chunk rather than the session route's initial
 * JavaScript (plan.md §14.5's "excluding lazy terminal/editor/diff
 * chunks" budget carve-out), the same pattern `file-code-editor.tsx`
 * uses for `@codemirror/*`.
 *
 * Uses Myers' O(ND) shortest-edit-script algorithm (Eugene W. Myers,
 * "An O(ND) Difference Algorithm and Its Variations", 1986) over lines,
 * so the diff is the true minimal edit — not a naive line-by-line
 * replace — while staying proportional to the number of *differences*
 * rather than the file size for the common case of a small edit in a
 * large file.
 *
 * Two independent bounds keep a pathological input from freezing the
 * tab or producing an unbounded DOM tree ("large diffs are bounded
 * rather than dropped", T30B6's acceptance criterion):
 *
 * - `MAX_DIFF_INPUT_LINES` caps how many lines of each side are fed to
 *   the O(ND) algorithm at all — worst case (every line different) is
 *   quadratic in the input size, so an unbounded input is a real
 *   hang risk;
 * - `MAX_DIFF_OUTPUT_LINES` caps how many diff lines the result carries
 *   even when the algorithm itself finished quickly (e.g. a file with
 *   thousands of small scattered changes).
 *
 * Either bound sets `truncated: true` on the result instead of ever
 * silently dropping the whole diff; `FileDiffView` turns that into a
 * visible banner, the same pattern `use-file-search.ts`/
 * `FileSearchPanel` already use for `FILE_SEARCH_MAX_RESULTS`.
 */

export type FileDiffLineType = "add" | "remove" | "context";

export interface FileDiffLine {
  type: FileDiffLineType;
  text: string;
  /** 1-based line number in the old text; absent for `add` lines. */
  oldLineNumber?: number;
  /** 1-based line number in the new text; absent for `remove` lines. */
  newLineNumber?: number;
}

/**
 * A contiguous run of diff lines (a change plus `DIFF_CONTEXT_LINES` of
 * surrounding unchanged context on each side), the "chunk splitting"
 * this task's description asks for: large unchanged spans between
 * chunks are collapsed to a count (`skippedBefore`) rather than
 * rendered line-by-line, the same way a unified diff groups hunks.
 */
export interface FileDiffChunk {
  lines: FileDiffLine[];
  /** Count of unchanged lines collapsed between the previous chunk (or the file start) and this one. */
  skippedBefore: number;
}

export interface FileDiffResult {
  chunks: FileDiffChunk[];
  additions: number;
  deletions: number;
  /** `true` when the old and new text are exactly equal (no chunks to show). */
  identical: boolean;
  /** `true` when either input bound or the output bound cut the diff short. */
  truncated: boolean;
}

/** Total old+new line count above which the diff input itself is bounded before running Myers. */
export const MAX_DIFF_INPUT_LINES = 4000;
/** Total diff-line count (across all chunks) above which the diff output is bounded. */
export const MAX_DIFF_OUTPUT_LINES = 2000;
/** Unchanged lines of context kept around each change, each side. */
export const DIFF_CONTEXT_LINES = 3;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split("\n");
}

interface DiffOp {
  type: FileDiffLineType;
  /** Index into the old-lines array (0-based), for `remove`/`context`. */
  aIndex?: number;
  /** Index into the new-lines array (0-based), for `add`/`context`. */
  bIndex?: number;
}

/**
 * Myers' shortest-edit-script diff over two line arrays, returning the
 * ordered sequence of context/add/remove operations that transforms `a`
 * into `b`. `O((N + M) * D)` where `D` is the number of differing
 * lines — fast for the common case of a small edit, bounded on the
 * caller's side (`computeFileDiff`) for the pathological case.
 */
function myersDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];

  const max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];
  let editDistance = max;

  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0))) {
        x = v.get(k + 1) ?? 0;
      } else {
        x = (v.get(k - 1) ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        editDistance = d;
        break outer;
      }
    }
  }

  // Backtrack through `trace` to recover the operation sequence, then reverse it.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = editDistance; d > 0; d -= 1) {
    // `trace[d]` was snapshotted *before* `d`'s own k-loop ran, so it
    // holds the frontier as it stood entering `d` (i.e. after `d - 1`
    // finished) — exactly the state `prevK`/`prevX` need below.
    const vPrev = trace[d]!;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && (vPrev.get(k - 1) ?? 0) < (vPrev.get(k + 1) ?? 0)) ? k + 1 : k - 1;
    const prevX = vPrev.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      ops.push({ type: "context", aIndex: x, bIndex: y });
    }

    if (x === prevX) {
      y -= 1;
      ops.push({ type: "add", bIndex: y });
    } else {
      x -= 1;
      ops.push({ type: "remove", aIndex: x });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    ops.push({ type: "context", aIndex: x, bIndex: y });
  }

  ops.reverse();
  return ops;
}

function groupIntoChunks(lines: FileDiffLine[], contextLines: number): FileDiffChunk[] {
  const changeIndices: number[] = [];
  lines.forEach((line, index) => {
    if (line.type !== "context") changeIndices.push(index);
  });
  if (changeIndices.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, changeIndices[0]! - contextLines);
  let end = Math.min(lines.length - 1, changeIndices[0]! + contextLines);
  for (let i = 1; i < changeIndices.length; i += 1) {
    const index = changeIndices[i]!;
    const rangeStart = Math.max(0, index - contextLines);
    const rangeEnd = Math.min(lines.length - 1, index + contextLines);
    if (rangeStart <= end + 1) {
      end = Math.max(end, rangeEnd);
    } else {
      ranges.push([start, end]);
      start = rangeStart;
      end = rangeEnd;
    }
  }
  ranges.push([start, end]);

  const chunks: FileDiffChunk[] = [];
  let previousEnd = -1;
  for (const [rangeStart, rangeEnd] of ranges) {
    chunks.push({
      lines: lines.slice(rangeStart, rangeEnd + 1),
      skippedBefore: Math.max(0, rangeStart - previousEnd - 1),
    });
    previousEnd = rangeEnd;
  }
  return chunks;
}

function boundOutput(
  chunks: FileDiffChunk[],
  maxLines: number,
): { chunks: FileDiffChunk[]; truncated: boolean } {
  let rendered = 0;
  const bounded: FileDiffChunk[] = [];
  for (const chunk of chunks) {
    if (rendered >= maxLines) {
      return { chunks: bounded, truncated: true };
    }
    const remaining = maxLines - rendered;
    if (chunk.lines.length > remaining) {
      bounded.push({ ...chunk, lines: chunk.lines.slice(0, remaining) });
      return { chunks: bounded, truncated: true };
    }
    bounded.push(chunk);
    rendered += chunk.lines.length;
  }
  return { chunks: bounded, truncated: false };
}

/**
 * Computes a bounded, chunked line diff between `oldText` and `newText`.
 * Identical inputs short-circuit to `identical: true` without running
 * the algorithm at all.
 */
export function computeFileDiff(oldText: string, newText: string): FileDiffResult {
  if (oldText === newText) {
    return { chunks: [], additions: 0, deletions: 0, identical: true, truncated: false };
  }

  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  let boundedOldLines = oldLines;
  let boundedNewLines = newLines;
  let inputTruncated = false;
  if (oldLines.length + newLines.length > MAX_DIFF_INPUT_LINES) {
    const half = Math.max(1, Math.floor(MAX_DIFF_INPUT_LINES / 2));
    boundedOldLines = oldLines.slice(0, half);
    boundedNewLines = newLines.slice(0, half);
    inputTruncated = true;
  }

  const ops = myersDiff(boundedOldLines, boundedNewLines);

  let additions = 0;
  let deletions = 0;
  const lines: FileDiffLine[] = ops.map((op) => {
    if (op.type === "add") {
      additions += 1;
      return { type: "add", text: boundedNewLines[op.bIndex!]!, newLineNumber: op.bIndex! + 1 };
    }
    if (op.type === "remove") {
      deletions += 1;
      return { type: "remove", text: boundedOldLines[op.aIndex!]!, oldLineNumber: op.aIndex! + 1 };
    }
    return {
      type: "context",
      text: boundedOldLines[op.aIndex!]!,
      oldLineNumber: op.aIndex! + 1,
      newLineNumber: op.bIndex! + 1,
    };
  });

  const chunks = groupIntoChunks(lines, DIFF_CONTEXT_LINES);
  const { chunks: boundedChunks, truncated: outputTruncated } = boundOutput(
    chunks,
    MAX_DIFF_OUTPUT_LINES,
  );

  return {
    chunks: boundedChunks,
    additions,
    deletions,
    identical: chunks.length === 0,
    truncated: inputTruncated || outputTruncated,
  };
}
