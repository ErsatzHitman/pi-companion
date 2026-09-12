/**
 * Work grouping (T388, plan.md §7.4, §11.1).
 *
 * A turn's *work* — the reasoning and tool calls the agent runs before it
 * writes an answer — arrives as a run of consecutive `thinking` and
 * `tool-call` rows. Rendered one row at a time that run dominates the
 * transcript: a five-step investigation is five full-height rows between the
 * user's question and the answer. This module is the pure, framework-neutral
 * model that turns such a run into **one group** with a derived head/summary
 * and a collapsed state; `apps/web` and `apps/android` render it.
 *
 * ## What is a member
 *
 * Only `thinking` and `tool-call` entries are work members. A tool *result*
 * is not a separate entry kind to include or exclude here: the reducer merges
 * a call's result and every later status update into the call's own row
 * (`./reducer.ts`'s `mergeToolCallItem`), so one `tool-call` entry already
 * *is* the call-and-result run. Any other kind — `user-message`,
 * `assistant-message`, `todo`, `error`, `compaction`, `extension-snapshot`,
 * `unknown` — ends the run: a group never spans a user or assistant message,
 * and the answer is never swallowed into the work that preceded it.
 *
 * ## What the head says
 *
 * `WorkGroupSummary` is derived, never stored: the member count, how many
 * were thinking vs. tool calls, whether any tool failed or is still running,
 * and a label built from the tool display names (`"Read, Grep, Edit"`, or
 * `"Thinking"` when the run has no tool calls). `detail` carries the one
 * line a collapsed head shows under the label — the first member's own
 * summary (a tool's `summary`, or the first line of a thinking block).
 *
 * ## Collapse state
 *
 * Collapse is **host state, not model state**: the model must stay a pure
 * function of the entries, and the same entries must produce the same groups
 * on both platforms. So the model reports a `defaultCollapsed` per group
 * (`defaultCollapsedFromMembers`, below) and this module exposes the tiny
 * pure map operations a host uses to hold the user's overrides — see
 * `isWorkGroupCollapsed` / `toggleWorkGroupCollapsed`.
 *
 * ## The default: collapsed only when the run is long
 *
 * A two-step run (one thought, one tool call) is not noise; hiding it behind
 * a disclosure costs the reader a tap and saves one row. A five-step run is
 * noise. `defaultCollapsedFromMembers` therefore defaults to **3**: a
 * two-member group starts expanded (its head still renders, so the run is
 * still visibly one unit), and a group of three or more starts collapsed.
 * That is a product rule, not a test accommodation — but it has the useful
 * consequence that the pre-grouping row count of a short thinking+tool-call
 * run is unchanged for a reader who never touches the toggle.
 *
 * Repository invariant: this module must never import React, React Native,
 * Expo, DOM types, or browser globals.
 */
import type { TranscriptEntry, TranscriptEntryKind } from "./transcript-view.js";
import { transcriptEntryListKey } from "./transcript-view.js";

/** The entry kinds that count as one unit of an agent's work. */
export const WORK_GROUP_MEMBER_KINDS = ["thinking", "tool-call"] as const;
export type WorkGroupMemberKind = (typeof WORK_GROUP_MEMBER_KINDS)[number];

export function isWorkGroupMemberKind(kind: TranscriptEntryKind): kind is WorkGroupMemberKind {
  return kind === "thinking" || kind === "tool-call";
}

/** Derived, one-line description of a group's work. Never stored on an
 * entry; recomputed from the members every time the grouping is built. */
export interface WorkGroupSummary {
  /** Tool display names (`"Read, Grep, Edit"`), truncated with
   * `+N more` past three, or `"Thinking"` for a run with no tool calls. */
  readonly label: string;
  /** Total members in the group. */
  readonly stepCount: number;
  readonly thinkingCount: number;
  readonly toolCallCount: number;
  /** Tool calls whose status is `"failed"`. */
  readonly failedCount: number;
  /** Tool calls still `"running"` or `"blocked"` on a permission. */
  readonly runningCount: number;
  /** The one line a collapsed head shows under the label: the first
   * member's own summary, when it has one. */
  readonly detail?: string;
}

