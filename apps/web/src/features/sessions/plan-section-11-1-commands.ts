/**
 * Parses plan.md §11.1's "Pi's 32 RPC commands" grouped list (T38A5,
 * plan.md §11.1). Pure — takes markdown text, not a file path — so
 * `plan-section-11-1-commands.test.ts` can feed it a synthetic fixture
 * (including a mutated copy of the real section) to prove it fails
 * loudly on malformed input, and to prove the parser really tracks
 * additions/removals to the command list.
 *
 * Deliberately independent of `@picompanion/frontend-core`'s
 * `testing/plan-table.ts` (T104): that module extracts a markdown
 * *table* (§11.7's "First-class UI through bridge elements" rows, one
 * row per `| extension | required UI |` line). §11.1's command list is
 * a different shape entirely — seven prose bullets, each
 * `- <group>: `cmd`, `cmd`, ...;` with no table markup at all — so
 * reusing a table-row extractor would not apply even if this task's
 * Owns line (`apps/web/src/features/sessions/` only) permitted editing
 * that module, which it does not. This task's report records that
 * finding rather than proposing a shared helper T104 would have to own.
 *
 * T117 (this file, resolved): this module used to also load plan.md off
 * disk (`loadPlanMarkdown`/`loadSection111RpcCommands`), which meant a
 * non-test production file imported `node:fs`/`node:path`/`node:url`.
 * That was safe only as long as `features/sessions/index.ts` — the
 * production barrel `routes/root-route.tsx`,
 * `routes/screens/host-session-screen.tsx` and
 * `routes/screens/host-sessions-screen.tsx` all import — never
 * re-exported this module; nothing enforced that, and it briefly failed
 * for one commit at the P6-W5 gate (`cd apps/web && npm run build`
 * emitted three `has been externalized for browser compatibility`
 * warnings naming this file). `plan-table.ts`'s own header states the
 * stricter rule this file now follows too: keep the parser pure, and
 * have each `.test.ts` caller read plan.md off disk itself and hand
 * this module the text. `parseSection111RpcCommands` below has no
 * `node:*` import and takes markdown text, not a file path.
 * `plan-section-11-1-commands.test.ts` and `rpc-command-web-parity.test.ts`
 * each now carry their own `findRepoRoot`/read-plan.md helper (the same
 * pattern `apps/web/src/features/extensions/extension-fixture-renderers.test.tsx`
 * already used for §11.7), so this module can be re-exported from
 * `./index.js` without putting a Node builtin on the browser bundle
 * graph — see `scripts/ci/` (T126, filed, not yet built) for the guard
 * that would enforce this mechanically.
 */

/** One `group: command` pairing from plan.md §11.1's 32-command list. */
export interface PlanRpcCommand {
  /** The bullet's own group label, e.g. `"session lifecycle"`. */
  readonly group: string;
  /** The bare command name, backticks stripped, e.g. `"fork"`. */
  readonly command: string;
}

const SECTION_HEADER = "### 11.1 Core Pi behavior";
const NEXT_SECTION_HEADER = "### 11.2 Three extension UI tiers";
const ANCHOR_SENTENCE = "Pi's 32 RPC commands";
// Matches a bullet like `- session lifecycle: `new_session`, `fork`;` —
// every real bullet in this list ends with `;` except the very last one
// (`- shell: `bash`, `abort_bash`.`), which ends with `.` instead.
const BULLET_PATTERN = /^-\s*([a-z][a-z ]*[a-z]):\s*(.+)[;.]\s*$/i;
const COMMAND_PATTERN = /`([a-z_]+)`/g;

/**
 * Parses the 32-command, 7-group list out of already-loaded plan.md
 * text. Throws — rather than returning an empty or partial result —
 * when §11.1's header, the §11.2 boundary that closes it, the "Pi's 32
 * RPC commands" anchor sentence, or any commands at all cannot be
 * found. A parser that silently returns `[]` on a moved or reworded
 * section is a vacuous pass dressed up as a check.
 */
export function parseSection111RpcCommands(planMarkdown: string): PlanRpcCommand[] {
  const sectionStart = planMarkdown.indexOf(SECTION_HEADER);
  if (sectionStart === -1) {
    throw new Error(
      `parseSection111RpcCommands: heading ${JSON.stringify(SECTION_HEADER)} was not found in the given markdown`,
    );
  }

  const sectionEnd = planMarkdown.indexOf(NEXT_SECTION_HEADER, sectionStart);
  if (sectionEnd === -1) {
    throw new Error(
      `parseSection111RpcCommands: could not find ${JSON.stringify(NEXT_SECTION_HEADER)} after §11.1 to bound the section`,
    );
  }

  const section = planMarkdown.slice(sectionStart, sectionEnd);

  const anchorIndex = section.indexOf(ANCHOR_SENTENCE);
  if (anchorIndex === -1) {
    throw new Error(
      `parseSection111RpcCommands: could not find the ${JSON.stringify(ANCHOR_SENTENCE)} sentence introducing §11.1's command groups`,
    );
  }

  const lines = section.slice(anchorIndex).split("\n");
  const commands: PlanRpcCommand[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = BULLET_PATTERN.exec(line);
    if (!match) continue;
    const group = match[1]!.trim();
    const rest = match[2]!;
    for (const commandMatch of rest.matchAll(COMMAND_PATTERN)) {
      commands.push({ group, command: commandMatch[1]! });
    }
  }

  if (commands.length === 0) {
    throw new Error(
      "parseSection111RpcCommands: matched §11.1 but extracted zero commands — the bullet-list format may have changed",
    );
  }

  return commands;
}
