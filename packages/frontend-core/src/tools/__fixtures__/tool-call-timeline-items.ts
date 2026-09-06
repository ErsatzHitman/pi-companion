/**
 * Test-only `tool_call` timeline item fixtures for the tools domain.
 *
 * These are hand-written to the wire shape frontend-core actually
 * consumes (`AgentTimelineItem` with `type: "tool_call"`, from
 * `@picompanion/protocol/agent-types` / validated by
 * `AgentTimelineItemPayloadSchema` in `@picompanion/protocol/messages`),
 * because the recorded fixtures in
 * `packages/protocol/fixtures/pi-rpc-events/scenarios/*.json` are captured
 * one layer down, at the raw Pi-RPC-provider level (`tool_execution_start`
 * / `_update` / `_end` with `toolCallId`/`toolName`/`args`/`result` —
 * see that directory's README) — the shape the ported Pi provider's
 * `PiRpcAgentSession`/`PiHistoryMapper`
 * (`packages/server/src/server/agent/providers/pi/{agent,history-mapper,
 * tool-call-mapper}.ts`) turns into the `ToolCallDetail`-typed timeline
 * items below. This file preserves the same call ids, tool names, paths,
 * and outcomes as those source scenarios so the two layers describe one
 * consistent synthetic story, translated into the shape this domain reads:
 *
 *  - `tool-calls-single-and-multi-edit.json` -> `EDIT_SINGLE_*` / `EDIT_MULTI_*`
 *  - `partial-tool-output-and-failure.json`  -> `SEARCH_PARTIAL_*` / `SEARCH_FAILED`
 *  - `unknown-tool-call.json`                -> `UNKNOWN_TOOL_*`
 *  - `bash-execution.json`                   -> `SHELL_*`
 *
 * All paths/ids are synthetic, matching that directory's `/synthetic/...`
 * and `call-synthetic-*`/`synthetic-*` convention.
 */
import type { AgentTimelineItem } from "@picompanion/protocol/agent-types";

type ToolCallItem = Extract<AgentTimelineItem, { type: "tool_call" }>;

export const SHELL_RUNNING: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-bash-0001",
  name: "bash",
  status: "running",
  detail: {
    type: "shell",
    command: "pnpm test synthetic-fixture",
  },
  error: null,
};

export const SHELL_COMPLETED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-bash-0001",
  name: "bash",
  status: "completed",
  detail: {
    type: "shell",
    command: "pnpm test synthetic-fixture",
    output: "3 passed, 0 failed",
    exitCode: 0,
  },
  error: null,
};

export const EDIT_SINGLE_RUNNING: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-0001",
  name: "edit",
  status: "running",
  detail: {
    type: "edit",
    filePath: "/synthetic/workspace/demo-repo/src/example.ts",
    oldString: "export const value = 1;",
    newString: "export const value = 2;",
  },
  error: null,
};

export const EDIT_SINGLE_COMPLETED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-0001",
  name: "edit",
  status: "completed",
  detail: {
    type: "edit",
    filePath: "/synthetic/workspace/demo-repo/src/example.ts",
    oldString: "export const value = 1;",
    newString: "export const value = 2;",
    unifiedDiff: "-export const value = 1;\n+export const value = 2;",
  },
  error: null,
};

export const EDIT_MULTI_RUNNING: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-0002",
  name: "edit",
  status: "running",
  detail: {
    type: "edit",
    filePath: "/synthetic/workspace/demo-repo/src/a.ts",
    edits: [
      { oldString: "const a = 1;", newString: "const a = 2;" },
      { oldString: "const b = 1;", newString: "const b = 2;" },
    ],
  },
  error: null,
};

export const EDIT_MULTI_COMPLETED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-0002",
  name: "edit",
  status: "completed",
  detail: {
    type: "edit",
    filePath: "/synthetic/workspace/demo-repo/src/a.ts",
    edits: [
      { oldString: "const a = 1;", newString: "const a = 2;" },
      { oldString: "const b = 1;", newString: "const b = 2;" },
    ],
  },
  error: null,
};

export const SEARCH_RUNNING: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-0003",
  name: "grep",
  status: "running",
  detail: {
    type: "search",
    query: "SYNTHETIC_TOKEN",
    toolName: "grep",
  },
  error: null,
};

export const SEARCH_PARTIAL: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-0003",
  name: "grep",
  status: "running",
  detail: {
    type: "search",
    query: "SYNTHETIC_TOKEN",
    toolName: "grep",
    filePaths: ["/synthetic/workspace/demo-repo/src/config.ts"],
    numMatches: 1,
  },
  error: null,
};

