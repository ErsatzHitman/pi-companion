import { memo, useEffect, useRef, useState } from "react";
import type { timeline, tools } from "@picompanion/frontend-core";

import {
  Button,
  Card,
  CodeBlock,
  Link,
  RecordList,
  StatusIndicator,
} from "../../ui/primitives/index.js";
import type { StatusTone } from "../../ui/primitives/index.js";
import { CodeListing, DiffSummary, WorkflowSteps } from "../../ui/recipes/index.js";
import type { WorkflowStepStatus } from "../../ui/recipes/index.js";
import "./tool-call-row.css";

/** The `tool-call` transcript entry kind (plan.md §11.1 "tool
 * start/update/end"; §11.6). T28A4's sibling to `message-row.tsx`'s
 * `CoreMessageEntry`, `thinking-row.tsx`'s `ThinkingTranscriptEntry`, and
 * `compaction-row.tsx`'s `CompactionTranscriptEntry` (T28A7) — see
 * `transcript.tsx`'s doc comment for the full, current list of
 * `TranscriptEntry` kinds this directory does and does not render yet
 * (todo, error, extension snapshots, and unknown remain unbuilt; there
 * is also no "retry" `TranscriptEntry` kind at all today — see
 * `compaction-row.tsx`'s doc comment for why).
 *
 * T28A5 ("Render images, attachments, and diffs") added two things to
 * the bodies below: full unified-diff line rendering in `EditBody`, and
 * image-result detection in `ReadBody`/`WriteBody`/`UnknownToolCard` for
 * the one channel that *can* carry image bytes today — a tool's own
 * text/result field, per this domain's own doc comment
 * (`../../../../../packages/frontend-core/src/tools/types.ts`: "a tool
 * that returns image bytes will show up as `read.content` … and renders
 * as text until the protocol grows a typed image result"). There is no
 * equivalent channel for *attachments* (`AgentAttachment` — forge/GitHub
 * issue and PR references, uploaded files, review comments): nothing in
 * `ToolCallDetail` or `AgentTimelineItem` carries that shape, so no
 * attachment renders here either. See `message-row.tsx`'s doc comment
 * for the full citation of where the wire protocol drops both. */
export type ToolCallTranscriptEntry = Extract<timeline.TranscriptEntry, { kind: "tool-call" }>;

export function isToolCallEntry(entry: timeline.TranscriptEntry): entry is ToolCallTranscriptEntry {
  return entry.kind === "tool-call";
}

export interface TranscriptToolCallRowProps {
  entry: ToolCallTranscriptEntry;
  testId?: string;
}

const STATUS_TONE: Record<tools.ToolCallViewStatus, StatusTone> = {
  running: "info",
  blocked: "warning",
  completed: "success",
  failed: "danger",
  canceled: "neutral",
};

