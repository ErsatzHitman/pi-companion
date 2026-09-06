import { z } from "zod";

import type { ToolCallDetail } from "../../agent-sdk-types.js";

interface BashToolInput {
  command: string;
  timeout?: number;
}

interface ReadToolInput {
  path: string;
  offset?: number;
  limit?: number;
}

interface EditToolInput {
  path: string;
  edits: Array<{
    oldText: string;
    newText: string;
  }>;
}

interface WriteToolInput {
  path: string;
  content: string;
}

interface FindToolInput {
  pattern: string;
  path?: string;
  limit?: number;
}

interface GrepToolInput {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

interface LsToolInput {
  path?: string;
  limit?: number;
}

interface PiToolResultObject {
  output?: string;
  stdout?: string;
  text?: string;
  content?: PiToolResultContent[];
  exitCode?: number;
  code?: number;
  details?: PiToolResultDetails;
}

interface PiToolResultDetails {
  diff?: string;
  mode?: string;
  server?: string;
  tool?: string;
  mcpResult?: unknown;
  xdev?: unknown;
}

interface PiToolResultTextContent {
  type: "text";
  text: string;
}

interface PiToolResultUnknownContent {
  type: string;
}

type PiToolResultContent = PiToolResultTextContent | PiToolResultUnknownContent;
export type PiToolResult = string | PiToolResultObject | null;

interface PiBashToolCall {
  kind: "bash";
  toolName: "bash";
  args: BashToolInput;
}

interface PiReadToolCall {
  kind: "read";
  toolName: "read";
  args: ReadToolInput;
}

interface PiEditToolCall {
  kind: "edit";
  toolName: "edit";
  args: EditToolInput;
}

interface PiWriteToolCall {
  kind: "write";
  toolName: "write";
  args: WriteToolInput;
}

interface PiFindToolCall {
  kind: "find";
  toolName: "find";
  args: FindToolInput;
}

interface PiGrepToolCall {
  kind: "grep";
  toolName: "grep";
  args: GrepToolInput;
}

interface PiLsToolCall {
  kind: "ls";
  toolName: "ls";
  args: LsToolInput;
}

interface PiUnknownToolCall {
  kind: "unknown";
  toolName: string;
  args: unknown;
}

export type PiTrackedToolCall =
  | PiBashToolCall
  | PiReadToolCall
  | PiEditToolCall
  | PiWriteToolCall
  | PiFindToolCall
  | PiGrepToolCall
  | PiLsToolCall
  | PiUnknownToolCall;

interface ToolCallOutputSummary {
  output?: string;
  exitCode?: number | null;
}

const PiToolResultTextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const PiToolResultUnknownContentSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const PiToolResultContentSchema = z.union([
  PiToolResultTextContentSchema,
  PiToolResultUnknownContentSchema,
]);

const PiToolResultDetailsSchema = z
  .object({
    diff: z.string().optional(),
  })
  .passthrough();

const XdevExecuteDetailsSchema = z.object({
  tool: z.string().trim().min(1),
  mode: z.literal("execute"),
  args: z.unknown().optional(),
  inner: z.unknown().optional(),
});

const PiToolResultObjectSchema = z
  .object({
    output: z.string().optional(),
    stdout: z.string().optional(),
    text: z.string().optional(),
    content: z.array(PiToolResultContentSchema).optional(),
    exitCode: z.number().optional(),
    code: z.number().optional(),
    details: PiToolResultDetailsSchema.optional(),
  })
  .passthrough();

const PiToolResultSchema = z.union([z.string(), PiToolResultObjectSchema, z.null()]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const BashToolInputSchema: z.ZodType<BashToolInput> = z.object({
  command: z.string(),
  timeout: z.number().optional(),
});

const ReadToolInputSchema: z.ZodType<ReadToolInput> = z.object({
  path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

const EditToolInputSchema: z.ZodType<EditToolInput> = z.object({
  path: z.string(),
  edits: z.array(
    z.object({
      oldText: z.string(),
      newText: z.string(),
    }),
  ),
});

const LegacyEditToolInputSchema = z.object({
  path: z.string(),
  old_string: z.string().optional(),
  oldString: z.string().optional(),
  new_string: z.string().optional(),
  newString: z.string().optional(),
});

const WriteToolInputSchema: z.ZodType<WriteToolInput> = z.object({
  path: z.string(),
  content: z.string(),
});

const FindToolInputSchema: z.ZodType<FindToolInput> = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  limit: z.number().optional(),
});

const GrepToolInputSchema: z.ZodType<GrepToolInput> = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  ignoreCase: z.boolean().optional(),
  literal: z.boolean().optional(),
  context: z.number().optional(),
  limit: z.number().optional(),
});

