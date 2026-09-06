export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

// T97: mirrors Pi's own inline `streamingBehavior?: "steer" | "followUp"` on
// the `prompt` RPC command (installed Pi's `dist/modes/rpc/rpc-types.d.ts`
// `RpcCommand`, "prompt" arm). Routes a single `prompt` message as a steer
// or a follow-up, independent of (and overriding, for that one message) the
// session's current steering/follow-up mode. See `PromptStreamingBehaviorSchema`
// in `packages/protocol/src/messages.ts` (T38B0a) for the wire-level field
// this mirrors on our side of the protocol.
export type PiPromptStreamingBehavior = "steer" | "followUp";

// T38B0b: mirrors the value union Pi's own `set_steering_mode` / `set_follow_up_mode`
// RPC commands and `get_state` response both use for the `mode` /
// `steeringMode` / `followUpMode` fields (installed Pi's
// `dist/modes/rpc/rpc-types.d.ts`: the "set_steering_mode" and
// "set_follow_up_mode" arms of `RpcCommand`, and `RpcSessionState`). "all"
// delivers every queued message together; "one-at-a-time" delivers one per
// cycle. See `QueueModeSchema` in `packages/protocol/src/messages.ts`
// (T38B0a) for the wire-level type this mirrors on our side of the protocol.
export type PiQueueMode = "all" | "one-at-a-time";

// T143: mirrors Pi's own LLM usage shape for the summarization call(s) that
// produced a compaction (installed Pi's (`%LOCALAPPDATA%\pi-node\current\
// node_modules\@earendil-works`) nested `pi-coding-agent/node_modules/
// @earendil-works/pi-ai/dist/types.d.ts:253-273` `Usage`, v0.84.1). Not
// carried past this mirror today — see T143's report for the exact seam
// (`PiCompactionResult.usage` below) left to close.
export interface PiCompactionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

// T143: mirrors Pi's own `CompactionResult<T = unknown>` (installed Pi's
// `dist/core/compaction/compaction.d.ts:18-27`, v0.84.1) as carried on the
// `compaction_end` `AgentSessionEvent` (installed Pi's
// `dist/core/agent-session.d.ts:65-70`: `result: CompactionResult |
// undefined`, unparametrized — so `details` below is that interface's
// generic `T` at its default, `unknown`, not a compile-time guarantee of
// any shape). Pi's own doc comment on `CompactionDetails`
// ("Details stored in CompactionEntry.details for file tracking") is the
// only signal that `{ readFiles, modifiedFiles }` is what actually arrives
// in `details`; callers must treat it as a best-effort runtime shape (see
// `readPiCompactionFileLists` in `./agent.ts`), never a compile-time-safe
// field. Confirmed against the installed Pi field-for-field: `summary`,
// `firstKeptEntryId`, `tokensBefore`, `estimatedTokensAfter`, `usage`,
// `details` — matching T51A's recorded hypothesis exactly, with one
// correction T51A could not make from the audit alone: `details` is typed
// `unknown` at this level, not `{ readFiles, modifiedFiles }` directly.
export interface PiCompactionResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
  usage?: PiCompactionUsage;
  details?: unknown;
}

export interface PiImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
export interface PiPromptAck {
  agentInvoked?: boolean;
}

export interface PiPromptAck {
  requestId?: string;
  agentInvoked?: boolean;
}

export interface PiTextContent {
  type: "text";
  text: string;
}

export interface PiThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface PiToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
}

export type PiAssistantContent = PiTextContent | PiThinkingContent | PiToolCallContent;

export type PiAgentMessage =
  | {
      role: "user";
      content: string | Array<PiTextContent | PiImageContent>;
    }
  | {
      role: "custom";
      content: string | Array<PiTextContent | PiImageContent>;
      display?: boolean;
    }
  | {
      role: "assistant";
      content: PiAssistantContent[];
      provider?: string;
      model?: string;
      responseId?: string;
      responseModel?: string;
      errorMessage?: string | null;
      stopReason?: string;
    }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: unknown;
      isError?: boolean;
      details?: unknown;
    }
  | {
      role: "bashExecution";
      command: string;
      output?: string;
      exitCode?: number | null;
      cancelled?: boolean;
      timestamp: number;
    };

