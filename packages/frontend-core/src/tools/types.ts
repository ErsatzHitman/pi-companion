/**
 * Tool-call view model types — plan.md §7.1, §11.6.
 *
 * These are the presentation-ready shapes the tools domain builds from the
 * daemon's normalized `tool_call` timeline items (`ToolCallTimelineItem` /
 * `ToolCallDetail` in `@picompanion/protocol/agent-types`, produced by the
 * ported Pi provider's history/live mappers). One typed view model per
 * known `ToolCallDetail` family, plus a safe generic fallback for anything
 * this build does not recognize (§11.6: "Never fail the transcript because
 * a plugin returns a new tool detail shape.").
 *
 * Family -> plan §11.6 bullet coverage:
 *  - `shell`         -> "bash and terminal commands"
 *  - `read`          -> "read/list/find/grep/search" (file results half)
 *  - `search`        -> "read/list/find/grep/search", "web/browser actions" (web_search)
 *  - `edit`          -> "write/edit and multi-edit", "diffs and patches"
 *  - `write`         -> "write/edit and multi-edit"
 *  - `fetch`         -> "web/browser actions"
 *  - `worktree_setup`-> "bash and terminal commands" (a sequenced multi-command run)
 *  - `sub_agent`     -> "todo, subagent, workflow, and goal tools" (subagent)
 *  - `plan`          -> "todo, subagent, workflow, and goal tools" (plan/task artifact)
 *  - `plain_text`    -> misc labeled tool output (terminal/thinking overrides)
 *  - `generic`       -> `detail.type === "unknown"`, or any shape this build
 *                       cannot validate at all (forward-compat safety net).
 *
 * "todo", "workflow", and "goal" *tool calls* have no dedicated
 * `ToolCallDetail` variant today — those concepts show up as Pi UI Bridge
 * extension elements (plan.md §11.7: `todo`, `workflows`, `pi-goal`), not as
 * a `tool_call` timeline item shape. Until the wire vocabulary grows one,
 * they correctly render through the generic fallback rather than a
 * purpose-built model that would silently drop unrecognized fields.
 *
 * "Image results" similarly has no dedicated field on the wire today; a
 * tool that returns image bytes will show up as `read.content` (or another
 * family's freeform text field) and renders as text until the protocol
 * grows a typed image result.
 *
 * Repository invariant: this module must never import React, React Native,
 * Expo, DOM types, or browser globals.
 */
import type { ToolCallIconName } from "@picompanion/protocol/agent-types";

/** Presentation-facing execution state. Extends the four wire statuses with
 * `blocked`, a purely local/derived state (plan.md §11.6: "permission-required
 * and blocked states") a caller can request via `ToolCallUpsertOptions` when
 * it knows (from the permissions domain, out of this task's scope) that this
 * call is currently gated on a pending permission decision. */
export type ToolCallViewStatus = "running" | "blocked" | "completed" | "failed" | "canceled";

export interface ToolCallViewModelBase {
  /** Stable identity across running -> ... -> terminal updates for one call. */
  readonly callId: string;
  /** Raw wire tool name (e.g. "edit", "mcp", "future_experimental_tool"). */
  readonly toolName: string;
  readonly status: ToolCallViewStatus;
  /** Present only when `status === "blocked"`. */
  readonly blockedByPermissionRequestId?: string;
  /** Human-facing name, reusing `@picompanion/protocol/tool-call-display`. */
  readonly displayName: string;
  readonly summary?: string;
  /** Formatted failure text; only set when `status === "failed"`. */
  readonly errorText?: string;
  /** First time this callId was observed by the view-model layer, if known. */
  readonly startedAt?: number;
  /** Most recent time this callId was observed by the view-model layer. */
  readonly updatedAt?: number;
  /** `updatedAt - startedAt` once both are known; unset for a single build
   * with no timing context (e.g. `buildToolCallViewModel` called once,
   * outside a `ToolCallViewModelRegistry`). */
  readonly durationMs?: number;
  /** Number of upserts observed for this callId (1 for a single build). */
  readonly updateCount: number;
  readonly metadata?: Record<string, unknown>;
}

export interface ShellToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "shell";
  readonly command: string;
  readonly cwd?: string;
  readonly output?: string;
  readonly exitCode?: number | null;
}

export interface ReadToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "read";
  readonly filePath: string;
  readonly content?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface EditToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "edit";
  readonly filePath: string;
  readonly oldString?: string;
  readonly newString?: string;
  readonly unifiedDiff?: string;
  readonly edits?: ReadonlyArray<{ oldString: string; newString: string }>;
  /** True when `edits` has more than one entry (a multi-edit call). */
  readonly isMultiEdit: boolean;
}

export interface WriteToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "write";
  readonly filePath: string;
  readonly content?: string;
}

