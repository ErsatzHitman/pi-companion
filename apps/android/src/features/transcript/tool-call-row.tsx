/**
 * plan.md §9.3/§11.1/§11.6 transcript tool-call row (T33A4) — renders one
 * `tool-call` `TranscriptEntry` in the compact layout's `transcript` slot.
 *
 * A thin native view over `tool-call-row-model.ts`, mirroring
 * `apps/web/src/features/transcript/tool-call-row.tsx`'s architecture and
 * vocabulary (family names, status text, diff/duration formatting) — all
 * card-selection, status-text, duration, diff-derivation, and (the one
 * Android-specific addition, see the model's doc comment) redaction logic
 * lives in the RN-free model module, unit tested there; this file only
 * composes already-built primitives/recipes (`../../ui/primitives`,
 * `../../ui/recipes`, read but never forked or edited per this task's
 * brief) and wraps the result in `memo` using the model's comparator, so
 * a live update to one call does not re-render every already-settled
 * tool-call row already in the list.
 *
 * **T356: the card carries the redesign's own tool surfaces.** §7.2
 * gives a finished tool call `tool-success-bg` and a failed one
 * `tool-error-bg`, which is what `toolBlockKind` below maps a
 * `ToolCallViewModel.status` onto. `Card` still supplies the radius,
 * the padding and the 1px ring; only the fill (and, for a failure, a
 * red outline) is overridden, so a tool call still reads as the same
 * kind of object as every other card in this app. A running call keeps
 * the neutral `surface` it always had: it has no outcome yet, and
 * colouring it as though it did is the thing this whole table exists to
 * avoid. `StatusIndicator` above still spells the status out in words,
 * so none of this is colour alone (plan.md §10.5).
 *
 * **T358: the edit and search cards draw the redesign's own bands.** An
 * edit's diff was a `CodeBlock` of plain mono text with a `diff`
 * language tag that this app has no highlighter for, so nothing was
 * actually coloured; it is now `DiffLines`, which draws §7.2's
 * `.dl add|rem|ctx` bands and inverts the words that changed. A
 * search's matched lines were the same undifferentiated blob; they are
 * now `MatchedLine`, which marks the query itself on
 * `accent-highlight`. Both keep every signal in text as well as in
 * colour — see those two components' own doc comments.
 *
 * **T359: a shell call is the artifact's `.bash`.** It used to be two
 * stacked `CodeBlock`s, which drew a shell command as though it were a
 * file listing. It is now `BashBlock` — green rules above and below,
 * `$ ` before the command, output in `ink-2` between them, and, while
 * it runs, the shared `PixelLoader` with a shimmering "Running…", the
 * elapsed time and the name of the control that stops it.
 *
 * §11.6's governing rule: "Never fail the transcript because a plugin
 * returns a new tool detail shape." Every family this file does not
 * explicitly branch on — `tool.family === "generic"`, which is exactly
 * what `buildToolCallViewModel`/`buildGenericToolCallViewModel` produce
 * for an unrecognized `detail.type` or a value that failed validation
 * outright — renders through `UnknownToolCard`, which shows the tool name
 * and a bounded, *redacted* summary (`genericInputSummary`/
 * `genericResultSummary`) and never the raw `collapsibleInput`/`result`/
 * `rawError` value.
 */
import { memo, useCallback } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import type { tools } from "@picompanion/frontend-core";

// The one label that names how a reader actually stops a running
// turn on Android. Imported across features on purpose: a second
// copy of this string is how the transcript ends up telling the
// reader to press a button the composer no longer draws.
import { ABORT_ACTION_LABEL } from "../composer/composer-model";

import { Card, CodeBlock, Link, RecordList, StatusIndicator } from "../../ui/primitives";
import { blockOutline, blockSurface, type BlockKind } from "../../ui/theme/block-shape";
import {
  BashBlock,
  CodeListing,
  DiffLines,
  DiffSummary,
  MatchedLine,
  WorkflowSteps,
  pairChangedLines,
} from "../../ui/recipes";
import type { WorkflowStepItem } from "../../ui/recipes";
import { useTheme } from "../../ui/theme/theme-context";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import {
  STATUS_TONE,
  areToolCallRowPropsEqual,
  diffCounts,
  diffLineInputsFor,
  diffLinesFor,
  formatToolDuration,
  genericInputSummary,
  genericResultSummary,
  isKnownToolCall,
  searchCountsLine,
  searchMatchLines,
  shellBlockIsDimmed,
  statusTextFor,
  truncateBody,
  unrecognizedToolMeta,
  worktreeCommandStepStatus,
  type KnownToolCallViewModel,
  type TranscriptToolCallRowProps,
} from "./tool-call-row-model";