export interface TranscriptWorkGroup {
  /** Stable group identity: the list key of its first member. Stable across
   * appends, prepends, a coalesced update, a replay, and a re-derivation, for
   * the same reason the member key is (see `./row-key.ts`). */
  readonly id: string;
  /** Every member's stable list key, in source order. `[0]` is the head. */
  readonly memberKeys: readonly string[];
  /** Every member's kind, parallel to `memberKeys`. */
  readonly memberKinds: readonly WorkGroupMemberKind[];
  readonly summary: WorkGroupSummary;
  /** `true` when any member tool call failed — a head renders this
   * differently (a group must never hide a failure behind a neutral label). */
  readonly hasFailure: boolean;
  /** `true` when any member tool call is still running/blocked. */
  readonly isRunning: boolean;
  /** The collapse state this group starts in, before any user override. */
  readonly defaultCollapsed: boolean;
}

export interface BuildWorkGroupsOptions {
  /** Minimum consecutive members for a run to become a group. Default 2: a
   * lone thinking row, or a lone tool call, stays a plain row. */
  readonly minMembers?: number;
  /** A group with at least this many members starts collapsed. Default 3
   * (see this module's doc comment). */
  readonly defaultCollapsedFromMembers?: number;
  /** Above this many tool display names the summary label truncates. Default 3. */
  readonly maxLabelTools?: number;
}

/** Index of a grouping, shaped for the lookup a renderer actually performs:
 * "for this row key, which group is it in (and is it the head)?". */
export interface TranscriptWorkGrouping {
  readonly groups: readonly TranscriptWorkGroup[];
  /** Member key -> its group. A head is `groups` entry whose `memberKeys[0]`
   * equals that key. */
  readonly groupByMemberKey: ReadonlyMap<string, TranscriptWorkGroup>;
  /** Groups that start collapsed, for a host seeding its override state. */
  readonly defaultCollapsedGroupIds: ReadonlySet<string>;
  /** The (empty) groups list when nothing grouped — returned by identity so
   * callers can cheaply detect "no groups here". */
}

export const EMPTY_WORK_GROUPING: TranscriptWorkGrouping = {
  groups: [],
  groupByMemberKey: new Map(),
  defaultCollapsedGroupIds: new Set(),
};

function toolLabel(entry: Extract<TranscriptEntry, { kind: "tool-call" }>): string {
  return entry.tool.displayName.length > 0 ? entry.tool.displayName : entry.tool.toolName;
}

function firstLine(text: string): string | undefined {
  const line = text.split("\n", 1)[0]?.trim();
  return line !== undefined && line.length > 0 ? line : undefined;
}

function memberDetail(entry: TranscriptEntry): string | undefined {
  if (entry.kind === "thinking") {
    return firstLine(entry.text);
  }
  if (entry.kind === "tool-call") {
    const summary = entry.tool.summary;
    if (summary !== undefined && summary.trim().length > 0) {
      return firstLine(summary);
    }
    return toolLabel(entry);
  }
  return undefined;
}

function buildSummary(
  members: readonly TranscriptEntry[],
  maxLabelTools: number,
): WorkGroupSummary {
  const toolLabels: string[] = [];
  let thinkingCount = 0;
  let toolCallCount = 0;
  let failedCount = 0;
  let runningCount = 0;

  for (const member of members) {
    if (member.kind === "thinking") {
      thinkingCount += 1;
      continue;
    }
    if (member.kind !== "tool-call") {
      continue;
    }
    toolCallCount += 1;
    toolLabels.push(toolLabel(member));
    if (member.tool.status === "failed") {
      failedCount += 1;
    }
    if (member.tool.status === "running" || member.tool.status === "blocked") {
      runningCount += 1;
    }
  }

  const uniqueLabels: string[] = [];
  for (const label of toolLabels) {
    if (!uniqueLabels.includes(label)) {
      uniqueLabels.push(label);
    }
  }

  let label: string;
  if (uniqueLabels.length === 0) {
    label = "Thinking";
  } else if (uniqueLabels.length <= maxLabelTools) {
    label = uniqueLabels.join(", ");
  } else {
    label = `${uniqueLabels.slice(0, maxLabelTools).join(", ")} +${uniqueLabels.length - maxLabelTools} more`;
  }

  const head = members[0];
  const detail = head !== undefined ? memberDetail(head) : undefined;

  return {
    label,
    stepCount: members.length,
    thinkingCount,
    toolCallCount,
    failedCount,
    runningCount,
    ...(detail !== undefined ? { detail } : {}),
  };
}