export interface SearchToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "search";
  readonly query: string;
  readonly searchToolName?: "search" | "grep" | "glob" | "web_search";
  readonly content?: string;
  readonly filePaths?: readonly string[];
  readonly webResults?: ReadonlyArray<{ title: string; url: string }>;
  readonly annotations?: readonly string[];
  readonly numFiles?: number;
  readonly numMatches?: number;
  readonly searchDurationMs?: number;
  readonly searchDurationSeconds?: number;
  readonly truncated?: boolean;
  readonly mode?: "content" | "files_with_matches" | "count";
}

export interface FetchToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "fetch";
  readonly url: string;
  readonly prompt?: string;
  readonly result?: string;
  readonly code?: number;
  readonly codeText?: string;
  readonly bytes?: number;
  readonly fetchDurationMs?: number;
}

export interface WorktreeSetupCommandView {
  readonly index: number;
  readonly command: string;
  readonly cwd: string;
  readonly log: string;
  readonly status: "running" | "completed" | "failed";
  readonly exitCode: number | null;
  readonly durationMs?: number;
}

export interface WorktreeSetupToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "worktree_setup";
  readonly worktreePath: string;
  readonly branchName: string;
  readonly log: string;
  readonly commands: readonly WorktreeSetupCommandView[];
  readonly truncated?: boolean;
}

export interface SubAgentActionView {
  readonly index: number;
  readonly toolName: string;
  readonly summary?: string;
}

export interface SubAgentToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "sub_agent";
  readonly subAgentType?: string;
  readonly description?: string;
  readonly childSessionId?: string;
  readonly log: string;
  readonly actions?: readonly SubAgentActionView[];
}

export interface PlanToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "plan";
  readonly text: string;
}

export interface PlainTextToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "plain_text";
  readonly label?: string;
  readonly text?: string;
  readonly icon?: ToolCallIconName;
}

/**
 * Safe fallback for `detail.type === "unknown"`, an unrecognized
 * `detail.type` string this build has never heard of, or a `tool_call` item
 * that failed schema validation outright (missing/malformed fields). Never
 * throws building this — see `buildToolCallViewModel`.
 */
export interface GenericToolCallViewModel extends ToolCallViewModelBase {
  readonly family: "generic";
  /** Namespace prefix extracted from a namespaced tool name (e.g. an MCP
   * server name), when one is detectable. */
  readonly source?: string;
  /** JSON-safe view of whatever input/args this call carried, for a
   * collapsible raw-input panel. `undefined` when nothing was recoverable. */
  readonly collapsibleInput?: unknown;
  /** JSON-safe view of the result payload, when the call is not `failed`. */
  readonly result?: unknown;
  /** Raw error payload, when the call is `failed`. */
  readonly rawError?: unknown;
  /** Pre-serialized text a "copy" action can use directly. */
  readonly copyPayload: string;
  /** Small, redaction-safe payload a "report" action can attach as-is. */
  readonly reportPayload: {
    readonly toolName: string;
    readonly callId: string;
    readonly status: string;
    readonly rawDetailType?: string;
    readonly reason: string;
  };
}

export type ToolCallViewModel =
  | ShellToolCallViewModel
  | ReadToolCallViewModel
  | EditToolCallViewModel
  | WriteToolCallViewModel
  | SearchToolCallViewModel
  | FetchToolCallViewModel
  | WorktreeSetupToolCallViewModel
  | SubAgentToolCallViewModel
  | PlanToolCallViewModel
  | PlainTextToolCallViewModel
  | GenericToolCallViewModel;

/** The families `buildToolCallViewModel` recognizes beyond `generic`. */
export const KNOWN_TOOL_CALL_FAMILIES = [
  "shell",
  "read",
  "edit",
  "write",
  "search",
  "fetch",
  "worktree_setup",
  "sub_agent",
  "plan",
  "plain_text",
] as const;

export type KnownToolCallFamily = (typeof KNOWN_TOOL_CALL_FAMILIES)[number];

export interface ToolCallBuildOptions {
  /** Working directory to strip from file paths in the display summary,
   * when the caller has one (plan.md §7.1 does not put session/cwd state in
   * this domain, so this is opt-in and defaults to no stripping). */
  cwd?: string;
  /** See `ToolCallViewModelBase.blockedByPermissionRequestId`. */
  blockedByPermissionRequestId?: string;
  /** Observation time to stamp on the built view model, in epoch ms.
   * Callers outside a `ToolCallViewModelRegistry` (which stamps this from a
   * `Clock`) may leave this unset; timing fields are simply omitted. */
  observedAt?: number;
  /** Previous view model for the same `callId`, so a rebuild can preserve
   * `startedAt` and increment `updateCount` (streaming continuity). */
  previous?: ToolCallViewModel;
}