export type { ToolCallTranscriptEntry, TranscriptToolCallRowProps } from "./tool-call-row-model";
export { isToolCallEntry } from "./tool-call-row-model";

const MAX_LIST_ROWS = 20;

/**
 * Which `.blk` a tool call is. `running` and every other in-flight
 * status is deliberately absent from the mapping — see this file's own
 * T356 paragraph for why an outcome-coloured card before there is an
 * outcome is the failure mode this avoids.
 */
function toolBlockKind(status: tools.ToolCallViewModel["status"]): BlockKind | null {
  if (status === "completed") return "tool-ok";
  if (status === "failed") return "tool-error";
  return null;
}

/** The `Card` style override for one tool call's status, or `undefined` while it is still running. */
function useToolCardStyle(status: tools.ToolCallViewModel["status"]) {
  const { theme } = useTheme();
  const kind = toolBlockKind(status);
  if (kind === null) return undefined;
  const surface = blockSurface(kind);
  const outline = blockOutline(kind);
  return {
    backgroundColor: surface === null ? undefined : theme.colors[surface],
    ...(outline === null ? {} : { borderWidth: 1, borderColor: theme.colors[outline] }),
  };
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.spacing[2],
      marginBottom: theme.spacing[2],
    },
    name: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    duration: {
      marginLeft: "auto",
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    body: { gap: theme.spacing[2] },
    matches: { gap: 1 },
    meta: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    metaError: { color: theme.colors.status.danger.foreground },
    panelLabel: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
  });
}

type Styles = ReturnType<typeof createStyles>;

function ToolCallHeader({ tool, testId }: { tool: tools.ToolCallViewModel; testId?: string }) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  return (
    <View style={styles.header}>
      <Text style={styles.name}>{tool.displayName}</Text>
      <StatusIndicator
        label="Tool call"
        tone={STATUS_TONE[tool.status]}
        statusText={statusTextFor(tool.status)}
        testId={testId ? `${testId}-status` : undefined}
      />
      {tool.durationMs !== undefined ? (
        <Text style={styles.duration}>{formatToolDuration(tool.durationMs)}</Text>
      ) : null}
    </View>
  );
}

/**
 * T359: a shell call is the artifact's `.bash`, not a pair of code
 * blocks.
 *
 * `dimmed` is `shellBlockIsDimmed(tool.status)` — the artifact's
 * `.bash-dim`, for a command that did not run to completion. The
 * `cancelHint` is `ABORT_ACTION_LABEL`, the real control that stops a
 * turn on this platform, rather than the artifact's desktop-only "esc
 * to cancel"; see `BashBlock.tsx`'s own doc comment for why that string
 * is not shipped.
 */
function ShellBody({
  tool,
  styles,
  testId,
}: {
  tool: tools.ShellToolCallViewModel;
  styles: Styles;
  testId?: string;
}) {
  const { reduceMotion } = useTheme();
  const running = tool.status === "running";
  return (
    <View style={styles.body}>
      <BashBlock
        command={tool.command}
        output={tool.output === undefined ? undefined : truncateBody(tool.output)}
        running={running}
        elapsedLabel={
          tool.durationMs === undefined ? undefined : formatToolDuration(tool.durationMs)
        }
        cancelHint={running ? ABORT_ACTION_LABEL : undefined}
        dimmed={shellBlockIsDimmed(tool.status)}
        shimmer={running && !reduceMotion}
        testId={testId ? `${testId}-bash` : undefined}
      />
      {tool.cwd ? <Text style={styles.meta}>{`cwd: ${tool.cwd}`}</Text> : null}
      {tool.exitCode !== undefined ? (
        <Text style={styles.meta}>{`Exit code: ${tool.exitCode ?? "—"}`}</Text>
      ) : null}
    </View>
  );
}

function ReadBody({ tool, styles }: { tool: tools.ReadToolCallViewModel; styles: Styles }) {
  return (
    <View style={styles.body}>
      {tool.content ? (
        <CodeListing path={tool.filePath} language="text" code={truncateBody(tool.content)} />
      ) : (
        <Text style={styles.meta}>{tool.filePath}</Text>
      )}
      {tool.offset !== undefined || tool.limit !== undefined ? (
        <Text style={styles.meta}>
          {tool.offset !== undefined ? `From line ${tool.offset}` : "From the start"}
          {tool.limit !== undefined ? `, ${tool.limit} lines` : ""}
        </Text>
      ) : null}
    </View>
  );
}