export const SEARCH_PARTIAL_MORE: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-0003",
  name: "grep",
  status: "running",
  detail: {
    type: "search",
    query: "SYNTHETIC_TOKEN",
    toolName: "grep",
    filePaths: [
      "/synthetic/workspace/demo-repo/src/config.ts",
      "/synthetic/workspace/demo-repo/src/secrets.ts",
    ],
    numMatches: 2,
  },
  error: null,
};

export const SEARCH_FAILED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-0003",
  name: "grep",
  status: "failed",
  detail: {
    type: "search",
    query: "SYNTHETIC_TOKEN",
    toolName: "grep",
  },
  error:
    "permission denied reading /synthetic/workspace/demo-repo/src/secrets.ts (synthetic failure)",
};

export const READ_COMPLETED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-read-0001",
  name: "read",
  status: "completed",
  detail: {
    type: "read",
    filePath: "/synthetic/workspace/demo-repo/README.md",
    content: "# Synthetic demo repo\n",
  },
  error: null,
};

export const WRITE_COMPLETED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-write-0001",
  name: "write",
  status: "completed",
  detail: {
    type: "write",
    filePath: "/synthetic/workspace/demo-repo/NOTES.md",
    content: "Synthetic notes.\n",
  },
  error: null,
};

export const FETCH_COMPLETED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-fetch-0001",
  name: "fetch",
  status: "completed",
  detail: {
    type: "fetch",
    url: "https://example.invalid/synthetic",
    result: "Synthetic fetched body.",
    code: 200,
    bytes: 42,
  },
  error: null,
};

export const WORKTREE_SETUP_RUNNING: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-worktree-0001",
  name: "worktree_setup",
  status: "running",
  detail: {
    type: "worktree_setup",
    worktreePath: "/synthetic/workspace/demo-repo/.worktrees/feature",
    branchName: "feature/synthetic",
    log: "Creating worktree...\n",
    commands: [
      {
        index: 1,
        command: "git worktree add .worktrees/feature",
        cwd: "/synthetic/workspace/demo-repo",
        log: "Preparing worktree (new branch 'feature/synthetic')\n",
        status: "running",
        exitCode: null,
      },
    ],
  },
  error: null,
};

export const WORKTREE_SETUP_COMPLETED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-worktree-0001",
  name: "worktree_setup",
  status: "completed",
  detail: {
    type: "worktree_setup",
    worktreePath: "/synthetic/workspace/demo-repo/.worktrees/feature",
    branchName: "feature/synthetic",
    log: "Creating worktree...\nDone.\n",
    commands: [
      {
        index: 1,
        command: "git worktree add .worktrees/feature",
        cwd: "/synthetic/workspace/demo-repo",
        log: "Preparing worktree (new branch 'feature/synthetic')\n",
        status: "completed",
        exitCode: 0,
        durationMs: 120,
      },
    ],
  },
  error: null,
};

export const SUB_AGENT_RUNNING: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-task-0001",
  name: "task",
  status: "running",
  detail: {
    type: "sub_agent",
    subAgentType: "reviewer",
    description: "Review the synthetic diff.",
    childSessionId: "synthetic-session-child-0001",
    log: "Starting review...\n",
  },
  error: null,
};

export const SUB_AGENT_COMPLETED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-task-0001",
  name: "task",
  status: "completed",
  detail: {
    type: "sub_agent",
    subAgentType: "reviewer",
    description: "Review the synthetic diff.",
    childSessionId: "synthetic-session-child-0001",
    log: "Starting review...\nReview complete: looks good.\n",
    actions: [{ index: 1, toolName: "read", summary: "Reviewed example.ts" }],
  },
  error: null,
};

export const PLAN_COMPLETED: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-plan-0001",
  name: "plan",
  status: "completed",
  detail: {
    type: "plan",
    text: "1. Do the synthetic thing.\n2. Verify it.\n",
  },
  error: null,
};

export const PLAIN_TEXT_TERMINAL: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-terminal-0001",
  name: "terminal",
  status: "completed",
  detail: {
    type: "plain_text",
    label: "Opened terminal",
  },
  error: null,
};

export const DETAIL_UNKNOWN: ToolCallItem = {
  type: "tool_call",
  callId: "call-synthetic-0099",
  name: "future_experimental_tool",
  status: "completed",
  detail: {
    type: "unknown",
    input: { target: "/synthetic/workspace/demo-repo", mode: "synthetic-preview" },
    output: { status: "ok", note: "synthetic result payload of unknown shape" },
  },
  error: null,
};
