/**
 * `buildToolCallViewModel` — plan.md §7.1, §11.6.
 *
 * Turns one daemon `tool_call` timeline item (an `AgentTimelineItem` with
 * `type: "tool_call"`, validated against
 * `@picompanion/protocol/messages`'s `AgentTimelineItemPayloadSchema`) into
 * a typed `ToolCallViewModel`. Falls back to the safe generic card for:
 *
 *  - `detail.type === "unknown"` (the daemon's own "I don't know this tool"
 *    marker — see `ToolCallDetail` in `agent-types.ts`);
 *  - a `detail.type` string this build has never heard of (forward
 *    compatibility with a newer daemon/protocol version);
 *  - anything that fails schema validation outright.
 *
 * This function never throws.
 */
import { AgentTimelineItemPayloadSchema } from "@picompanion/protocol/messages";
import { buildToolCallDisplayModel } from "@picompanion/protocol/tool-call-display";
import type { ToolCallDetail, ToolCallTimelineItem } from "@picompanion/protocol/agent-types";

import { buildGenericToolCallViewModel } from "./fallback.js";
import type { ToolCallBuildOptions, ToolCallViewModel, ToolCallViewStatus } from "./types.js";
import { isRecord, timingFields } from "./util.js";

function readDetailType(raw: unknown): string | undefined {
  if (!isRecord(raw) || !isRecord(raw.detail)) {
    return undefined;
  }
  const detailType = raw.detail.type;
  return typeof detailType === "string" ? detailType : undefined;
}

function viewStatus(
  wireStatus: ToolCallTimelineItem["status"],
  blockedByPermissionRequestId: string | undefined,
): ToolCallViewStatus {
  return blockedByPermissionRequestId ? "blocked" : wireStatus;
}

/**
 * Builds a `ToolCallViewModel` from a raw value that should be one
 * `tool_call`-typed `AgentTimelineItem`. Safe on any input: malformed or
 * unrecognized shapes resolve to a `GenericToolCallViewModel` instead of
 * throwing.
 */
export function buildToolCallViewModel(
  raw: unknown,
  options: ToolCallBuildOptions = {},
): ToolCallViewModel {
  let parsed: ReturnType<typeof AgentTimelineItemPayloadSchema.safeParse>;
  try {
    parsed = AgentTimelineItemPayloadSchema.safeParse(raw);
  } catch {
    return buildGenericToolCallViewModel(raw, {
      ...options,
      reason: "Schema validation threw unexpectedly.",
      rawDetailType: readDetailType(raw),
    });
  }

  if (!parsed.success || parsed.data.type !== "tool_call") {
    return buildGenericToolCallViewModel(raw, {
      ...options,
      reason: parsed.success
        ? `Expected a "tool_call" timeline item, got "${parsed.data.type}".`
        : "Failed AgentTimelineItemPayloadSchema validation.",
      rawDetailType: readDetailType(raw),
    });
  }

  return buildFromValidatedItem(parsed.data, options);
}

function buildFromValidatedItem(
  item: ToolCallTimelineItem,
  options: ToolCallBuildOptions,
): ToolCallViewModel {
  try {
    return buildTypedFamily(item, options);
  } catch (error) {
    // Defense in depth: a family builder should never throw given a
    // schema-validated item, but a plugin-shaped `detail` can still carry
    // surprising nested values. Never let that break the transcript.
    return buildGenericToolCallViewModel(item, {
      ...options,
      reason: `Typed family builder threw: ${error instanceof Error ? error.message : String(error)}`,
      rawDetailType: item.detail.type,
    });
  }
}