const STATUS_TEXT: Record<tools.ToolCallViewStatus, string> = {
  running: "Running",
  blocked: "Waiting for approval",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

const MAX_BODY_CHARS = 4000;
const MAX_PAYLOAD_CHARS = 4000;
const MAX_LIST_ROWS = 20;

function truncate(text: string, max = MAX_BODY_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max))}\n… (truncated for display)`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function safeStringify(value: unknown): string {
  if (value === undefined) {
    return "(none)";
  }
  try {
    return truncate(JSON.stringify(value, null, 2) ?? "(none)", MAX_PAYLOAD_CHARS);
  } catch {
    return "(unable to display this payload)";
  }
}

/**
 * T28A5 "image results" (plan.md §11.6 "file and image results"): the
 * frontend-core tools domain documents that an image-returning tool has
 * no typed result field yet and "shows up as `read.content` … and
 * renders as text until the protocol grows a typed image result"
 * (`tools/types.ts`). Recognizing a `data:image/...;base64,` URI in a
 * text field this task already receives — a `read`/`write` file's
 * content, or a generic call's result — lets this row render that image
 * today, with no protocol change, instead of waiting on one.
 */
const DATA_URI_IMAGE_PATTERN = /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,/i;
/** Decoded-byte bound before an inline image preview is replaced with a
 * bounded text note (T28A5 acceptance: "oversized payloads are bounded,
 * not dropped silently") — the raw text is still truncated normally by
 * whichever body would otherwise have rendered it as code, never lost. */
const MAX_INLINE_IMAGE_BYTES = 2_000_000;

function isImageDataUri(value: string): boolean {
  return DATA_URI_IMAGE_PATTERN.test(value.trim());
}

function approximateDecodedBytes(dataUri: string): number {
  const commaIndex = dataUri.indexOf(",");
  const base64Body = commaIndex === -1 ? dataUri : dataUri.slice(commaIndex + 1);
  return Math.floor((base64Body.length * 3) / 4);
}

/**
 * Renders a detected image data URI with a real accessible name (T28A5
 * acceptance: "images and attachments render with accessible names") —
 * `alt` is the only thing screen-reader users get for an `<img>`, so it
 * always carries the tool/file context, never a generic "image".
 */
function ImageResult({ dataUri, label }: { dataUri: string; label: string }) {
  const bytes = approximateDecodedBytes(dataUri);
  if (bytes > MAX_INLINE_IMAGE_BYTES) {
    return (
      <p className="pc-tool-call__meta">
        Image omitted from preview ({Math.round(bytes / 1024).toLocaleString()} KB exceeds the{" "}
        {Math.round(MAX_INLINE_IMAGE_BYTES / 1024).toLocaleString()} KB preview limit).
      </p>
    );
  }
  return <img className="pc-tool-call__image" src={dataUri} alt={label} />;
}

/**
 * T28A5 diff rendering: a single classified unified-diff line. The
 * `unifiedDiff` string itself already carries the `+`/`-`/` ` markers, so
 * classifying by that leading character is enough to colour each line —
 * the visible `+`/`-` character (never colour alone) is still what a
 * screen reader or a colour-blind reader sees.
 */
type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

/** Bound on how many diff lines this row renders per call (T28A5
 * acceptance: "oversized payloads are bounded, not dropped silently") —
 * a huge generated diff still shows its first lines plus a visible count
 * of what was hidden, rather than either freezing the row or vanishing
 * the diff entirely. */
const MAX_DIFF_LINES = 400;

/**
 * Synthesizes unified-diff-shaped text from an `edits`/`oldString`+
 * `newString` pair when no `unifiedDiff` string was built (T28A4's
 * `EditToolCallViewModel` carries either shape). Not a real line-level
 * diff algorithm — it lists every removed line for an edit before every
 * added line, the same order `diffCounts` already reduces over — but it
 * lets one `DiffLines` renderer serve both shapes with the same visible
 * `+`/`-` treatment.
 */
function syntheticDiffText(edits: ReadonlyArray<{ oldString: string; newString: string }>): string {
  return edits
    .map(({ oldString, newString }) => {
      const removed = oldString ? oldString.split("\n").map((line) => `-${line}`) : [];
      const added = newString ? newString.split("\n").map((line) => `+${line}`) : [];
      return [...removed, ...added].join("\n");
    })
    .join("\n");
}

/**
 * Full unified-diff line-by-line view, composed from the `CodeBlock`
 * primitive's `children` override (its own doc comment: "lets richer
 * renderers … compose this primitive instead of duplicating its
 * `<pre><code>` shell"). Sits alongside the `DiffSummary` recipe's
 * at-a-glance +/- counts (already tabular Geist Mono — T28A5 acceptance:
 * "diffs render with add/remove counts in tabular mono figures") rather
 * than replacing it: the summary is the one-line badge, this is the
 * expanded content.
 */
function DiffLines({ diff, testId }: { diff: string; testId?: string }) {
  const lines = diff.split("\n");
  const bounded = lines.slice(0, MAX_DIFF_LINES);
  const hiddenCount = lines.length - bounded.length;
  return (
    <div role="group" aria-label="Diff" className="pc-diff-lines">
      <CodeBlock code={diff} language="diff" testId={testId}>
        {bounded.map((line, index) => (
          // Positional index as key: diff lines are never reordered
          // independently of the diff text itself, only appended to or
          // truncated from the end.
          <span key={index} className={`pc-diff-line pc-diff-line--${classifyDiffLine(line)}`}>
            {line.length > 0 ? line : " "}
            {"\n"}
          </span>
        ))}
      </CodeBlock>
      {hiddenCount > 0 ? (
        <p className="pc-tool-call__meta">{hiddenCount} more diff lines not shown</p>
      ) : null}
    </div>
  );
}

/**
 * Header shared by every tool-call card: display name, non-colour status
 * (`StatusIndicator` always pairs its dot with visible text — T28A4
 * acceptance "tool status is conveyed in text as well as colour"), and a
 * mono, tabular-figure duration readout once one is known.
 */
function ToolCallHeader({ tool, testId }: { tool: tools.ToolCallViewModel; testId?: string }) {
  return (
    <div className="pc-tool-call__header">
      <span className="pc-tool-call__name">{tool.displayName}</span>
      <StatusIndicator
        label="Tool call"
        tone={STATUS_TONE[tool.status]}
        statusText={STATUS_TEXT[tool.status]}
        testId={testId ? `${testId}-status` : undefined}
      />
      {tool.durationMs !== undefined ? (
        <span className="pc-tool-call__duration">{formatDuration(tool.durationMs)}</span>
      ) : null}
    </div>
  );
}

function ShellBody({ tool }: { tool: tools.ShellToolCallViewModel }) {
  return (
    <div className="pc-tool-call__body">
      <CodeBlock code={tool.command} language="bash" />
      {tool.cwd ? <p className="pc-tool-call__meta">cwd: {tool.cwd}</p> : null}
      {tool.output ? <CodeBlock code={truncate(tool.output)} language="text" /> : null}
      {tool.exitCode !== undefined ? (
        <p className="pc-tool-call__meta">Exit code: {tool.exitCode ?? "—"}</p>
      ) : null}
    </div>
  );
}

function ReadBody({ tool }: { tool: tools.ReadToolCallViewModel }) {
  const trimmedContent = tool.content?.trim();
  const isImage = trimmedContent ? isImageDataUri(trimmedContent) : false;
  return (
    <div className="pc-tool-call__body">
      {isImage && trimmedContent ? (
        <ImageResult dataUri={trimmedContent} label={`Image read from ${tool.filePath}`} />
      ) : tool.content ? (
        <CodeListing path={tool.filePath} language="text" code={truncate(tool.content)} />
      ) : (
        <p className="pc-tool-call__meta">{tool.filePath}</p>
      )}
      {tool.offset !== undefined || tool.limit !== undefined ? (
        <p className="pc-tool-call__meta">
          {tool.offset !== undefined ? `From line ${tool.offset}` : "From the start"}
          {tool.limit !== undefined ? `, ${tool.limit} lines` : ""}
        </p>
      ) : null}
    </div>
  );
}

function WriteBody({ tool }: { tool: tools.WriteToolCallViewModel }) {
  const trimmedContent = tool.content?.trim();
  const isImage = trimmedContent ? isImageDataUri(trimmedContent) : false;
  return (
    <div className="pc-tool-call__body">
      <p className="pc-tool-call__meta">{tool.filePath}</p>
      {isImage && trimmedContent ? (
        <ImageResult dataUri={trimmedContent} label={`Image written to ${tool.filePath}`} />
      ) : tool.content ? (
        <CodeBlock code={truncate(tool.content)} language="text" />
      ) : null}
    </div>
  );
}

/** Normalizes `EditToolCallViewModel`'s two edit shapes (`edits`, or a
 * single `oldString`/`newString` pair) to one list, so `diffCounts` and
 * `syntheticDiffText` don't each re-derive it. */
function resolvedEdits(
  tool: tools.EditToolCallViewModel,
): ReadonlyArray<{ oldString: string; newString: string }> {
  return (
    tool.edits ??
    (tool.oldString !== undefined || tool.newString !== undefined
      ? [{ oldString: tool.oldString ?? "", newString: tool.newString ?? "" }]
      : [])
  );
}

/** Rough +/- line counts for the compact `DiffSummary` badge — the
 * at-a-glance count `DiffSummary` already shows for any other changed
 * file. `EditBody` below renders the full line-by-line diff alongside
 * this, from the same `unifiedDiff`/`edits` data. */
function diffCounts(tool: tools.EditToolCallViewModel): { added: number; removed: number } {
  if (tool.unifiedDiff) {
    let added = 0;
    let removed = 0;
    for (const line of tool.unifiedDiff.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) added += 1;
      else if (line.startsWith("-")) removed += 1;
    }
    return { added, removed };
  }
  return resolvedEdits(tool).reduce(
    (totals, edit) => ({
      added: totals.added + (edit.newString ? edit.newString.split("\n").length : 0),
      removed: totals.removed + (edit.oldString ? edit.oldString.split("\n").length : 0),
    }),
    { added: 0, removed: 0 },
  );
}

function EditBody({ tool, testId }: { tool: tools.EditToolCallViewModel; testId?: string }) {
  const { added, removed } = diffCounts(tool);
  const edits = resolvedEdits(tool);
  const diffText = tool.unifiedDiff ?? (edits.length > 0 ? syntheticDiffText(edits) : undefined);
  return (
    <div className="pc-tool-call__body">
      <DiffSummary path={tool.filePath} added={added} removed={removed} modified={0} />
      {tool.isMultiEdit ? (
        <p className="pc-tool-call__meta">{tool.edits?.length ?? 0} edits in this file</p>
      ) : null}
      {diffText ? (
        <DiffLines diff={diffText} testId={testId ? `${testId}-diff` : undefined} />
      ) : null}
    </div>
  );
}

function SearchBody({ tool }: { tool: tools.SearchToolCallViewModel }) {
  const countsLine =
    tool.numFiles !== undefined || tool.numMatches !== undefined
      ? [
          tool.numFiles !== undefined ? `${tool.numFiles} files` : null,
          tool.numMatches !== undefined ? `${tool.numMatches} matches` : null,
        ]
          .filter(Boolean)
          .join(", ")
      : undefined;
  return (
    <div className="pc-tool-call__body">
      <p className="pc-tool-call__meta">{tool.query}</p>
      {tool.webResults && tool.webResults.length > 0 ? (
        <RecordList
          ariaLabel="Web search results"
          columns={[
            { key: "title", header: "Title" },
            { key: "url", header: "URL" },
          ]}
          rows={tool.webResults.slice(0, MAX_LIST_ROWS).map((result, index) => ({
            id: `${index}-${result.url}`,
            cells: { title: result.title, url: result.url },
          }))}
        />
      ) : tool.filePaths && tool.filePaths.length > 0 ? (
        <RecordList
          ariaLabel="Matching files"
          columns={[{ key: "path", header: "File" }]}
          rows={tool.filePaths.slice(0, MAX_LIST_ROWS).map((path, index) => ({
            id: `${index}-${path}`,
            cells: { path },
          }))}
        />
      ) : tool.content ? (
        <CodeBlock code={truncate(tool.content)} language="text" />
      ) : null}
      {countsLine ? <p className="pc-tool-call__meta">{countsLine}</p> : null}
      {tool.truncated ? <p className="pc-tool-call__meta">Results truncated</p> : null}
    </div>
  );
}

function FetchBody({ tool }: { tool: tools.FetchToolCallViewModel }) {
  return (
    <div className="pc-tool-call__body">
      <Link href={tool.url} external>
        {tool.url}
      </Link>
      {tool.code !== undefined ? (
        <p className="pc-tool-call__meta">
          {tool.code}
          {tool.codeText ? ` ${tool.codeText}` : ""}
        </p>
      ) : null}
      {tool.result ? <CodeBlock code={truncate(tool.result)} language="text" /> : null}
    </div>
  );
}

const WORKTREE_COMMAND_STATUS: Record<
  tools.WorktreeSetupCommandView["status"],
  WorkflowStepStatus
> = {
  running: "active",
  completed: "complete",
  failed: "error",
};

function WorktreeSetupBody({ tool }: { tool: tools.WorktreeSetupToolCallViewModel }) {
  return (
    <div className="pc-tool-call__body">
      <p className="pc-tool-call__meta">
        {tool.branchName} at {tool.worktreePath}
      </p>
      <WorkflowSteps
        ariaLabel="Setup commands"
        items={tool.commands.map((command) => ({
          id: `${command.index}`,
          label: command.command,
          status: WORKTREE_COMMAND_STATUS[command.status],
        }))}
      />
      {tool.log ? <CodeBlock code={truncate(tool.log)} language="text" /> : null}
    </div>
  );
}

function SubAgentBody({ tool }: { tool: tools.SubAgentToolCallViewModel }) {
  return (
    <div className="pc-tool-call__body">
      {tool.description ? <p className="pc-tool-call__meta">{tool.description}</p> : null}
      {tool.actions && tool.actions.length > 0 ? (
        <ol className="pc-tool-call__actions" aria-label="Sub-agent actions">
          {tool.actions.map((action) => (
            <li key={action.index}>
              {action.toolName}
              {action.summary ? `: ${action.summary}` : ""}
            </li>
          ))}
        </ol>
      ) : null}
      {tool.log ? <CodeBlock code={truncate(tool.log)} language="text" /> : null}
    </div>
  );
}

function PlanBody({ tool }: { tool: tools.PlanToolCallViewModel }) {
  return (
    <div className="pc-tool-call__body">
      <p className="pc-tool-call__meta">{truncate(tool.text)}</p>
    </div>
  );
}

function PlainTextBody({ tool }: { tool: tools.PlainTextToolCallViewModel }) {
  return (
    <div className="pc-tool-call__body">
      {tool.label ? <p className="pc-tool-call__meta">{tool.label}</p> : null}
      {tool.text ? <p className="pc-tool-call__meta">{truncate(tool.text)}</p> : null}
    </div>
  );
}

/**
 * T139: this hook used to say it "Never throws" and always set the
 * "Copied" label unconditionally after a bare `catch {}` around
 * `navigator.clipboard?.writeText?.(payload)`. That was worse than a
 * swallowed error: with no Clipboard API at all (or a denied write on a
 * non-secure origin) the optional chain short-circuited, nothing ever
 * threw, and the button still claimed success. A silent no-op is worse
 * than a visible failure.
 *
 * Clipboard action shared by the safe generic card's "Copy" and "Report"
 * buttons. Distinguishes the two ways a write can fail to actually copy
 * anything — an ABSENT Clipboard API (no `navigator.clipboard.writeText`
 * at all, e.g. a non-secure origin) versus a REJECTED write (the API
 * exists but the promise rejects, e.g. permission denied) — because a
 * user can act differently on each (the first often means "not on
 * HTTPS"). Both render a visible `StatusIndicator` `tone="danger"`
 * carrying the real reason, the same shape
 * `features/diagnostics/CopyableField.tsx` (T41B1) uses; this hook is not
 * shared with that component; see its call site below for why not.
 */
type ClipboardActionState =
  | { kind: "idle" }
  | { kind: "copied" }
  | { kind: "failed"; reason: string };

function useClipboardAction(label: string, copiedLabel: string) {
  const [state, setState] = useState<ClipboardActionState>({ kind: "idle" });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timeoutRef.current);
    },
    [],
  );

  async function run(payload: string) {
    clearTimeout(timeoutRef.current);
    if (!navigator.clipboard?.writeText) {
      // Distinct from a rejected write: nothing was ever attempted.
      setState({
        kind: "failed",
        reason: "Clipboard is not available in this browser context (try a secure https:// origin)",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
    } catch (error: unknown) {
      setState({
        kind: "failed",
        reason: error instanceof Error ? error.message : "Clipboard write was rejected",
      });
      return;
    }
    setState({ kind: "copied" });
    timeoutRef.current = setTimeout(() => setState({ kind: "idle" }), 2000);
  }

  const text = state.kind === "copied" ? copiedLabel : label;
  return { text, state, run };
}

/**
 * The safe generic card (T28A4 acceptance: "an unknown tool renders the
 * safe generic card and never raw payload"). Covers every §11.6 generic
 * requirement: tool name and source, execution state and duration
 * (`ToolCallHeader`), collapsible *validated* input (never the raw wire
 * message — `GenericToolCallViewModel.collapsibleInput` is already a
 * JSON-safe clone built by the tools domain), streaming updates (the same
 * `status`/`updateCount` plumbing every other family gets), result or
 * error, and copy/report actions.
 *
 * Every payload is rendered as inert, JSON-stringified text inside a
 * native `<details>`/`<summary>` disclosure (same pattern as
 * `features/rail/rail-element-card.tsx`'s raw-payload fallback) — never
 * interpreted as markup, never executed, and bounded to
 * `MAX_PAYLOAD_CHARS` so one unbounded plugin payload cannot balloon this
 * row's DOM.
 */
function UnknownToolCard({
  tool,
  testId,
}: {
  tool: tools.GenericToolCallViewModel;
  testId?: string;
}) {
  const copy = useClipboardAction("Copy details", "Copied");
  const report = useClipboardAction("Copy report", "Report copied");
  const imageResult =
    typeof tool.result === "string" && isImageDataUri(tool.result) ? tool.result : null;

  return (
    <Card className="pc-tool-call pc-tool-call--generic" data-testid={testId}>
      <ToolCallHeader tool={tool} testId={testId} />
      <p className="pc-tool-call__meta">
        Unrecognized tool{tool.source ? ` from ${tool.source}` : ""}: {tool.toolName}
      </p>
      {tool.status === "failed" ? (
        <p className="pc-tool-call__meta pc-tool-call__meta--error">
          {safeStringify(tool.rawError)}
        </p>
      ) : imageResult ? (
        <ImageResult dataUri={imageResult} label={`Image result from ${tool.toolName}`} />
      ) : tool.result !== undefined ? (
        <details className="pc-tool-call__details">
          <summary>Result</summary>
          <CodeBlock code={safeStringify(tool.result)} language="json" />
        </details>
      ) : null}
      <details className="pc-tool-call__details">
        <summary>Input</summary>
        <CodeBlock code={safeStringify(tool.collapsibleInput)} language="json" />
      </details>
      <div className="pc-tool-call__actions-row">
        <Button kind="secondary" onClick={() => void copy.run(tool.copyPayload)}>
          {copy.text}
        </Button>
        {copy.state.kind === "failed" ? (
          <StatusIndicator
            label="Copy details"
            tone="danger"
            statusText={`Copy failed — ${copy.state.reason}`}
            testId={testId ? `${testId}-copy-status` : undefined}
          />
        ) : null}
        <Button
          kind="secondary"
          onClick={() => void report.run(JSON.stringify(tool.reportPayload, null, 2))}
        >
          {report.text}
        </Button>
        {report.state.kind === "failed" ? (
          <StatusIndicator
            label="Copy report"
            tone="danger"
            statusText={`Copy failed — ${report.state.reason}`}
            testId={testId ? `${testId}-report-status` : undefined}
          />
        ) : null}
      </div>
    </Card>
  );
}

type KnownToolCallViewModel = Exclude<tools.ToolCallViewModel, tools.GenericToolCallViewModel>;

function KnownToolCard({ tool, testId }: { tool: KnownToolCallViewModel; testId?: string }) {
  return (
    <Card className="pc-tool-call" data-testid={testId}>
      <ToolCallHeader tool={tool} testId={testId} />
      {tool.summary ? <p className="pc-tool-call__meta">{tool.summary}</p> : null}
      {tool.status === "failed" && tool.errorText ? (
        <p className="pc-tool-call__meta pc-tool-call__meta--error">{tool.errorText}</p>
      ) : null}
      {tool.family === "shell" ? (
        <ShellBody tool={tool} />
      ) : tool.family === "read" ? (
        <ReadBody tool={tool} />
      ) : tool.family === "write" ? (
        <WriteBody tool={tool} />
      ) : tool.family === "edit" ? (
        <EditBody tool={tool} testId={testId} />
      ) : tool.family === "search" ? (
        <SearchBody tool={tool} />
      ) : tool.family === "fetch" ? (
        <FetchBody tool={tool} />
      ) : tool.family === "worktree_setup" ? (
        <WorktreeSetupBody tool={tool} />
      ) : tool.family === "sub_agent" ? (
        <SubAgentBody tool={tool} />
      ) : tool.family === "plan" ? (
        <PlanBody tool={tool} />
      ) : (
        <PlainTextBody tool={tool} />
      )}
    </Card>
  );
}

/**
 * Renders one `tool-call` transcript entry (T28A4, plan.md §11.6). Known
 * families (`tools.KNOWN_TOOL_CALL_FAMILIES`) each get a purpose-built
 * card; anything else — including a `family: "generic"` view model the
 * tools domain already built as its own safe fallback — renders through
 * `UnknownToolCard`, which never displays a payload as anything but inert
 * text.
 */
function TranscriptToolCallRowImpl({ entry, testId }: TranscriptToolCallRowProps) {
  const renderCount = useRef(0);
  renderCount.current += 1;
  const { tool } = entry;

  return (
    <div data-render-count={renderCount.current}>
      {tool.family === "generic" ? (
        <UnknownToolCard tool={tool} testId={testId} />
      ) : (
        <KnownToolCard tool={tool} testId={testId} />
      )}
    </div>
  );
}

function areToolCallRowPropsEqual(
  previous: TranscriptToolCallRowProps,
  next: TranscriptToolCallRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.testId === next.testId &&
    JSON.stringify(previous.entry.tool) === JSON.stringify(next.entry.tool)
  );
}

export const TranscriptToolCallRow = memo(TranscriptToolCallRowImpl, areToolCallRowPropsEqual);
