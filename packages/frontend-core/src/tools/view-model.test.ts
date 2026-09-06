import { describe, expect, it } from "vitest";

import { buildToolCallViewModel } from "./view-model.js";
import type {
  EditToolCallViewModel,
  FetchToolCallViewModel,
  GenericToolCallViewModel,
  PlainTextToolCallViewModel,
  PlanToolCallViewModel,
  ReadToolCallViewModel,
  SearchToolCallViewModel,
  ShellToolCallViewModel,
  SubAgentToolCallViewModel,
  WorktreeSetupToolCallViewModel,
  WriteToolCallViewModel,
} from "./types.js";
import {
  DETAIL_UNKNOWN,
  EDIT_MULTI_COMPLETED,
  EDIT_SINGLE_COMPLETED,
  FETCH_COMPLETED,
  PLAIN_TEXT_TERMINAL,
  PLAN_COMPLETED,
  READ_COMPLETED,
  SEARCH_FAILED,
  SHELL_COMPLETED,
  SUB_AGENT_COMPLETED,
  WORKTREE_SETUP_COMPLETED,
  WRITE_COMPLETED,
} from "./__fixtures__/tool-call-timeline-items.js";

describe("buildToolCallViewModel — every §11.6 family maps to a typed view model", () => {
  it("builds a ShellToolCallViewModel from a shell detail", () => {
    const view = buildToolCallViewModel(SHELL_COMPLETED) as ShellToolCallViewModel;
    expect(view.family).toBe("shell");
    expect(view.callId).toBe("call-synthetic-bash-0001");
    expect(view.command).toBe("pnpm test synthetic-fixture");
    expect(view.output).toBe("3 passed, 0 failed");
    expect(view.exitCode).toBe(0);
    expect(view.status).toBe("completed");
    expect(view.displayName.length).toBeGreaterThan(0);
  });

  it("builds a ReadToolCallViewModel from a read detail", () => {
    const view = buildToolCallViewModel(READ_COMPLETED) as ReadToolCallViewModel;
    expect(view.family).toBe("read");
    expect(view.filePath).toBe("/synthetic/workspace/demo-repo/README.md");
    expect(view.content).toContain("Synthetic demo repo");
  });

  it("builds an EditToolCallViewModel and flags multi-edit calls", () => {
    const single = buildToolCallViewModel(EDIT_SINGLE_COMPLETED) as EditToolCallViewModel;
    expect(single.family).toBe("edit");
    expect(single.isMultiEdit).toBe(false);
    expect(single.unifiedDiff).toContain("+export const value = 2;");

    const multi = buildToolCallViewModel(EDIT_MULTI_COMPLETED) as EditToolCallViewModel;
    expect(multi.isMultiEdit).toBe(true);
    expect(multi.edits).toHaveLength(2);
  });

  it("builds a WriteToolCallViewModel from a write detail", () => {
    const view = buildToolCallViewModel(WRITE_COMPLETED) as WriteToolCallViewModel;
    expect(view.family).toBe("write");
    expect(view.filePath).toBe("/synthetic/workspace/demo-repo/NOTES.md");
  });

  it("builds a SearchToolCallViewModel and carries a failure through", () => {
    const view = buildToolCallViewModel(SEARCH_FAILED) as SearchToolCallViewModel;
    expect(view.family).toBe("search");
    expect(view.status).toBe("failed");
    expect(view.errorText).toContain("permission denied");
  });

  it("builds a FetchToolCallViewModel from a fetch detail", () => {
    const view = buildToolCallViewModel(FETCH_COMPLETED) as FetchToolCallViewModel;
    expect(view.family).toBe("fetch");
    expect(view.url).toBe("https://example.invalid/synthetic");
    expect(view.code).toBe(200);
  });

  it("builds a WorktreeSetupToolCallViewModel with its per-command list", () => {
    const view = buildToolCallViewModel(WORKTREE_SETUP_COMPLETED) as WorktreeSetupToolCallViewModel;
    expect(view.family).toBe("worktree_setup");
    expect(view.commands).toHaveLength(1);
    expect(view.commands[0]?.status).toBe("completed");
  });

  it("builds a SubAgentToolCallViewModel from a sub_agent detail", () => {
    const view = buildToolCallViewModel(SUB_AGENT_COMPLETED) as SubAgentToolCallViewModel;
    expect(view.family).toBe("sub_agent");
    expect(view.childSessionId).toBe("synthetic-session-child-0001");
    expect(view.actions).toHaveLength(1);
  });

  it("builds a PlanToolCallViewModel from a plan detail", () => {
    const view = buildToolCallViewModel(PLAN_COMPLETED) as PlanToolCallViewModel;
    expect(view.family).toBe("plan");
    expect(view.text).toContain("Do the synthetic thing");
  });

  it("builds a PlainTextToolCallViewModel from a plain_text detail", () => {
    const view = buildToolCallViewModel(PLAIN_TEXT_TERMINAL) as PlainTextToolCallViewModel;
    expect(view.family).toBe("plain_text");
    expect(view.label).toBe("Opened terminal");
  });

  it('routes detail.type === "unknown" to the generic fallback, never throwing', () => {
    const view = buildToolCallViewModel(DETAIL_UNKNOWN) as GenericToolCallViewModel;
    expect(view.family).toBe("generic");
    expect(view.callId).toBe("call-synthetic-0099");
    expect(view.toolName).toBe("future_experimental_tool");
    expect(view.reportPayload.rawDetailType).toBe("unknown");
    expect(view.collapsibleInput).toEqual({
      target: "/synthetic/workspace/demo-repo",
      mode: "synthetic-preview",
    });
  });
});