const LsToolInputSchema: z.ZodType<LsToolInput> = z.object({
  path: z.string().optional(),
  limit: z.number().optional(),
});

export function parseToolResult(rawResult: unknown): PiToolResult {
  const parsed = PiToolResultSchema.safeParse(rawResult);
  if (parsed.success) {
    return parsed.data;
  }
  return null;
}

export function extractTextFromToolResult(result: PiToolResult): string | undefined {
  if (typeof result === "string") {
    return result;
  }
  if (!result) {
    return undefined;
  }

  const directText = result.output ?? result.stdout ?? result.text;
  if (directText) {
    return directText;
  }
  if (!result.content) {
    return undefined;
  }

  const textParts: string[] = [];
  for (const block of result.content) {
    if (block.type === "text" && "text" in block) {
      textParts.push(block.text);
    }
  }

  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

export function parseToolArgs(toolName: string, rawArgs: unknown): PiTrackedToolCall {
  if (toolName === "edit") {
    return parseEditToolArgs(rawArgs);
  }
  const schema = SIMPLE_TOOL_SCHEMAS[toolName as SimpleToolKind];
  if (schema) {
    const parsed = schema.safeParse(rawArgs);
    if (parsed.success) {
      return { kind: toolName as SimpleToolKind, toolName, args: parsed.data } as PiTrackedToolCall;
    }
  }
  return { kind: "unknown", toolName, args: rawArgs ?? null };
}

function stripMcpProxyPrefix(toolName: string, serverName: string): string {
  const prefix = `${serverName}_`;
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
}

export function resolveToolCallName(toolCall: PiTrackedToolCall, result?: PiToolResult): string {
  if (toolCall.kind === "write" && result && typeof result !== "string") {
    const xdev = XdevExecuteDetailsSchema.safeParse(result.details?.xdev);
    if (xdev.success) {
      return xdev.data.tool;
    }
  }

  if (toolCall.toolName !== "mcp") {
    return toolCall.toolName;
  }

  if (result && typeof result !== "string") {
    const serverName = readNonEmptyString(result.details?.server);
    const toolName = readNonEmptyString(result.details?.tool);
    if (serverName && toolName) {
      return `${serverName}.${toolName}`;
    }
  }

  if (isRecord(toolCall.args)) {
    const requestedTool = readNonEmptyString(toolCall.args.tool);
    const requestedServer = readNonEmptyString(toolCall.args.server);
    if (requestedTool && requestedServer) {
      return `${requestedServer}.${stripMcpProxyPrefix(requestedTool, requestedServer)}`;
    }
    if (requestedTool) {
      const [serverName, ...toolParts] = requestedTool.split("_");
      if (serverName && toolParts.length > 0) {
        return `${serverName}.${toolParts.join("_")}`;
      }
    }
  }

  return toolCall.toolName;
}

export function mapToolDetail(toolCall: PiTrackedToolCall, result?: PiToolResult): ToolCallDetail {
  const parsedResult = result ?? null;

  switch (toolCall.kind) {
    case "bash": {
      const summary = resolveToolCallOutput(parsedResult);
      return {
        type: "shell",
        command: toolCall.args.command,
        output: summary.output,
        exitCode: summary.exitCode,
      };
    }
    case "read":
      return {
        type: "read",
        filePath: toolCall.args.path,
        content: extractTextFromToolResult(parsedResult),
        offset: toolCall.args.offset,
        limit: toolCall.args.limit,
      };
    case "edit": {
      const firstEdit = toolCall.args.edits[0];
      const unifiedDiff =
        parsedResult && typeof parsedResult !== "string" ? parsedResult.details?.diff : undefined;
      const edits =
        toolCall.args.edits.length > 1
          ? toolCall.args.edits.map((edit) => ({
              oldString: edit.oldText,
              newString: edit.newText,
            }))
          : undefined;

      return {
        type: "edit",
        filePath: toolCall.args.path,
        oldString: firstEdit?.oldText,
        newString: firstEdit?.newText,
        unifiedDiff,
        ...(edits ? { edits } : {}),
      };
    }
    case "write":
      return mapWriteToolDetail(toolCall.args, parsedResult);
    case "find":
      return mapFindToolDetail(toolCall.args, parsedResult);
    case "grep":
      return mapGrepToolDetail(toolCall.args, parsedResult);
    case "ls":
      return mapLsToolDetail(toolCall.args, parsedResult);
    default:
      return {
        type: "unknown",
        input: toolCall.args,
        output: parsedResult,
      };
  }
}

function mapWriteToolDetail(args: WriteToolInput, result: PiToolResult): ToolCallDetail {
  if (result && typeof result !== "string" && result.details && "xdev" in result.details) {
    const xdev = XdevExecuteDetailsSchema.safeParse(result.details.xdev);
    if (xdev.success) {
      return {
        type: "unknown",
        input: xdev.data.args ?? null,
        output: {
          ...result,
          details: xdev.data.inner ?? null,
        },
      };
    }

    return {
      type: "unknown",
      input: args,
      output: result,
    };
  }

  return {
    type: "write",
    filePath: args.path,
    content: args.content,
  };
}

function resolveToolCallOutput(result: PiToolResult): ToolCallOutputSummary {
  if (typeof result === "string") {
    return { output: result };
  }
  if (!result) {
    return {};
  }

  const summary: ToolCallOutputSummary = {
    output: extractTextFromToolResult(result),
  };
  if (typeof result.exitCode === "number") {
    summary.exitCode = result.exitCode;
    return summary;
  }
  if (typeof result.code === "number") {
    summary.exitCode = result.code;
    return summary;
  }
  summary.exitCode = null;
  return summary;
}

function normalizeLegacyEditArgs(rawArgs: unknown): EditToolInput | null {
  const parsed = LegacyEditToolInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return null;
  }

  const oldText = parsed.data.old_string ?? parsed.data.oldString;
  const newText = parsed.data.new_string ?? parsed.data.newString;
  if (!oldText || newText === undefined) {
    return null;
  }

  return {
    path: parsed.data.path,
    edits: [{ oldText, newText }],
  };
}

