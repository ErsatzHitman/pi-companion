import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSection111RpcCommands } from "./plan-section-11-1-commands.js";
import type { PlanRpcCommand } from "./plan-section-11-1-commands.js";
import {
  SECTION_111_COMMAND_WEB_COVERAGE,
  diffPlanCommandsAgainstCoverage,
} from "./rpc-command-web-parity.js";

/**
 * T117: `plan-section-11-1-commands.ts` is pure and takes markdown text,
 * not a file path — this `.test.ts` caller reads the real repository
 * plan.md itself, same pattern as
 * `packages/frontend-core/src/testing/plan-table.ts` and
 * `apps/web/src/features/extensions/extension-fixture-renderers.test.tsx`.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let hops = 0; hops < 12; hops += 1) {
    if (existsSync(join(dir, "plan.md"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`findRepoRoot: could not locate plan.md by walking up from ${startDir}`);
}

/** Reads the real repository's plan.md from disk. Throws if it cannot be found. */
function loadPlanMarkdown(): string {
  const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  return readFileSync(join(repoRoot, "plan.md"), "utf8");
}

describe("§11.1 command parity: live plan.md vs. this registry", () => {
  it("plan.md's 32 commands and this registry name exactly the same 32 commands", () => {
    const planCommands = parseSection111RpcCommands(loadPlanMarkdown());
    const diff = diffPlanCommandsAgainstCoverage(planCommands, SECTION_111_COMMAND_WEB_COVERAGE);

    expect(diff.missingFromRegistry).toEqual([]);
    expect(diff.staleInRegistry).toEqual([]);
    expect(diff.duplicatesInPlan).toEqual([]);
  });

  it("this registry classifies exactly 32 commands, each exactly once", () => {
    expect(SECTION_111_COMMAND_WEB_COVERAGE).toHaveLength(32);
    const names = SECTION_111_COMMAND_WEB_COVERAGE.map((entry) => entry.command);
    expect(new Set(names).size).toBe(32);
  });

  it("every registry entry has a non-trivial note (a hollow classification is not a classification)", () => {
    for (const entry of SECTION_111_COMMAND_WEB_COVERAGE) {
      expect(entry.note.length).toBeGreaterThan(20);
    }
  });
});

describe("§11.1 command parity: the diff itself, proven both directions", () => {
  const REALISTIC_PLAN_COMMANDS: PlanRpcCommand[] = [
    { group: "conversation", command: "prompt" },
    { group: "conversation", command: "steer" },
  ];
  const REALISTIC_COVERAGE = [
    { command: "prompt", status: "covered" as const, note: "covered by X" },
    { command: "steer", status: "covered" as const, note: "covered by Y" },
  ];

  it("agrees when plan.md and the registry name exactly the same commands", () => {
    const diff = diffPlanCommandsAgainstCoverage(REALISTIC_PLAN_COMMANDS, REALISTIC_COVERAGE);
    expect(diff).toEqual({ missingFromRegistry: [], staleInRegistry: [], duplicatesInPlan: [] });
  });

  it("MUTATION: a command added to plan.md's list that the registry does not classify FAILS by name", () => {
    const planWithNewCommand: PlanRpcCommand[] = [
      ...REALISTIC_PLAN_COMMANDS,
      { group: "conversation", command: "whisper" },
    ];
    const diff = diffPlanCommandsAgainstCoverage(planWithNewCommand, REALISTIC_COVERAGE);
    expect(diff.missingFromRegistry).toEqual(["whisper"]);
    expect(diff.staleInRegistry).toEqual([]);
  });

  it("MUTATION: a command the registry still lists after plan.md drops it FAILS by name", () => {
    const planWithoutSteer: PlanRpcCommand[] = [{ group: "conversation", command: "prompt" }];
    const diff = diffPlanCommandsAgainstCoverage(planWithoutSteer, REALISTIC_COVERAGE);
    expect(diff.staleInRegistry).toEqual(["steer"]);
    expect(diff.missingFromRegistry).toEqual([]);
  });

  it("MUTATION: a command plan.md lists twice is reported as a duplicate rather than silently ignored", () => {
    const planWithDuplicate: PlanRpcCommand[] = [
      ...REALISTIC_PLAN_COMMANDS,
      { group: "conversation", command: "prompt" },
    ];
    const diff = diffPlanCommandsAgainstCoverage(planWithDuplicate, REALISTIC_COVERAGE);
    expect(diff.duplicatesInPlan).toEqual(["prompt"]);
  });
});

describe("§11.1 command parity: disclosed gaps named individually", () => {
  it("names every command with no working web path today", () => {
    const gaps = SECTION_111_COMMAND_WEB_COVERAGE.filter((entry) => entry.status === "gap").map(
      (entry) => entry.command,
    );

    // This is the truthful gap list this task's report is built from.
    // Changing this array without also changing the registry above (or
    // vice versa) fails this test — it is not decorative.
    expect(gaps.sort()).toEqual(
      [
        "fork",
        "clone",
        "get_fork_messages",
        "set_session_name",
        "get_state",
        "get_tree",
        "get_last_assistant_text",
        "get_session_stats",
        "cycle_model",
        "cycle_thinking_level",
        "set_steering_mode",
        "set_follow_up_mode",
        "set_auto_retry",
        "abort_retry",
        "compact",
        "export_html",
        "bash",
        "abort_bash",
      ].sort(),
    );
  });

  it("names every command with a real, proven working web path today", () => {
    const covered = SECTION_111_COMMAND_WEB_COVERAGE.filter(
      (entry) => entry.status === "covered",
    ).map((entry) => entry.command);

    expect(covered.sort()).toEqual(
      [
        "prompt",
        "steer",
        "follow_up",
        "abort",
        "new_session",
        "switch_session",
        "get_messages",
        "get_entries",
        "set_model",
        "get_available_models",
        "set_thinking_level",
        "get_available_thinking_levels",
        "get_commands",
        "set_auto_compaction",
      ].sort(),
    );
  });
});
