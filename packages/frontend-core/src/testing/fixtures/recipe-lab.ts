/**
 * Shared product-recipe fixtures — plan.md §10.4, T25B/T26B.
 *
 * Framework-neutral case data for the §10.4 "product recipes" (the
 * Beautiful-inspired layer built on top of the §10.3 primitives). Both
 * `apps/web` (T25B) and `apps/android` (T26B) render the exact same cases
 * from this module so the two recipe layers stay in semantic lock-step,
 * exactly like `primitive-lab.ts` does for the primitive layer.
 *
 * Plain data only: no JSX, no React, no React Native, no DOM types.
 */

import type { LabTone } from "./primitive-lab.js";

/** ThinkingSection — a collapsible "Pi is thinking" transcript block. */
export interface ThinkingSectionLabCase {
  id: string;
  summary: string;
  body: string;
  defaultExpanded: boolean;
  durationLabel: string;
}

export const thinkingSectionLabCases: readonly ThinkingSectionLabCase[] = [
  {
    id: "collapsed",
    summary: "Thought for 4s",
    body: "The user wants to fix the failing auth test. I should check the token refresh logic first.",
    defaultExpanded: false,
    durationLabel: "4s",
  },
  {
    id: "expanded",
    summary: "Thought for 12s",
    body: "Checking the daemon's reconnect backoff before touching the client code, since the flaky test may be timing-related rather than logic-related.",
    defaultExpanded: true,
    durationLabel: "12s",
  },
];

/** StreamingMessage — an in-progress assistant turn. */
export interface StreamingMessageLabCase {
  id: string;
  speaker: "assistant" | "user";
  text: string;
  streaming: boolean;
}

export const streamingMessageLabCases: readonly StreamingMessageLabCase[] = [
  {
    id: "user-turn",
    speaker: "user",
    text: "Can you fix the failing login test?",
    streaming: false,
  },
  {
    id: "assistant-streaming",
    speaker: "assistant",
    text: "Looking at the test now, it fails because the refresh token expires before",
    streaming: true,
  },
  {
    id: "assistant-done",
    speaker: "assistant",
    text: "Found it — the refresh token TTL was shorter than the polling interval. Patched.",
    streaming: false,
  },
];

/** ApprovalForm — a tool-call permission request needing user approval. */
export interface ApprovalFormLabCase {
  id: string;
  toolLabel: string;
  detail: string;
  dangerous: boolean;
}

export const approvalFormLabCase: ApprovalFormLabCase = {
  id: "write-file",
  toolLabel: "Write file",
  detail: "src/auth/refresh-token.ts",
  dangerous: false,
};

export const approvalFormDangerousLabCase: ApprovalFormLabCase = {
  id: "run-bash",
  toolLabel: "Run command",
  detail: "rm -rf build/",
  dangerous: true,
};

/** ToolChips — the permission/tool chips shown alongside a tool call. */
export interface ToolChipLabCase {
  id: string;
  label: string;
  tone: LabTone;
  statusText: string;
}

export const toolChipLabCases: readonly ToolChipLabCase[] = [
  { id: "read", label: "Read", tone: "info", statusText: "Allowed" },
  { id: "write", label: "Write", tone: "warning", statusText: "Needs approval" },
  { id: "bash", label: "Bash", tone: "neutral", statusText: "Allowed" },
  { id: "network", label: "Network", tone: "danger", statusText: "Denied" },
];

/** TaskRows — a Pi-generated task/todo list with per-row status. */
export interface TaskRowLabCase {
  id: string;
  title: string;
  status: "pending" | "in-progress" | "done" | "failed";
}

export const taskRowLabCases: readonly TaskRowLabCase[] = [
  { id: "t1", title: "Reproduce the failing test", status: "done" },
  { id: "t2", title: "Patch refresh-token TTL", status: "in-progress" },
  { id: "t3", title: "Re-run the auth suite", status: "pending" },
  { id: "t4", title: "Update changelog", status: "pending" },
  { id: "t5", title: "Deploy staging build", status: "failed" },
];