export interface PiModel {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  api?: string;
  baseUrl?: string;
  input?: string[];
  cost?: Record<string, unknown>;
  compat?: unknown;
}

export interface PiSessionState {
  model?: PiModel | null;
  thinkingLevel: PiThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  // T38B0b: Pi's own `RpcSessionState` (installed Pi's
  // `dist/modes/rpc/rpc-types.d.ts:145-156`) declares `steeringMode` and
  // `followUpMode` as REQUIRED fields — every real `get_state` response
  // carries both. They stay optional here, unlike Pi's own type, because
  // this mirror is also the shape used for `PiRpcAgentSession`'s
  // long-lived `this.state` (see `agent.ts`), and no task before T38B0c
  // populates them: T38B0c (`packages/server/src/server/session.ts`, wave
  // P6-W3) is the task that actually reads these off a live `get_state`
  // call and keeps them current. Absence must be read as "not yet sourced
  // from Pi" — never defaulted or cached optimistically by a caller of this
  // type. See `PiQueueMode` above and `GetQueueModesResponseMessageSchema`
  // in `packages/protocol/src/messages.ts` (T38B0a), which models the same
  // fact on the wire by making both fields nullable rather than assuming a
  // value.
  steeringMode?: PiQueueMode;
  followUpMode?: PiQueueMode;
  autoCompactionEnabled?: boolean;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  messageCount: number;
  pendingMessageCount: number;
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number | null;
    percent?: number | null;
  };
  todoPhases?: unknown;
}

export interface PiSessionStats {
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  cost?: number;
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number | null;
    percent?: number | null;
  };
}

// T51A: audited against the installed Pi's real `RpcSlashCommand`
// (`dist/modes/rpc/rpc-types.d.ts:135-144`) and found to have two
// pre-existing drifts, neither introduced by this task and neither fixed
// here (see `docs/pi-extension-compatibility.md`'s T51A findings section
// for the full disclosure):
//  - `sourceInfo` is REQUIRED on Pi's real type; it is optional here.
//  - `input?: { hint?: string }` does not exist on Pi's real type at all.
//    Nothing in this codebase reads `command.input` either (verified:
//    `agent.ts`'s `mapPiSlashCommands` sources `argumentHint` from a
//    hardcoded `PI_HANDLED_BUILTIN_SLASH_COMMANDS` list, never from a
//    per-command `input` field) — it mirrors a field Pi never sends, that
//    we never read.
export interface PiRpcSlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo?: Record<string, unknown>;
  input?: { hint?: string };
}