function WriteBody({ tool, styles }: { tool: tools.WriteToolCallViewModel; styles: Styles }) {
  return (
    <View style={styles.body}>
      <Text style={styles.meta}>{tool.filePath}</Text>
      {tool.content ? <CodeBlock code={truncateBody(tool.content)} language="text" /> : null}
    </View>
  );
}

function EditBody({
  tool,
  styles,
  testId,
}: {
  tool: tools.EditToolCallViewModel;
  styles: Styles;
  testId?: string;
}) {
  const { added, removed } = diffCounts(tool);
  const diffLines = diffLinesFor(tool);
  const bands = pairChangedLines(diffLineInputsFor(tool));
  return (
    <View style={styles.body}>
      <DiffSummary path={tool.filePath} added={added} removed={removed} modified={0} />
      {tool.isMultiEdit ? (
        <Text style={styles.meta}>{`${tool.edits?.length ?? 0} edits in this file`}</Text>
      ) : null}
      {bands.length > 0 ? (
        <DiffLines
          lines={bands}
          accessibleName={`${tool.filePath} changed lines`}
          testId={testId ? `${testId}-diff` : undefined}
        />
      ) : null}
      {diffLines?.truncatedNotice ? (
        <Text style={styles.meta}>{diffLines.truncatedNotice}</Text>
      ) : null}
    </View>
  );
}

function SearchBody({ tool, styles }: { tool: tools.SearchToolCallViewModel; styles: Styles }) {
  const countsLine = searchCountsLine(tool);
  const matchLines = tool.content ? searchMatchLines(truncateBody(tool.content)) : [];
  const fileRows = tool.filePaths?.slice(0, MAX_LIST_ROWS).map((path, index) => ({
    id: `${index}-${path}`,
    cells: { path },
  }));
  const webRows = tool.webResults?.slice(0, MAX_LIST_ROWS).map((result, index) => ({
    id: `${index}-${result.url}`,
    cells: { title: result.title, url: result.url },
  }));
  return (
    <View style={styles.body}>
      <Text style={styles.meta}>{tool.query}</Text>
      {webRows && webRows.length > 0 ? (
        <RecordList
          accessibleName="Web search results"
          columns={[
            { key: "title", header: "Title" },
            { key: "url", header: "URL" },
          ]}
          rows={webRows}
        />
      ) : fileRows && fileRows.length > 0 ? (
        <RecordList
          accessibleName="Matching files"
          columns={[{ key: "path", header: "File" }]}
          rows={fileRows}
        />
      ) : matchLines.length > 0 ? (
        <View style={styles.matches} accessibilityRole="none" accessibilityLabel="Matching lines">
          {matchLines.map((line, index) => (
            <MatchedLine key={index} text={line} query={tool.query} />
          ))}
        </View>
      ) : null}
      {countsLine ? <Text style={styles.meta}>{countsLine}</Text> : null}
      {tool.truncated ? <Text style={styles.meta}>Results truncated</Text> : null}
    </View>
  );
}

function FetchBody({ tool, styles }: { tool: tools.FetchToolCallViewModel; styles: Styles }) {
  const onPressUrl = useCallback(() => {
    void Linking.openURL(tool.url).catch(() => undefined);
  }, [tool.url]);
  return (
    <View style={styles.body}>
      <Link label={tool.url} onPress={onPressUrl} external />
      {tool.code !== undefined ? (
        <Text style={styles.meta}>{`${tool.code}${tool.codeText ? ` ${tool.codeText}` : ""}`}</Text>
      ) : null}
      {tool.result ? <CodeBlock code={truncateBody(tool.result)} language="text" /> : null}
    </View>
  );
}

function WorktreeSetupBody({
  tool,
  styles,
}: {
  tool: tools.WorktreeSetupToolCallViewModel;
  styles: Styles;
}) {
  const items: WorkflowStepItem[] = tool.commands.map((command) => ({
    id: `${command.index}`,
    label: command.command,
    status: worktreeCommandStepStatus(command.status),
  }));
  return (
    <View style={styles.body}>
      <Text style={styles.meta}>{`${tool.branchName} at ${tool.worktreePath}`}</Text>
      <WorkflowSteps items={items} accessibleName="Setup commands" />
      {tool.log ? <CodeBlock code={truncateBody(tool.log)} language="text" /> : null}
    </View>
  );
}

function SubAgentBody({ tool, styles }: { tool: tools.SubAgentToolCallViewModel; styles: Styles }) {
  return (
    <View style={styles.body}>
      {tool.description ? <Text style={styles.meta}>{tool.description}</Text> : null}
      {tool.actions && tool.actions.length > 0 ? (
        <View accessibilityRole="none" accessibilityLabel="Sub-agent actions">
          {tool.actions.map((action) => (
            <Text key={action.index} style={styles.meta}>
              {`${action.toolName}${action.summary ? `: ${action.summary}` : ""}`}
            </Text>
          ))}
        </View>
      ) : null}
      {tool.log ? <CodeBlock code={truncateBody(tool.log)} language="text" /> : null}
    </View>
  );
}

