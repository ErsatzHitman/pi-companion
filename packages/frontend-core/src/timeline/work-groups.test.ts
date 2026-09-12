/**
 * Tests for `./work-groups.ts` (T388).
 *
 * Pure-model tests: no React, no platform. They pin the three things a
 * renderer depends on — which runs become groups, what the head says, and how
 * the collapse default and its host override resolve.
 */
import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "./transcript-view.js";
import {
  buildTranscriptWorkGroups,
  createWorkGroupCollapseState,
  isWorkGroupCollapsed,
  isWorkGroupMemberKind,
  toggleWorkGroupCollapsed,
  visibleTranscriptEntries,
} from "./work-groups.js";

let nextId = 0;

function thinking(key: string, text = "thinking..."): TranscriptEntry {
  nextId += 1;
  return {
    id: `row-${nextId}`,
    key,
    epoch: "epoch-1",
    seqStart: nextId,
    seqEnd: nextId,
    timestamp: "2026-09-12T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    kind: "thinking",
    text,
  };
}

function toolCall(
  key: string,
  overrides: { displayName?: string; toolName?: string; status?: string; summary?: string } = {},
): TranscriptEntry {
  nextId += 1;
  const displayName = overrides.displayName ?? "Read";
  return {
    id: `row-${nextId}`,
    key,
    epoch: "epoch-1",
    seqStart: nextId,
    seqEnd: nextId,
    timestamp: "2026-09-12T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    kind: "tool-call",
    tool: {
      family: "generic",
      callId: key.replace(/^tool:/, ""),
      toolName: overrides.toolName ?? displayName.toLowerCase(),
      displayName,
      status: overrides.status ?? "completed",
      updateCount: 1,
      ...(overrides.summary !== undefined ? { summary: overrides.summary } : {}),
    },
  } as unknown as TranscriptEntry;
}

function userMessage(key: string): TranscriptEntry {
  nextId += 1;
  return {
    id: `row-${nextId}`,
    key,
    epoch: "epoch-1",
    seqStart: nextId,
    seqEnd: nextId,
    timestamp: "2026-09-12T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    kind: "user-message",
    text: "hello",
  };
}

function assistantMessage(key: string): TranscriptEntry {
  nextId += 1;
  return {
    id: `row-${nextId}`,
    key,
    epoch: "epoch-1",
    seqStart: nextId,
    seqEnd: nextId,
    timestamp: "2026-09-12T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    kind: "assistant-message",
    text: "hi",
    corrected: false,
  };
}

describe("buildTranscriptWorkGroups: which runs become groups", () => {
  it("groups a consecutive thinking + tool-call run and never spans a message", () => {
    const entries = [
      userMessage("client:q"),
      thinking("seq:1"),
      toolCall("tool:c1"),
      assistantMessage("assistant:m1:3"),
      thinking("seq:4"),
      toolCall("tool:c2"),
    ];
    const grouping = buildTranscriptWorkGroups(entries);

    expect(grouping.groups).toHaveLength(2);
    expect(grouping.groups[0]?.memberKeys).toEqual(["seq:1", "tool:c1"]);
    expect(grouping.groups[1]?.memberKeys).toEqual(["seq:4", "tool:c2"]);
    expect(grouping.groupByMemberKey.get("client:q")).toBeUndefined();
    expect(grouping.groupByMemberKey.get("assistant:m1:3")).toBeUndefined();
    expect(grouping.groupByMemberKey.get("tool:c2")?.id).toBe("seq:4");
  });

  it("leaves a lone work row alone (minMembers defaults to 2)", () => {
    const grouping = buildTranscriptWorkGroups([userMessage("client:q"), thinking("seq:1")]);
    expect(grouping.groups).toHaveLength(0);
    expect(grouping.groupByMemberKey.size).toBe(0);
  });

  it("honours a raised minMembers", () => {
    const entries = [thinking("seq:1"), toolCall("tool:c1")];
    expect(buildTranscriptWorkGroups(entries).groups).toHaveLength(1);
    expect(buildTranscriptWorkGroups(entries, { minMembers: 3 }).groups).toHaveLength(0);
  });

  it("is pure: the same entries produce equal groups twice", () => {
    const entries = [thinking("seq:1"), toolCall("tool:c1"), thinking("seq:3")];
    expect(buildTranscriptWorkGroups(entries).groups).toEqual(
      buildTranscriptWorkGroups(entries).groups,
    );
  });

  it("returns the shared empty grouping when nothing groups", () => {
    expect(buildTranscriptWorkGroups([userMessage("client:q")]).groups).toHaveLength(0);
    expect(buildTranscriptWorkGroups([]).groups).toHaveLength(0);
  });

  it("treats only thinking and tool-call as members", () => {
    expect(isWorkGroupMemberKind("thinking")).toBe(true);
    expect(isWorkGroupMemberKind("tool-call")).toBe(true);
    expect(isWorkGroupMemberKind("assistant-message")).toBe(false);
    expect(isWorkGroupMemberKind("compaction")).toBe(false);
  });
});