// T38A0 added `set_auto_retry`, `fork`, `clone` and `set_session_name` below,
// each signature copied from the installed Pi's
// `dist/modes/rpc/rpc-types.d.ts` `RpcCommand` union (verified against
// `@earendil-works/pi-coding-agent` under the local `pi-node` install) and
// proven against that same file by `rpc-types.pi-mirror.contract.test.ts`.
// That test only compares source text to the installed `.d.ts`; per the
// no-socket rule for agents, NONE of the four has been exercised against a
// running daemon (dev or production). T38A3, T38A4 and T38B2 (whichever
// lands first) must perform that live round-trip before relying on these
// shapes in production code paths, and T51A's Phase-7 audit should record
// these four as already decided rather than re-opening them.
export type PiRpcCommand =
  // T97: `streamingBehavior?` mirrors the installed Pi's real `prompt` arm
  // field-for-field (see `PiPromptStreamingBehavior` above) — carries a
  // per-message steer/follow-up routing choice through to Pi. Omitting it
  // preserves the pre-T97 wire shape exactly: `PiCliRuntime.prompt()` only
  // adds the key to the outgoing command when a caller passes one.
  | {
      id?: string;
      type: "prompt";
      message: string;
      images?: PiImageContent[];
      streamingBehavior?: PiPromptStreamingBehavior;
    }
  | { id?: string; type: "compact"; customInstructions?: string }
  | { id?: string; type: "set_auto_compaction"; enabled: boolean }
  | { id?: string; type: "set_auto_retry"; enabled: boolean }
  | { id?: string; type: "abort" }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "get_messages" }
  | { id?: string; type: "get_available_models" }
  | { id?: string; type: "set_model"; provider: string; modelId: string }
  | { id?: string; type: "set_thinking_level"; level: PiThinkingLevel }
  | { id?: string; type: "get_session_stats" }
  | { id?: string; type: "steer"; message: string; images?: PiImageContent[] }
  | { id?: string; type: "follow_up"; message: string; images?: PiImageContent[] }
  // T99: mirrors the installed Pi's real `RpcCommand` "get_entries" arm
  // field-for-field: `{ id?: string; type: "get_entries"; since?: string }`
  // (installed Pi's `dist/modes/rpc/rpc-types.d.ts`, v0.84.1) — this arm
  // previously omitted `since`, a drift T51A disclosed but declined to fix
  // in its own commit to avoid colliding with this task's file (see
  // `docs/pi-extension-compatibility.md`'s `get_entries` row). Proven
  // against that same `.d.ts` field-for-field by
  // `rpc-types.pi-mirror.contract.test.ts`. `since` is not yet read or sent
  // by any caller (`PiCliRuntime.getEntries()` in `cli-runtime.ts` always
  // requests the full entry list) — closing the type drift here does not by
  // itself add incremental-fetch behavior; that remains a separate,
  // unfiled task.
  | { id?: string; type: "get_entries"; since?: string }
  // T142: `get_tree` was REMOVED here (T51A had found it "Mirrored" with a
  // `targetId?: string` field that does not exist on Pi's real arm —
  // `{ id?, type: "get_tree" }`, no other fields). Re-verified before
  // removal: `PiCliRuntime.getTree()`, `session-descriptor.ts`'s
  // `tryGetTreeViaRpc`, and this arm had zero production callers anywhere
  // in `packages/server/src` — only `fake-pi.ts`'s test double implemented
  // it, and it too has been deleted. This was not a missing wire-up of a
  // needed feature: the session tree that actually shipped (T38A1a/T38A3,
  // `apps/web/src/features/sessions/session-tree-state.ts`) is built
  // entirely client-side from the flat `SessionSummary` list plus a
  // client-tracked fork/clone relationships map, and that module's own doc
  // comment names the real closing seam as a parent/fork-source field on
  // `AgentSnapshotPayload`/`fetch_agents_response` — new protocol + server
  // + core work, not a daemon-side RPC round trip through Pi. `get_tree`
  // was ported speculatively along with the rest of the original RPC
  // mirror and never fit the design the tree feature actually took. If a
  // real need for a daemon-truth tree ever emerges, re-add this arm as
  // `{ id?: string; type: "get_tree" }` (no `targetId`, matching Pi
  // exactly) and give it a real caller in the same commit — do not restore
  // it speculatively a second time. See
  // `docs/pi-extension-compatibility.md`'s `get_tree` row for the decision
  // record.
  // Mirrored from Pi's `RpcCommand` union (installed Pi's
  // `dist/modes/rpc/rpc-types.d.ts`): forks the session by branching from a
  // specific transcript entry, matching `{ id?: string; type: "fork"; entryId: string }`.
  | { id?: string; type: "fork"; entryId: string }
  // Mirrored the same way: duplicates the current session onto a new session
  // file with no extra fields, matching `{ id?: string; type: "clone" }`.
  | { id?: string; type: "clone" }
  // Mirrored the same way: renames the session, matching
  // `{ id?: string; type: "set_session_name"; name: string }`.
  | { id?: string; type: "set_session_name"; name: string }
  // T38B0b: mirrors the installed Pi's real `RpcCommand` "set_steering_mode"
  // arm field-for-field: `{ id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }`
  // (`dist/modes/rpc/rpc-types.d.ts:62-65`), proven against that same file by
  // `rpc-types.pi-mirror.contract.test.ts`. Sets the session's steering
  // queue mode; the daemon must read the mode back through `get_state`
  // (`PiSessionState.steeringMode` above) rather than caching the value this
  // command was sent with — see T38B0c, which wires this into
  // `session.ts`.
  | { id?: string; type: "set_steering_mode"; mode: PiQueueMode }
  // T38B0b: mirrors the installed Pi's real `RpcCommand` "set_follow_up_mode"
  // arm field-for-field: `{ id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }`
  // (`dist/modes/rpc/rpc-types.d.ts:66-69`), proven the same way. Same
  // read-back rule as `set_steering_mode` applies to `followUpMode`.
  | { id?: string; type: "set_follow_up_mode"; mode: PiQueueMode }
  // T51A: mirrors the installed Pi's real `RpcCommand` "get_commands" arm
  // field-for-field: `{ id?: string; type: "get_commands" }`
  // (`dist/modes/rpc/rpc-types.d.ts:130-133`) — no fields beyond `id`/`type`.
  // Lists available slash commands (response shaped by `PiRpcSlashCommand`
  // above, whose own two drifts are documented on that interface).
  // `PiCliRuntime.getCommands()` already sends this command in production
  // today via a configurable `commandsRpcName: string` field (default
  // `"get_commands"`, `cli-runtime.ts`), so this arm was NOT closing a
  // missing capability — it was reachable only through `PiRpcCommand`'s
  // trailing `{ id?: string; type: string }` catch-all because
  // `commandsRpcName`'s type is a plain `string`, not the literal
  // `"get_commands"`. This adds the same command as its own explicit,
  // field-checked arm (proven against Pi's real `.d.ts` field-for-field by
  // `rpc-types.pi-mirror.contract.test.ts`, the same way as the six
  // commands T38A0/T38B0b added) rather than leaving a shipped,
  // production-relied-on command with no drift detection of its own. See
  // `docs/pi-extension-compatibility.md`'s T51A findings
  // section for why this one (of 12 previously-unmirrored request types)
  // was mirrored rather than deferred: T28B4's slash-command completion
  // already depends on it, shipped, in production.
  | { id?: string; type: "get_commands" }
  | { id?: string; type: string };