function PlanBody({ tool, styles }: { tool: tools.PlanToolCallViewModel; styles: Styles }) {
  return (
    <View style={styles.body}>
      <Text style={styles.meta}>{truncateBody(tool.text)}</Text>
    </View>
  );
}

function PlainTextBody({
  tool,
  styles,
}: {
  tool: tools.PlainTextToolCallViewModel;
  styles: Styles;
}) {
  return (
    <View style={styles.body}>
      {tool.label ? <Text style={styles.meta}>{tool.label}</Text> : null}
      {tool.text ? <Text style={styles.meta}>{truncateBody(tool.text)}</Text> : null}
    </View>
  );
}

/**
 * The safe generic card (§11.6: "an unknown tool renders the safe
 * generic card and never raw payload"). Shows tool name and source
 * (`unrecognizedToolMeta`), execution state and duration
 * (`ToolCallHeader`), and a redacted, bounded result/error and input
 * summary (`genericResultSummary`/`genericInputSummary` — see the
 * model's doc comment for why this goes further than a plain bounded
 * stringify). Every one of those functions already returns inert text,
 * so this component never interprets a plugin's payload as anything but
 * a `Text` node.
 */
function UnknownToolCard({
  tool,
  styles,
  testId,
}: {
  tool: tools.GenericToolCallViewModel;
  styles: Styles;
  testId?: string;
}) {
  const cardStyle = useToolCardStyle(tool.status);
  const resultLabel = tool.status === "failed" ? "Error" : "Result";
  const showResultPanel =
    tool.status === "failed" ? tool.rawError !== undefined : tool.result !== undefined;
  return (
    <Card style={cardStyle} testID={testId}>
      <ToolCallHeader tool={tool} testId={testId} />
      <View style={styles.body}>
        <Text style={[styles.meta, tool.status === "failed" ? styles.metaError : null]}>
          {unrecognizedToolMeta(tool)}
        </Text>
        {showResultPanel ? (
          <>
            <Text style={styles.panelLabel}>{resultLabel}</Text>
            <CodeBlock code={genericResultSummary(tool)} language="json" />
          </>
        ) : null}
        <Text style={styles.panelLabel}>Input</Text>
        <CodeBlock code={genericInputSummary(tool)} language="json" />
      </View>
    </Card>
  );
}

function KnownToolCard({
  tool,
  styles,
  testId,
}: {
  tool: KnownToolCallViewModel;
  styles: Styles;
  testId?: string;
}) {
  const cardStyle = useToolCardStyle(tool.status);
  return (
    <Card style={cardStyle} testID={testId}>
      <ToolCallHeader tool={tool} testId={testId} />
      {tool.summary ? <Text style={styles.meta}>{tool.summary}</Text> : null}
      {tool.status === "failed" && tool.errorText ? (
        <Text style={[styles.meta, styles.metaError]}>{tool.errorText}</Text>
      ) : null}
      {tool.family === "shell" ? (
        <ShellBody tool={tool} styles={styles} testId={testId} />
      ) : tool.family === "read" ? (
        <ReadBody tool={tool} styles={styles} />
      ) : tool.family === "write" ? (
        <WriteBody tool={tool} styles={styles} />
      ) : tool.family === "edit" ? (
        <EditBody tool={tool} styles={styles} testId={testId} />
      ) : tool.family === "search" ? (
        <SearchBody tool={tool} styles={styles} />
      ) : tool.family === "fetch" ? (
        <FetchBody tool={tool} styles={styles} />
      ) : tool.family === "worktree_setup" ? (
        <WorktreeSetupBody tool={tool} styles={styles} />
      ) : tool.family === "sub_agent" ? (
        <SubAgentBody tool={tool} styles={styles} />
      ) : tool.family === "plan" ? (
        <PlanBody tool={tool} styles={styles} />
      ) : (
        <PlainTextBody tool={tool} styles={styles} />
      )}
    </Card>
  );
}

function TranscriptToolCallRowImpl({ entry, testId }: TranscriptToolCallRowProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const { tool } = entry;

  return isKnownToolCall(tool) ? (
    <KnownToolCard tool={tool} styles={styles} testId={testId} />
  ) : (
    <UnknownToolCard tool={tool} styles={styles} testId={testId} />
  );
}

export const TranscriptToolCallRow = memo(TranscriptToolCallRowImpl, areToolCallRowPropsEqual);