function buildTypedFamily(
  item: ToolCallTimelineItem,
  options: ToolCallBuildOptions,
): ToolCallViewModel {
  const display = buildToolCallDisplayModel({
    name: item.name,
    status: item.status,
    error: item.error,
    metadata: item.metadata,
    detail: item.detail,
    cwd: options.cwd,
  });
  const status = viewStatus(item.status, options.blockedByPermissionRequestId);
  const timing = timingFields({
    observedAt: options.observedAt,
    previous: options.previous,
  });

  const base = {
    callId: item.callId,
    toolName: item.name,
    status,
    ...(options.blockedByPermissionRequestId
      ? { blockedByPermissionRequestId: options.blockedByPermissionRequestId }
      : {}),
    displayName: display.displayName,
    ...(display.summary !== undefined ? { summary: display.summary } : {}),
    ...(display.errorText !== undefined ? { errorText: display.errorText } : {}),
    ...timing,
    ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
  } as const;

  const detail: ToolCallDetail = item.detail;

  switch (detail.type) {
    case "shell":
      return {
        ...base,
        family: "shell",
        command: detail.command,
        ...(detail.cwd !== undefined ? { cwd: detail.cwd } : {}),
        ...(detail.output !== undefined ? { output: detail.output } : {}),
        ...(detail.exitCode !== undefined ? { exitCode: detail.exitCode } : {}),
      };
    case "read":
      return {
        ...base,
        family: "read",
        filePath: detail.filePath,
        ...(detail.content !== undefined ? { content: detail.content } : {}),
        ...(detail.offset !== undefined ? { offset: detail.offset } : {}),
        ...(detail.limit !== undefined ? { limit: detail.limit } : {}),
      };
    case "edit":
      return {
        ...base,
        family: "edit",
        filePath: detail.filePath,
        ...(detail.oldString !== undefined ? { oldString: detail.oldString } : {}),
        ...(detail.newString !== undefined ? { newString: detail.newString } : {}),
        ...(detail.unifiedDiff !== undefined ? { unifiedDiff: detail.unifiedDiff } : {}),
        ...(detail.edits !== undefined ? { edits: detail.edits } : {}),
        isMultiEdit: (detail.edits?.length ?? 0) > 1,
      };
    case "write":
      return {
        ...base,
        family: "write",
        filePath: detail.filePath,
        ...(detail.content !== undefined ? { content: detail.content } : {}),
      };
    case "search":
      return {
        ...base,
        family: "search",
        query: detail.query,
        ...(detail.toolName !== undefined ? { searchToolName: detail.toolName } : {}),
        ...(detail.content !== undefined ? { content: detail.content } : {}),
        ...(detail.filePaths !== undefined ? { filePaths: detail.filePaths } : {}),
        ...(detail.webResults !== undefined ? { webResults: detail.webResults } : {}),
        ...(detail.annotations !== undefined ? { annotations: detail.annotations } : {}),
        ...(detail.numFiles !== undefined ? { numFiles: detail.numFiles } : {}),
        ...(detail.numMatches !== undefined ? { numMatches: detail.numMatches } : {}),
        ...(detail.durationMs !== undefined ? { searchDurationMs: detail.durationMs } : {}),
        ...(detail.durationSeconds !== undefined
          ? { searchDurationSeconds: detail.durationSeconds }
          : {}),
        ...(detail.truncated !== undefined ? { truncated: detail.truncated } : {}),
        ...(detail.mode !== undefined ? { mode: detail.mode } : {}),
      };
    case "fetch":
      return {
        ...base,
        family: "fetch",
        url: detail.url,
        ...(detail.prompt !== undefined ? { prompt: detail.prompt } : {}),
        ...(detail.result !== undefined ? { result: detail.result } : {}),
        ...(detail.code !== undefined ? { code: detail.code } : {}),
        ...(detail.codeText !== undefined ? { codeText: detail.codeText } : {}),
        ...(detail.bytes !== undefined ? { bytes: detail.bytes } : {}),
        ...(detail.durationMs !== undefined ? { fetchDurationMs: detail.durationMs } : {}),
      };
    case "worktree_setup":
      return {
        ...base,
        family: "worktree_setup",
        worktreePath: detail.worktreePath,
        branchName: detail.branchName,
        log: detail.log,
        commands: detail.commands,
        ...(detail.truncated !== undefined ? { truncated: detail.truncated } : {}),
      };
    case "sub_agent":
      return {
        ...base,
        family: "sub_agent",
        ...(detail.subAgentType !== undefined ? { subAgentType: detail.subAgentType } : {}),
        ...(detail.description !== undefined ? { description: detail.description } : {}),
        ...(detail.childSessionId !== undefined ? { childSessionId: detail.childSessionId } : {}),
        log: detail.log,
        ...(detail.actions !== undefined ? { actions: detail.actions } : {}),
      };
    case "plain_text":
      return {
        ...base,
        family: "plain_text",
        ...(detail.label !== undefined ? { label: detail.label } : {}),
        ...(detail.text !== undefined ? { text: detail.text } : {}),
        ...(detail.icon !== undefined ? { icon: detail.icon } : {}),
      };
    case "plan":
      return {
        ...base,
        family: "plan",
        text: detail.text,
      };
    case "unknown":
      return buildGenericToolCallViewModel(item, {
        ...options,
        reason: 'detail.type === "unknown" (daemon could not classify this tool call).',
        rawDetailType: "unknown",
      });
    default: {
      // Exhaustiveness guard: if `ToolCallDetail` grows a new member this
      // becomes a compile error here, not a runtime throw for callers on
      // an older build receiving the new shape over the wire.
      const neverDetail: never = detail;
      return buildGenericToolCallViewModel(item, {
        ...options,
        reason: "Unrecognized detail.type from a newer protocol version.",
        rawDetailType: (neverDetail as { type?: string })?.type,
      });
    }
  }
}
