/**
 * Safe generic tool-call fallback — plan.md §11.6.
 *
 * Builds a `GenericToolCallViewModel` from anything: a validated `tool_call`
 * item whose `detail.type` this build does not recognize, or a raw value
 * that failed schema validation entirely (wrong shape, missing fields, not
 * even an object). This function must never throw.
 */
import {
  isLikelyNamespacedToolName,
  getToolLeafName,
} from "@picompanion/protocol/tool-name-normalization";

import type { GenericToolCallViewModel, ToolCallBuildOptions } from "./types.js";
import { isRecord, readNonEmptyString, safeJsonClone, timingFields } from "./util.js";

function extractSource(toolName: string): string | undefined {
  if (!isLikelyNamespacedToolName(toolName)) {
    return undefined;
  }
  const leaf = getToolLeafName(toolName);
  if (!leaf) {
    return undefined;
  }
  const normalized = toolName.trim().toLowerCase();
  const leafIndex = normalized.lastIndexOf(leaf);
  if (leafIndex <= 0) {
    return undefined;
  }
  return (
    normalized
      .slice(0, leafIndex)
      .replace(/[._:/]+$/, "")
      .replace(/^mcp[._:]*/, "") || undefined
  );
}

function safeCopyPayload(input: {
  toolName: string;
  callId: string;
  status: string;
  input?: unknown;
  result?: unknown;
  error?: unknown;
}): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return `${input.toolName} (${input.callId}): ${input.status}`;
  }
}

export interface BuildGenericOptions extends ToolCallBuildOptions {
  /** Why this fell back to generic, for dev-mode diagnostics (plan.md
   * §11.4: "revision and stale-state display in development"). */
  reason: string;
  /** Best-effort extracted `detail.type`, if the raw value had one. */
  rawDetailType?: string;
}

/**
 * Best-effort field extraction from an arbitrary value. Never throws: every
 * read is guarded, and any field that cannot be recovered is simply
 * omitted from the result.
 */
export function buildGenericToolCallViewModel(
  raw: unknown,
  options: BuildGenericOptions,
): GenericToolCallViewModel {
  const record = isRecord(raw) ? raw : undefined;
  const callId = readNonEmptyString(record?.callId) ?? "unknown-call";
  const toolName =
    readNonEmptyString(record?.name) ?? readNonEmptyString(record?.toolName) ?? "unknown_tool";
  const statusRaw = readNonEmptyString(record?.status);
  const status =
    statusRaw === "running" ||
    statusRaw === "completed" ||
    statusRaw === "failed" ||
    statusRaw === "canceled"
      ? statusRaw
      : "running";

  const detail = isRecord(record?.detail) ? record.detail : undefined;
  const errorValue = "error" in (record ?? {}) ? record?.error : undefined;
  const resultValue = detail && "output" in detail ? detail.output : (detail ?? record?.detail);
  const inputValue = detail && "input" in detail ? detail.input : (record?.args ?? record?.input);

  const metadata = isRecord(record?.metadata)
    ? (record.metadata as Record<string, unknown>)
    : undefined;

  const { startedAt, updatedAt, durationMs, updateCount } = timingFields(options);

  return {
    family: "generic",
    callId,
    toolName,
    status: options.blockedByPermissionRequestId
      ? "blocked"
      : (status as GenericToolCallViewModel["status"]),
    ...(options.blockedByPermissionRequestId
      ? { blockedByPermissionRequestId: options.blockedByPermissionRequestId }
      : {}),
    displayName: toolName,
    ...(options.rawDetailType ? { summary: `Unrecognized detail: ${options.rawDetailType}` } : {}),
    ...(status === "failed" ? { errorText: safeErrorText(errorValue) } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    updateCount,
    ...(metadata ? { metadata } : {}),
    ...(extractSource(toolName) ? { source: extractSource(toolName) } : {}),
    collapsibleInput: safeJsonClone(inputValue),
    ...(status !== "failed" ? { result: safeJsonClone(resultValue) } : {}),
    ...(status === "failed" ? { rawError: safeJsonClone(errorValue) } : {}),
    copyPayload: safeCopyPayload({
      toolName,
      callId,
      status,
      input: safeJsonClone(inputValue),
      result: status !== "failed" ? safeJsonClone(resultValue) : undefined,
      error: status === "failed" ? safeJsonClone(errorValue) : undefined,
    }),
    reportPayload: {
      toolName,
      callId,
      status,
      ...(options.rawDetailType ? { rawDetailType: options.rawDetailType } : {}),
      reason: options.reason,
    },
  };
}

function safeErrorText(error: unknown): string {
  if (error === null || error === undefined) {
    return "Tool call failed";
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Tool call failed";
  }
}
