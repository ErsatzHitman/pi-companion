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

import { Card, CodeBlock, Link, RecordList, StatusIndicator } from "../../ui/primitives";
import { CodeListing, DiffSummary, WorkflowSteps } from "../../ui/recipes";
import type { WorkflowStepItem } from "../../ui/recipes";
import { useTheme } from "../../ui/theme/theme-context";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import {
  STATUS_TONE,
  areToolCallRowPropsEqual,
  diffCounts,
  diffLinesFor,
  formatToolDuration,
  genericInputSummary,
  genericResultSummary,
  isKnownToolCall,
  searchCountsLine,
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

function ShellBody({ tool, styles }: { tool: tools.ShellToolCallViewModel; styles: Styles }) {
  return (
    <View style={styles.body}>
      <CodeBlock code={tool.command} language="bash" />
      {tool.cwd ? <Text style={styles.meta}>{`cwd: ${tool.cwd}`}</Text> : null}
      {tool.output ? <CodeBlock code={truncateBody(tool.output)} language="text" /> : null}
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
  return (
    <View style={styles.body}>
      <DiffSummary path={tool.filePath} added={added} removed={removed} modified={0} />
      {tool.isMultiEdit ? (
        <Text style={styles.meta}>{`${tool.edits?.length ?? 0} edits in this file`}</Text>
      ) : null}
      {diffLines ? (
        <CodeBlock
          code={diffLines.text}
          language="diff"
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
      ) : tool.content ? (
        <CodeBlock code={truncateBody(tool.content)} language="text" />
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
  const resultLabel = tool.status === "failed" ? "Error" : "Result";
  const showResultPanel =
    tool.status === "failed" ? tool.rawError !== undefined : tool.result !== undefined;
  return (
    <Card testID={testId}>
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
  return (
    <Card testID={testId}>
      <ToolCallHeader tool={tool} testId={testId} />
      {tool.summary ? <Text style={styles.meta}>{tool.summary}</Text> : null}
      {tool.status === "failed" && tool.errorText ? (
        <Text style={[styles.meta, styles.metaError]}>{tool.errorText}</Text>
      ) : null}
      {tool.family === "shell" ? (
        <ShellBody tool={tool} styles={styles} />
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