/** PromptBar — the message composer. */
export interface PromptBarLabCase {
  id: string;
  placeholder: string;
  value: string;
  canSend: boolean;
  queuedCount: number;
}

export const promptBarLabCase: PromptBarLabCase = {
  id: "composer",
  placeholder: "Ask Pi to do something…",
  value: "",
  canSend: false,
  queuedCount: 0,
};

export const promptBarQueuedLabCase: PromptBarLabCase = {
  id: "composer-queued",
  placeholder: "Ask Pi to do something…",
  value: "Also update the README",
  canSend: true,
  queuedCount: 2,
};

/** DiffSummary — added/removed/modified line counts for a patch. */
export interface DiffSummaryLabCase {
  id: string;
  path: string;
  added: number;
  removed: number;
  modified: number;
}

export const diffSummaryLabCases: readonly DiffSummaryLabCase[] = [
  { id: "auth", path: "src/auth/refresh-token.ts", added: 12, removed: 4, modified: 2 },
  { id: "readme", path: "README.md", added: 3, removed: 0, modified: 0 },
];

/** CommandSearch — the slash-command / command-palette combobox. */
export interface CommandSearchItemLabCase {
  id: string;
  label: string;
  hint: string;
}

export interface CommandSearchLabCase {
  id: string;
  placeholder: string;
  items: readonly CommandSearchItemLabCase[];
}

export const commandSearchLabCase: CommandSearchLabCase = {
  id: "commands",
  placeholder: "Search commands…",
  items: [
    { id: "compact", label: "/compact", hint: "Compact the transcript" },
    { id: "clear", label: "/clear", hint: "Start a new session" },
    { id: "model", label: "/model", hint: "Switch model" },
    { id: "review", label: "/review", hint: "Review the current diff" },
  ],
};

/** WorkflowSteps — a multi-step operation (e.g. connect/pairing) tracker. */
export interface WorkflowStepLabCase {
  id: string;
  label: string;
  status: "complete" | "active" | "upcoming" | "error";
}

export const workflowStepsLabCases: readonly WorkflowStepLabCase[] = [
  { id: "scan", label: "Scan pairing code", status: "complete" },
  { id: "verify", label: "Verify host identity", status: "complete" },
  { id: "connect", label: "Establish connection", status: "active" },
  { id: "sync", label: "Sync session list", status: "upcoming" },
];

/** CodeListing — a numbered, language-labelled code excerpt. */
export interface CodeListingLabCase {
  id: string;
  path: string;
  language: string;
  code: string;
  highlightLine?: number;
}

export const codeListingLabCase: CodeListingLabCase = {
  id: "refresh-token",
  path: "src/auth/refresh-token.ts",
  language: "ts",
  code: [
    "export function refreshToken(token: Token): Token {",
    "  const ttl = token.expiresAt - Date.now();",
    "  if (ttl < POLL_INTERVAL_MS) {",
    "    return reissue(token);",
    "  }",
    "  return token;",
    "}",
  ].join("\n"),
  highlightLine: 3,
};

/** SelectionActions — a floating action bar for selected transcript text. */
export interface SelectionActionLabCase {
  id: string;
  label: string;
  icon: "copy" | "close" | "refresh" | "settings";
}

export const selectionActionsLabCase: {
  id: string;
  selectionSummary: string;
  actions: readonly SelectionActionLabCase[];
} = {
  id: "selection",
  selectionSummary: "3 lines selected",
  actions: [
    { id: "copy", label: "Copy", icon: "copy" },
    { id: "quote", label: "Quote in reply", icon: "refresh" },
    { id: "dismiss", label: "Dismiss", icon: "close" },
  ],
};

/**
 * A single record listing every §10.4 product recipe, so both platforms
 * can assert "every recipe renders" from one manifest instead of
 * hand-maintained parallel lists (mirrors `primitiveLabManifest`).
 */
export const recipeLabManifest: readonly string[] = [
  "ThinkingSection",
  "StreamingMessage",
  "ApprovalForm",
  "ToolChips",
  "TaskRows",
  "PromptBar",
  "DiffSummary",
  "CommandSearch",
  "WorkflowSteps",
  "CodeListing",
  "SelectionActions",
];