describe("buildTranscriptWorkGroups: the head summary", () => {
  it("labels a tool run by display name and a tool-less run 'Thinking'", () => {
    expect(
      buildTranscriptWorkGroups([
        thinking("seq:1"),
        toolCall("tool:c1", { displayName: "Read" }),
        toolCall("tool:c2", { displayName: "Grep" }),
      ]).groups[0]?.summary.label,
    ).toBe("Read, Grep");

    expect(
      buildTranscriptWorkGroups([thinking("seq:1"), thinking("seq:2")]).groups[0]?.summary.label,
    ).toBe("Thinking");
  });

  it("de-duplicates repeated tool names and truncates past the label cap", () => {
    expect(
      buildTranscriptWorkGroups([
        toolCall("tool:c1", { displayName: "Read" }),
        toolCall("tool:c2", { displayName: "Read" }),
      ]).groups[0]?.summary.label,
    ).toBe("Read");

    expect(
      buildTranscriptWorkGroups(
        [
          toolCall("tool:c1", { displayName: "Read" }),
          toolCall("tool:c2", { displayName: "Grep" }),
          toolCall("tool:c3", { displayName: "Edit" }),
          toolCall("tool:c4", { displayName: "Bash" }),
        ],
        { maxLabelTools: 3 },
      ).groups[0]?.summary.label,
    ).toBe("Read, Grep, Edit +1 more");
  });

  it("counts members, failures, and still-running calls", () => {
    const grouping = buildTranscriptWorkGroups([
      thinking("seq:1"),
      toolCall("tool:c1", { displayName: "Read", status: "completed" }),
      toolCall("tool:c2", { displayName: "Edit", status: "failed" }),
      toolCall("tool:c3", { displayName: "Bash", status: "running" }),
    ]);
    const group = grouping.groups[0];
    expect(group?.summary).toMatchObject({
      stepCount: 4,
      thinkingCount: 1,
      toolCallCount: 3,
      failedCount: 1,
      runningCount: 1,
    });
    expect(group?.hasFailure).toBe(true);
    expect(group?.isRunning).toBe(true);
  });

  it("carries the first member's own one-line summary as detail", () => {
    const fromThinking = buildTranscriptWorkGroups([
      thinking("seq:1", "first line of reasoning\nsecond line"),
      toolCall("tool:c1"),
    ]);
    expect(fromThinking.groups[0]?.summary.detail).toBe("first line of reasoning");

    const fromTool = buildTranscriptWorkGroups([
      thinking("seq:1", "scanning the tree"),
      toolCall("tool:c1", { displayName: "Bash", summary: "npm test -- --bail=1" }),
      thinking("seq:3"),
    ]);
    expect(fromTool.groups[0]?.summary.detail).toBe("scanning the tree");
  });
});

describe("buildTranscriptWorkGroups: default collapse state", () => {
  it("leaves a two-member group expanded and collapses a three-member group", () => {
    const two = buildTranscriptWorkGroups([thinking("seq:1"), toolCall("tool:c1")]);
    expect(two.groups[0]?.defaultCollapsed).toBe(false);
    expect(two.defaultCollapsedGroupIds.size).toBe(0);

    const three = buildTranscriptWorkGroups([
      thinking("seq:1"),
      toolCall("tool:c1"),
      thinking("seq:3"),
    ]);
    expect(three.groups[0]?.defaultCollapsed).toBe(true);
    expect(three.defaultCollapsedGroupIds.has("seq:1")).toBe(true);
  });

  it("honours defaultCollapsedFromMembers", () => {
    const entries = [thinking("seq:1"), toolCall("tool:c1")];
    expect(
      buildTranscriptWorkGroups(entries, { defaultCollapsedFromMembers: 2 }).groups[0]
        ?.defaultCollapsed,
    ).toBe(true);
    expect(
      buildTranscriptWorkGroups(entries, { defaultCollapsedFromMembers: 5 }).groups[0]
        ?.defaultCollapsed,
    ).toBe(false);
  });

  it("resolves a host override over the group default, and toggles it back", () => {
    const group = buildTranscriptWorkGroups([thinking("seq:1"), toolCall("tool:c1")]).groups[0];
    if (!group) throw new Error("expected a group");

    const empty = createWorkGroupCollapseState();
    expect(isWorkGroupCollapsed(empty, group)).toBe(false);

    const collapsed = toggleWorkGroupCollapsed(empty, group);
    expect(isWorkGroupCollapsed(collapsed, group)).toBe(true);
    expect(isWorkGroupCollapsed(empty, group)).toBe(false); // never mutated

    const expandedAgain = toggleWorkGroupCollapsed(collapsed, group);
    expect(isWorkGroupCollapsed(expandedAgain, group)).toBe(false);
    expect(expandedAgain).not.toBe(collapsed);
  });
});

describe("visibleTranscriptEntries", () => {
  it("keeps a collapsed group's head and drops its other members", () => {
    const entries = [
      userMessage("client:q"),
      thinking("seq:1"),
      toolCall("tool:c1"),
      thinking("seq:3"),
      assistantMessage("assistant:m1:5"),
    ];
    const grouping = buildTranscriptWorkGroups(entries);
    // A three-member group starts collapsed (`defaultCollapsed`), so the
    // empty override state already resolves to collapsed.
    expect(grouping.groups[0]?.defaultCollapsed).toBe(true);

    const visible = visibleTranscriptEntries(entries, grouping, createWorkGroupCollapseState());
    expect(visible.map((entry) => entry.key)).toEqual(["client:q", "seq:1", "assistant:m1:5"]);
  });

  it("returns the input array unchanged (same reference) when nothing is hidden", () => {
    const entries = [thinking("seq:1"), toolCall("tool:c1")];
    const grouping = buildTranscriptWorkGroups(entries);
    const visible = visibleTranscriptEntries(entries, grouping, createWorkGroupCollapseState());
    expect(visible).toBe(entries);
  });

  it("keeps every member of an explicitly expanded group whose default is collapsed", () => {
    const entries = [thinking("seq:1"), toolCall("tool:c1"), thinking("seq:3")];
    const grouping = buildTranscriptWorkGroups(entries);
    expect(grouping.groups[0]?.defaultCollapsed).toBe(true);

    const expanded = toggleWorkGroupCollapsed(
      createWorkGroupCollapseState(),
      grouping.groups[0] as NonNullable<(typeof grouping.groups)[0]>,
    );
    expect(visibleTranscriptEntries(entries, grouping, expanded)).toBe(entries);
  });
});