/**
 * Groups consecutive work entries of `entries` into `TranscriptWorkGroup`s,
 * preserving order and never touching an entry. Pure: the same entries always
 * produce the same groups, ids, and summaries.
 */
export function buildTranscriptWorkGroups(
  entries: readonly TranscriptEntry[],
  options: BuildWorkGroupsOptions = {},
): TranscriptWorkGrouping {
  const minMembers = Math.max(2, options.minMembers ?? 2);
  const defaultCollapsedFromMembers = Math.max(
    minMembers,
    options.defaultCollapsedFromMembers ?? 3,
  );
  const maxLabelTools = Math.max(1, options.maxLabelTools ?? 3);

  const groups: TranscriptWorkGroup[] = [];
  const groupByMemberKey = new Map<string, TranscriptWorkGroup>();
  const defaultCollapsedGroupIds = new Set<string>();

  let run: TranscriptEntry[] = [];

  const flush = (): void => {
    if (run.length >= minMembers) {
      const memberKeys = run.map((entry) => transcriptEntryListKey(entry));
      const memberKinds = run.map((entry) => {
        // `run` only ever holds work members, so this narrowing is total.
        return entry.kind === "tool-call" ? "tool-call" : "thinking";
      });
      const summary = buildSummary(run, maxLabelTools);
      const hasFailure = summary.failedCount > 0;
      const isRunning = summary.runningCount > 0;
      const defaultCollapsed = run.length >= defaultCollapsedFromMembers;
      const group: TranscriptWorkGroup = {
        id: memberKeys[0] as string,
        memberKeys,
        memberKinds,
        summary,
        hasFailure,
        isRunning,
        defaultCollapsed,
      };
      groups.push(group);
      for (const key of memberKeys) {
        groupByMemberKey.set(key, group);
      }
      if (defaultCollapsed) {
        defaultCollapsedGroupIds.add(group.id);
      }
    }
    run = [];
  };

  for (const entry of entries) {
    if (isWorkGroupMemberKind(entry.kind)) {
      run.push(entry);
      continue;
    }
    flush();
  }
  flush();

  if (groups.length === 0) {
    return EMPTY_WORK_GROUPING;
  }
  return { groups, groupByMemberKey, defaultCollapsedGroupIds };
}

/** A host's explicit collapse choices, keyed by group id. Absent id means
 * "use the group's own `defaultCollapsed`". */
export type WorkGroupCollapseState = ReadonlyMap<string, boolean>;

export function createWorkGroupCollapseState(): WorkGroupCollapseState {
  return new Map();
}

/** Resolves a group's current collapsed state: the host's explicit choice if
 * one exists, otherwise the group's derived default. */
export function isWorkGroupCollapsed(
  state: WorkGroupCollapseState,
  group: Pick<TranscriptWorkGroup, "id" | "defaultCollapsed">,
): boolean {
  return state.get(group.id) ?? group.defaultCollapsed;
}

/** Returns a new override map with `group`'s collapsed state flipped from
 * whatever `isWorkGroupCollapsed` currently resolves to. Never mutates
 * `state`, so it is safe to use as a React state updater. */
export function toggleWorkGroupCollapsed(
  state: WorkGroupCollapseState,
  group: Pick<TranscriptWorkGroup, "id" | "defaultCollapsed">,
): WorkGroupCollapseState {
  const next = new Map(state);
  next.set(group.id, !isWorkGroupCollapsed(state, group));
  return next;
}
