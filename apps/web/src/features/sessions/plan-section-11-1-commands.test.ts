import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSection111RpcCommands } from "./plan-section-11-1-commands.js";

/**
 * T117: `plan-section-11-1-commands.ts` itself is pure and takes markdown
 * text, not a file path — the `node:fs`/`node:path`/`node:url` reading of
 * the real repository plan.md lives only here, in the `.test.ts` caller,
 * same pattern as `packages/frontend-core/src/testing/plan-table.ts` and
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

const REAL_SECTION_111 = `### 11.1 Core Pi behavior

The frontend must represent the full Pi RPC lifecycle rather than only chat text:

- agent and turn start/end/settled;
- assistant text and thinking deltas;

The daemon already maps most of this into shared session events. Add frontend views only after confirming the exact protocol payload and feature gate.

The provider contract should be checked against Pi's 32 RPC commands, grouped here so no capability disappears during the rebuild:

- conversation: \`prompt\`, \`steer\`, \`follow_up\`, \`abort\`;
- session lifecycle: \`new_session\`, \`switch_session\`, \`fork\`, \`clone\`, \`get_fork_messages\`, \`set_session_name\`;
- state and history: \`get_state\`, \`get_messages\`, \`get_entries\`, \`get_tree\`, \`get_last_assistant_text\`, \`get_session_stats\`;
- model and reasoning: \`set_model\`, \`cycle_model\`, \`get_available_models\`, \`set_thinking_level\`, \`cycle_thinking_level\`, \`get_available_thinking_levels\`;
- queues and automation: \`set_steering_mode\`, \`set_follow_up_mode\`, \`set_auto_compaction\`, \`set_auto_retry\`, \`abort_retry\`;
- maintenance and export: \`compact\`, \`export_html\`, \`get_commands\`;
- shell: \`bash\`, \`abort_bash\`.

The event fixture set must cover all 21 Pi RPC event types: \`agent_start\`, \`agent_end\`.

### 11.2 Three extension UI tiers

Some unrelated later content.
`;

describe("parseSection111RpcCommands", () => {
  it("extracts all 32 commands across the 7 documented groups from a realistic §11.1 excerpt", () => {
    const commands = parseSection111RpcCommands(REAL_SECTION_111);
    expect(commands).toHaveLength(32);
    expect(new Set(commands.map((c) => c.group))).toEqual(
      new Set([
        "conversation",
        "session lifecycle",
        "state and history",
        "model and reasoning",
        "queues and automation",
        "maintenance and export",
        "shell",
      ]),
    );
    expect(commands.map((c) => c.command)).toContain("fork");
    expect(commands.map((c) => c.command)).toContain("abort_bash");
  });

  it("throws loudly rather than passing vacuously when §11.1's header is absent", () => {
    expect(() => parseSection111RpcCommands("no such section here")).toThrow(
      /heading .*11\.1 Core Pi behavior.* was not found/,
    );
  });

  it("throws loudly when §11.1 exists but is never closed by §11.2", () => {
    const truncated = REAL_SECTION_111.split("### 11.2")[0]!;
    expect(() => parseSection111RpcCommands(truncated)).toThrow(
      /could not find .*11\.2 Three extension UI tiers.* to bound the section/,
    );
  });

  it("throws loudly when §11.1 exists but never introduces the 32-command list", () => {
    const withoutAnchor = REAL_SECTION_111.replace(
      "The provider contract should be checked against Pi's 32 RPC commands, grouped here so no capability disappears during the rebuild:",
      "Nothing to see here.",
    );
    expect(() => parseSection111RpcCommands(withoutAnchor)).toThrow(
      /could not find the .*Pi's 32 RPC commands.* sentence/,
    );
  });

  it("MUTATION: adding a command to a bullet group makes the parser pick it up (33, not 32)", () => {
    const mutated = REAL_SECTION_111.replace(
      "- shell: `bash`, `abort_bash`.",
      "- shell: `bash`, `abort_bash`, `run_hooks`.",
    );
    const commands = parseSection111RpcCommands(mutated);
    expect(commands).toHaveLength(33);
    expect(commands.map((c) => c.command)).toContain("run_hooks");
  });

  it("MUTATION: removing a command from a bullet group makes the parser stop listing it (31, not 32)", () => {
    const mutated = REAL_SECTION_111.replace("- shell: `bash`, `abort_bash`.", "- shell: `bash`.");
    const commands = parseSection111RpcCommands(mutated);
    expect(commands).toHaveLength(31);
    expect(commands.map((c) => c.command)).not.toContain("abort_bash");
  });
});

describe("loadPlanMarkdown", () => {
  it("finds and reads the real repository plan.md, containing §11.1's anchor sentence", () => {
    const markdown = loadPlanMarkdown();
    expect(markdown).toContain("### 11.1 Core Pi behavior");
    expect(markdown).toContain("Pi's 32 RPC commands");
  });

  it("the real plan.md parses to exactly 32 commands today", () => {
    const commands = parseSection111RpcCommands(loadPlanMarkdown());
    expect(commands).toHaveLength(32);
  });
});