function parseEditToolArgs(rawArgs: unknown): PiTrackedToolCall {
  const parsed = EditToolInputSchema.safeParse(rawArgs);
  if (parsed.success) {
    return { kind: "edit", toolName: "edit", args: parsed.data };
  }
  const legacyArgs = normalizeLegacyEditArgs(rawArgs);
  if (legacyArgs) {
    return { kind: "edit", toolName: "edit", args: legacyArgs };
  }
  return { kind: "unknown", toolName: "edit", args: rawArgs ?? null };
}

type SimpleToolKind = "bash" | "read" | "write" | "find" | "grep" | "ls";
const SIMPLE_TOOL_SCHEMAS: {
  [K in SimpleToolKind]: { safeParse: (data: unknown) => { success: boolean; data?: unknown } };
} = {
  bash: BashToolInputSchema,
  read: ReadToolInputSchema,
  write: WriteToolInputSchema,
  find: FindToolInputSchema,
  grep: GrepToolInputSchema,
  ls: LsToolInputSchema,
};

function extractSearchResultMeta(result: PiToolResult): {
  filePaths?: string[];
  numMatches?: number;
  numFiles?: number;
  content?: string;
} {
  const content = typeof result === "string" ? result : extractTextFromToolResult(result);
  const meta: { filePaths?: string[]; numMatches?: number; numFiles?: number; content?: string } =
    {};
  if (content) {
    meta.content = content;
  }

  let candidate: Record<string, unknown> | null = null;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    candidate = result as Record<string, unknown>;
    // Pi may nest results inside `details` or `data`
    const maybeDetails = candidate.details;
    if (isRecord(maybeDetails)) {
      candidate = { ...candidate, ...maybeDetails };
    }
    // Also check top-level fields like `filenames` etc directly
  }

  if (candidate) {
    const filePaths = readStringArray(
      candidate.filePaths ?? candidate.filenames ?? candidate.files ?? candidate.paths,
    );
    if (filePaths.length > 0) {
      meta.filePaths = filePaths;
    }
    const numMatchesRaw =
      candidate.numMatches ?? candidate.matches ?? candidate.count ?? candidate.numFiles;
    if (typeof numMatchesRaw === "number" && Number.isFinite(numMatchesRaw)) {
      // Grep count -> numMatches, find/ls count -> numFiles fallback will be normalized by caller
      meta.numMatches = numMatchesRaw;
    }
    const numFilesRaw = candidate.numFiles ?? candidate.fileCount;
    if (typeof numFilesRaw === "number" && Number.isFinite(numFilesRaw)) {
      meta.numFiles = numFilesRaw;
    }
  }

  // Fallback: derive filePaths from newline-separated content if no structured field
  if (!meta.filePaths && content) {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    // Only treat as filePaths if lines look like paths (contain / or . and not too long)
    const likelyPaths = lines.filter(
      (line) => line.length < 512 && (line.includes("/") || line.includes(".")),
    );
    if (likelyPaths.length > 0 && likelyPaths.length === lines.length) {
      meta.filePaths = likelyPaths;
    }
    if (!meta.numMatches && !meta.numFiles && likelyPaths.length > 0) {
      meta.numMatches = likelyPaths.length;
      meta.numFiles = likelyPaths.length;
    }
  }

  return meta;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function mapFindToolDetail(args: FindToolInput, result: PiToolResult): ToolCallDetail {
  const meta = extractSearchResultMeta(result);
  return {
    type: "search",
    query: args.pattern,
    toolName: "search",
    ...(meta.content ? { content: meta.content } : {}),
    ...(meta.filePaths ? { filePaths: meta.filePaths } : {}),
    ...(meta.numFiles !== undefined ? { numFiles: meta.numFiles } : {}),
    ...(meta.numMatches !== undefined ? { numMatches: meta.numMatches } : {}),
  };
}

function mapGrepToolDetail(args: GrepToolInput, result: PiToolResult): ToolCallDetail {
  const meta = extractSearchResultMeta(result);
  return {
    type: "search",
    query: args.pattern,
    toolName: "grep",
    ...(meta.content ? { content: meta.content } : {}),
    ...(meta.filePaths ? { filePaths: meta.filePaths } : {}),
    ...(meta.numMatches !== undefined ? { numMatches: meta.numMatches } : {}),
    ...(meta.numFiles !== undefined ? { numFiles: meta.numFiles } : {}),
  };
}

function mapLsToolDetail(args: LsToolInput, result: PiToolResult): ToolCallDetail {
  const meta = extractSearchResultMeta(result);
  return {
    type: "search",
    query: args.path ?? "ls",
    ...(meta.content ? { content: meta.content } : {}),
    ...(meta.filePaths ? { filePaths: meta.filePaths } : {}),
    ...(meta.numFiles !== undefined ? { numFiles: meta.numFiles } : {}),
  };
}