describe("buildToolCallViewModel — never throws on malformed input", () => {
  const malformedInputs: unknown[] = [
    null,
    undefined,
    42,
    "not an object",
    [],
    {},
    { type: "tool_call" },
    { type: "tool_call", callId: "x" },
    { type: "tool_call", callId: "x", name: "y", status: "running", error: null },
    {
      type: "tool_call",
      callId: "x",
      name: "y",
      status: "mystery_status",
      error: null,
      detail: { type: "shell", command: "x" },
    },
    {
      type: "tool_call",
      callId: "x",
      name: "y",
      status: "running",
      error: null,
      detail: { type: "a_type_from_the_future", weird: true },
    },
    {
      type: "tool_call",
      callId: 5,
      name: "y",
      status: "running",
      error: null,
      detail: { type: "shell", command: "x" },
    },
    { type: "assistant_message", text: "hi" },
    { type: "tool_call", callId: "x", name: "y", status: "running", error: null, detail: null },
    { type: "tool_call", callId: "x", name: "y", status: "running", error: null, detail: "shell" },
  ];

  it.each(malformedInputs.map((value, index) => [index, value] as const))(
    "case %i never throws and returns a generic view model",
    (_index, value) => {
      expect(() => buildToolCallViewModel(value)).not.toThrow();
      const view = buildToolCallViewModel(value);
      expect(view.family).toBe("generic");
      expect(typeof (view as GenericToolCallViewModel).copyPayload).toBe("string");
    },
  );

  it("still recovers a usable callId/toolName from a partially-malformed item", () => {
    const view = buildToolCallViewModel({
      type: "tool_call",
      callId: "call-recoverable-0001",
      name: "weird_tool",
      status: "running",
      error: null,
      detail: { type: "a_type_from_the_future", weird: true },
    }) as GenericToolCallViewModel;
    expect(view.callId).toBe("call-recoverable-0001");
    expect(view.toolName).toBe("weird_tool");
  });
});

describe("buildToolCallViewModel — blocked/permission-required state", () => {
  it("marks a running call as blocked when the caller supplies a pending permission request id", () => {
    const view = buildToolCallViewModel(SHELL_COMPLETED, {
      blockedByPermissionRequestId: "perm-req-0001",
    });
    expect(view.status).toBe("blocked");
    expect(view.blockedByPermissionRequestId).toBe("perm-req-0001");
  });
});

describe("buildToolCallViewModel — cwd stripping reuses @picompanion/protocol/tool-call-display", () => {
  it("strips a supplied cwd from the read summary", () => {
    const view = buildToolCallViewModel(READ_COMPLETED, {
      cwd: "/synthetic/workspace/demo-repo",
    }) as ReadToolCallViewModel;
    expect(view.summary).toBe("README.md");
  });
});