export interface PiRpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export type PiAssistantMessageEvent =
  | { type: "text_delta"; delta?: string }
  | { type: "thinking_delta"; delta?: string }
  | { type: "start" | "text_start" | "text_end" | "thinking_start" | "thinking_end" | "done" };

export type PiAgentSessionEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "turn_end"; message?: PiAgentMessage; toolResults?: unknown[] }
  | { type: "message_start"; message: PiAgentMessage }
  | { type: "message_end"; message: PiAgentMessage }
  | {
      type: "message_update";
      message: PiAgentMessage;
      assistantMessageEvent: PiAssistantMessageEvent;
    }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args?: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
    }
  | { type: "compaction_start"; reason?: "manual" | "threshold" | "overflow" | string }
  | {
      type: "compaction_end";
      reason?: string;
      errorMessage?: string;
      aborted?: boolean;
      willRetry?: boolean;
      result?: PiCompactionResult;
    }
  | { type: "agent_end"; messages?: PiAgentMessage[]; willRetry?: boolean }
  | { type: "agent_settled" }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage?: string;
    }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  | {
      type: "summarization_retry_scheduled";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage?: string;
    }
  | {
      type: "summarization_retry_attempt_start";
      source: "compaction" | "branchSummary" | string;
      reason?: string;
    }
  | { type: "summarization_retry_finished" }
  | { type: "extension_error"; extensionPath?: string; event?: string; error: string };

export type PiRuntimeEvent =
  | PiAgentSessionEvent
  | {
      type: "extension_ui_request";
      id: string;
      method: string;
      [key: string]: unknown;
    }
  | {
      type: "command_output";
      text?: string;
    }
  | {
      type: "process_exit";
      error: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };
