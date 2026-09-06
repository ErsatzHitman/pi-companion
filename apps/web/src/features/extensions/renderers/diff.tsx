/**
 * `diff` kind renderer (plan.md §11.3, §11.7; T29B3) — "Unified changes",
 * presented as web's documented "full diff view" (plan.md §11.3's kind
 * table): the `DiffSummary` recipe's +/- badge (plan.md §10.4) above a
 * bounded, syntax-highlighted unified-diff body.
 *
 * The body reuses the exact same tokenizer T30B2's read-only file view
 * already uses (`../../files/file-syntax-highlight.js`, itself a thin
 * wrapper over the ported `@picompanion/highlight` package) so a diff and
 * a plain file view share one syntax palette rather than inventing a
 * second (plan.md §10.1 "one approved treatment per component"). Only the
 * `+`/`-`/context content of each line is tokenized — unified-diff
 * metadata lines (`diff --git`, `index`, `--- a/...`, `+++ b/...`) and hunk
 * headers (`@@ ... @@`) are not code and are rendered as plain text.
 *
 * "Bounded" (T29B3's "large diffs are bounded rather than dropped"
 * acceptance criterion) mirrors `log.tsx`'s own bound: a fixed cap on how
 * many parsed diff lines are ever mounted, with a visible truncation
 * notice carrying the true total — never a silent drop.
 */
import { CodeBlock } from "../../../ui/primitives/index.js";
import { DiffSummary } from "../../../ui/recipes/index.js";
import { syntaxClassName, tokenizeFileContent } from "../../files/file-syntax-highlight.js";
import type { PiUiElementRendererProps } from "../registry.js";
import { ElementActionsRow } from "./element-actions.js";
import "./renderers.css";

/** Cap applied to how many parsed diff lines are ever mounted (see module doc comment). */
const DEFAULT_DIFF_LINE_CAP = 2000;

type DiffLineKind = "add" | "remove" | "context" | "hunk" | "meta";

interface ParsedDiffLine {
  kind: DiffLineKind;
  /** The line with its leading `+`/`-`/` ` marker stripped for `add`/`remove`/`context`; verbatim otherwise. */
  content: string;
  /** The marker character rendered ahead of the line; empty for `hunk`/`meta` lines. */
  marker: "+" | "-" | " " | "";
}

const META_PREFIXES = [
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

function classifyLine(raw: string): ParsedDiffLine {
  if (raw.startsWith("+++ ") || raw.startsWith("--- ")) {
    return { kind: "meta", content: raw, marker: "" };
  }
  if (META_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
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
  // A context line with no leading space (some generators omit it on blank
  // context lines) is still context, not metadata.
  return { kind: "context", content: raw, marker: " " };
}

/** Parses a `unifiedDiff` string into one classified line per input line. Exported for tests. */
export function parseUnifiedDiffLines(unifiedDiff: string): ParsedDiffLine[] {
  if (unifiedDiff.length === 0) return [];
  return unifiedDiff.split("\n").map(classifyLine);
}

/** `add`/`remove` totals across every parsed line — always the *full* diff, never just the bounded/visible slice. Exported for tests. */
export function countDiffLines(lines: readonly ParsedDiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "remove") removed += 1;
  }
  return { added, removed };
}

function isCodeLine(line: ParsedDiffLine): boolean {
  return line.kind === "add" || line.kind === "remove" || line.kind === "context";
}

/**
 * A synthetic filename handed to the shared tokenizer purely so it can
 * pick a language by extension (`file-syntax-highlight.ts`'s own
 * contract) — never used for display. Prefers the payload's real
 * `filePath` (a real extension); falls back to treating `language` as
 * though it were already an extension (true for the common case where a
 * caller sets e.g. `language: "ts"`), and finally to a name with no
 * recognized extension, which renders as plain, unstyled text — the same
 * fallback the read-only file view itself uses for an unrecognized kind.
 */
function highlightFileName(filePath: string | undefined, language: string | undefined): string {
  if (filePath) return filePath;
  if (language) return `diff.${language}`;
  return "diff.txt";
}

interface DiffLineViewProps {
  line: ParsedDiffLine;
  tokens: ReturnType<typeof tokenizeFileContent>[number] | undefined;
}

/**
 * One diff line, as a single block-level flex row (own line, own
 * background) — mirroring `file-content-view.tsx`'s per-line `<span>`
 * shape, just laid out as a row of marker + text instead of plain text.
 */
function DiffLineView({ line, tokens }: DiffLineViewProps) {
  return (
    <span className={`pc-pi-diff__line pc-pi-diff__line--${line.kind}`}>
      <span className="pc-pi-diff__marker">
        {line.marker === "+" || line.marker === "-" ? line.marker : "\u00a0"}
      </span>
      <span className="pc-pi-diff__text">
        {tokens
          ? tokens.map((token, tokenIndex) => {
              const className = syntaxClassName(token.style);
              return (
                // eslint-disable-next-line react/no-array-index-key -- tokens are positional and never reordered
                <span key={tokenIndex} className={className ?? undefined}>
                  {token.text}
                </span>
              );
            })
          : line.content}
      </span>
    </span>
  );
}

export function DiffRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"diff">) {
  const title = element.title ?? "Diff";
  const lines = parseUnifiedDiffLines(payload.unifiedDiff);
  const { added, removed } = countDiffLines(lines);

  const totalLines = lines.length;
  const visibleLines =
    totalLines > DEFAULT_DIFF_LINE_CAP ? lines.slice(0, DEFAULT_DIFF_LINE_CAP) : lines;
  const hiddenCount = totalLines - visibleLines.length;

  const codeContent = visibleLines
    .filter(isCodeLine)
    .map((line) => line.content)
    .join("\n");
  const tokenizedByLine =
    codeContent.length > 0
      ? tokenizeFileContent(codeContent, highlightFileName(payload.filePath, payload.language))
      : [];
  let codeLineCursor = 0;

  const testId = `pi-diff-${element.ns}-${element.id}`;

  return (
    <div className="pc-pi-diff" data-testid={testId}>
      <h3 className="pc-pi-diff__title">{title}</h3>
      <DiffSummary
        path={payload.filePath ?? title}
        added={added}
        removed={removed}
        modified={0}
        testId={`${testId}-summary`}
      />
      {hiddenCount > 0 ? (
        <p className="pc-pi-diff__truncated">
          Showing first {visibleLines.length} of {totalLines} lines ({hiddenCount} more{" "}
          {hiddenCount === 1 ? "line" : "lines"} hidden).
        </p>
      ) : null}
      {visibleLines.length > 0 ? (
        <div className="pc-pi-diff__scroll" data-testid={`${testId}-scroll`}>
          <CodeBlock
            code={payload.unifiedDiff}
            language={payload.language}
            testId={`${testId}-code`}
          >
            {visibleLines.map((line, index) => {
              const tokens = isCodeLine(line) ? tokenizedByLine[codeLineCursor++] : undefined;
              return (
                // eslint-disable-next-line react/no-array-index-key -- diff lines are positional and never reordered
                <DiffLineView key={index} line={line} tokens={tokens} />
              );
            })}
          </CodeBlock>
        </div>
      ) : (
        <p className="pc-pi-diff__empty">No changes to show.</p>
      )}
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        ariaLabel={`${title} actions`}
      />
    </div>
  );
}
