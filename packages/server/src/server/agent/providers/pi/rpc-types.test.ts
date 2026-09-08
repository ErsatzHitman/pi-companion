// Set-level drift detector for the Pi RPC mirror (T51B). Split out of T51A's
// audit per the task brief: the audit document
// (`docs/pi-extension-compatibility.md` §9.1-§9.2) records, once, which of
// Pi's `RpcCommand` request-type arms we mirror, defer or deliberately
// exclude. Nothing before this file re-checked that the SET of arms the
// audit decided about still matches the set Pi actually declares. If a
// future Pi upgrade adds a new arm, renames one, or removes one, the audit
// table silently stops covering the real command set and nothing notices.
//
// This is a DIFFERENT test from `rpc-types.pi-mirror.contract.test.ts`
// (T99). That file compares eight NAMED commands FIELD-FOR-FIELD against a
// vendored fragment of Pi's `.d.ts` — it catches a signature drift on a
// command we already know about. This file compares the FULL 32-NAME SET,
// field shapes irrelevant, from two independently-derived sources:
//
//   Side A: what Pi actually declares — the `type: "..."` arm names of the
//   real `RpcCommand` union, read from a vendored, pinned snapshot of just
//   those names (Layer 1, runs everywhere) with a staleness check against
//   whatever Pi is actually installed (Layer 2, `describe.skipIf`-gated).
//
//   Side B: what T51A decided about — every command name that has a row in
//   `docs/pi-extension-compatibility.md` §9.2's verdict table, extracted
//   from the doc's own markdown, not retyped here.
//
// A hardcoded array compared against another hardcoded array in this same
// file would prove nothing but that JavaScript can compare two arrays, so
// neither side is allowed to originate here: Side A comes from a vendored
// snapshot of Pi's OWN declaration text (checked for staleness against the
// real installed Pi below), and Side B comes from parsing the actual
// prose of the audit document.
//
// --- Two-layer pattern, following T99's precedent exactly ---
//
//  1. Layer 1 (unconditional): the vendored snapshot vs. the doc's decision
//     list. Runs on every machine, including CI, which has no `pi` CLI.
//  2. Layer 2 (`describe.skipIf`): the vendored snapshot vs. whatever Pi is
//     actually installed on the machine running the test. Reports as
//     vitest's own SKIPPED count (never silently folded into "passed") when
//     no installed Pi can be found.
//
// What this test does NOT prove: it never opens a socket to any daemon —
// port 6767 (production) and 6768 (dev) are both off-limits to every agent
// in this repository. It also does not re-check field shapes; that is
// `rpc-types.pi-mirror.contract.test.ts`'s job.
//
// --- T152: a third registry keyed by the same identifier ---
//
// `apps/web/src/features/sessions/rpc-command-web-parity.ts`'s
// `SECTION_111_COMMAND_WEB_COVERAGE` array carries its own 32 `command:`
// entries — one per Pi RPC command, classifying each "covered" or "gap" for
// web. Nothing before T152 re-checked that ITS set of command names still
// matches the set Pi actually declares, so a future Pi upgrade could add,
// rename or remove an arm and leave that registry silently stale, the same
// way §9.2 could before this file existed.
//
// The comparison below is anchored to Side A (the vendored Pi snapshot)
// directly, never to §9.2's audited list — Pi is the one authority; §9.2
// and the parity file are both hand-maintained mirrors of it, and comparing
// two mirrors to each other cannot catch the case where both drifted from
// Pi in the same way. The parity file lives under `apps/web/src`; this
// server-side test reads it by path with `readFileSync`, exactly as it
// reads the compatibility doc above — never via an import, which would
// create a `packages/server` -> `apps/web` dependency edge that must not
// exist.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COMPATIBILITY_DOC_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "docs",
  "pi-extension-compatibility.md",
);

// Read by path, not imported — see the T152 module-doc note above.
const WEB_PARITY_FILE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "apps",
  "web",
  "src",
  "features",
  "sessions",
  "rpc-command-web-parity.ts",
);

// Vendored, pinned snapshot of JUST the `RpcCommand` arm names declared by
// the installed Pi's own `dist/modes/rpc/rpc-types.d.ts` —
// captured verbatim, in declaration order, from
// `@earendil-works/pi-coding-agent@0.84.1` on 2026-09-05, the same install
// and date T99's vendored fragment was read from. This is deliberately just
// the 32 names, not the full field shapes T99 already vendors for the eight
// it tracks field-for-field — T51B's job is the SET, not the shape.
//
// When Pi is upgraded and the Layer 2 staleness check below starts failing,
// re-read the real `.d.ts`, update this list and the version string
// together.
const VENDORED_PI_RPC_TYPES_DTS_VERSION = "0.84.1";
const VENDORED_PI_RPC_COMMAND_ARM_NAMES: readonly string[] = [
  "prompt",
  "steer",
  "follow_up",
  "abort",
  "new_session",
  "get_state",
  "set_model",
  "cycle_model",
  "get_available_models",
  "set_thinking_level",
  "cycle_thinking_level",
  "get_available_thinking_levels",
  "set_steering_mode",
  "set_follow_up_mode",
  "compact",
  "set_auto_compaction",
  "set_auto_retry",
  "abort_retry",
  "bash",
  "abort_bash",
  "get_session_stats",
  "export_html",
  "switch_session",
  "fork",
  "clone",
  "get_fork_messages",
  "get_entries",
  "get_tree",
  "get_last_assistant_text",
  "set_session_name",
  "get_messages",
  "get_commands",
];

/**
 * Finds the installed Pi CLI's `rpc-types.d.ts`, or null if none of the
 * candidate locations exist on this machine. Read-only: never writes to, or
 * otherwise modifies, anything under the resolved path. Mirrors
 * `rpc-types.pi-mirror.contract.test.ts`'s `locateInstalledPiRpcTypesDts` —
 * duplicated rather than imported so this file stays self-contained and
 * T99's file (a different task's Owns grant) is never touched by this task.
 */
function locateInstalledPiRpcTypesDts(): string | null {
  const relativeDtsParts = [
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "modes",
    "rpc",
    "rpc-types.d.ts",
  ];

  const envOverride = process.env.PI_RPC_TYPES_D_TS_PATH;
  if (envOverride && existsSync(envOverride)) {
    return envOverride;
  }

  const candidates: string[] = [];

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(path.join(localAppData, "pi-node", "current", ...relativeDtsParts));
  }

  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(finder, ["pi"], { encoding: "utf8" }).trim();
    const firstLine = output.split(/\r?\n/)[0]?.trim();
    if (firstLine) {
      let dir = path.dirname(firstLine);
      for (let i = 0; i < 4; i++) {
        candidates.push(path.join(dir, ...relativeDtsParts));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
  } catch {
    // `pi` is not on PATH on this machine; fall through to what we have.
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Extracts the `type: "..."` arm names from a `RpcCommand` union declared in
 * `dtsSource`, in declaration order. Scoped to the `export type RpcCommand =
 * { ... };` block specifically (stopping at the first line-anchored `};`,
 * which only the union's own closing brace produces — every interior arm
 * boundary is `} | {`, never `};` on its own) so a same-named field on some
 * unrelated type elsewhere in the file can never be mistaken for a 33rd arm.
 */
function extractRpcCommandArmNames(dtsSource: string): string[] {
  const unionMatch = dtsSource.match(/export type RpcCommand = \{[\s\S]*?\n\};/);
  if (!unionMatch) {
    throw new Error('no "export type RpcCommand = { ... };" union found in the given source');
  }
  return [...unionMatch[0].matchAll(/type:\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/g)].map((m) => m[1]);
}

/**
 * Extracts the command names T51A's audit table (§9.2) has a decision row
 * for, from the doc's own markdown — never retyped here. Scoped to the
 * section between the "### 9.2 Verdict table" heading and the next "###"
 * heading, so the extension-UI table just below it (`RpcExtensionUIRequest`/
 * `RpcExtensionUIResponse`, deliberately outside the 32-count per §9.1) is
 * never swept in — though those two names are PascalCase and would not
 * match the lowercase-snake-case pattern below regardless. Matched on a
 * table row whose first cell is a backtick-quoted lowercase identifier
 * (`` | `prompt` | ... ``), which the header row (`| Command | Verdict |
 * Reason |`) and the separator row (`| --- | --- | --- |`) do not satisfy.
 */
function extractAuditedCommandNames(docSource: string): string[] {
  const sectionStart = docSource.indexOf("### 9.2 Verdict table");
  if (sectionStart === -1) {
    throw new Error('could not find "### 9.2 Verdict table" heading in the compatibility doc');
  }
  const sectionEnd = docSource.indexOf("\n### ", sectionStart + 1);
  const section =
    sectionEnd === -1 ? docSource.slice(sectionStart) : docSource.slice(sectionStart, sectionEnd);

  const names = [...section.matchAll(/^\|\s*`([a-z][a-z0-9_]*)`\s*\|/gm)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error(
      "§9.2's verdict table produced zero command names — the doc's table format may have " +
        "changed under this extractor's assumptions",
    );
  }
  return names;
}

/**
 * Strips block comments, then line comments, from `source` before any
 * `command:` matching happens (T159). Without this, `extractParityCommandNames`
 * matched raw file text, so a commented-out registry entry (`// command:
 * "abort_bash",`) counted as present — the P6-W15 gate deleted the real
 * entry, left that comment in its place, and this file's own tests still
 * reported 8 passed. This is the same shape as
 * `scripts/ci/guard-capability-prose.mjs`'s `stripComments`, written locally
 * rather than imported: a `packages/server` test importing from `scripts/`
 * would be a cross-tree dependency edge that does not exist elsewhere in
 * this package and must not start here.
 *
 * Unlike that helper's plain `.replace(/\/\/.*$/gm, "")`, this one tokenizes
 * past string literals FIRST, so a `//` inside a quoted URL or path — this
 * file, and the one it reads, are full of both (GitHub URLs, `packages/...`
 * paths) — is never mistaken for the start of a line comment. Because
 * `String#replace` with a global pattern only tries alternatives at the
 * current scan position, and a string literal can only begin at a quote
 * character (never at `/`), reaching the opening quote of a string commits
 * the match to the whole-string alternative and the comment alternatives
 * never get a chance to fire on anything inside it.
 */
function stripComments(source: string): string {
  return source.replace(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    (match) => (match.startsWith("/*") || match.startsWith("//") ? "" : match),
  );
}

/**
 * Extracts the command names `rpc-command-web-parity.ts`'s
 * `SECTION_111_COMMAND_WEB_COVERAGE` array carries a `"covered"`/`"gap"`
 * entry for, from the file's own source — never retyped here. Each entry
 * is a `command: "some_command",` field on a plain array-literal object;
 * matched directly rather than scoped to the array boundaries first
 * because the file's only other `command:` occurrence is the interface
 * field declaration `readonly command: string;` (no quoted value, so the
 * quoted-string pattern below cannot match it) and the `PlanRpcCommand`
 * import/diff helpers at the bottom of the file contain no `command:
 * "..."` literal at all. Comments are stripped first (T159) so a
 * commented-out `command: "..."` entry is never counted as present.
 */
function extractParityCommandNames(parityFileSource: string): string[] {
  const code = stripComments(parityFileSource);
  const names = [...code.matchAll(/\bcommand:\s*"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error(
      "rpc-command-web-parity.ts produced zero command names — its array-literal format may " +
        "have changed under this extractor's assumptions",
    );
  }
  return names;
}

const installedPiRpcTypesDtsPath = locateInstalledPiRpcTypesDts();

// --- Layer 1: unconditional, runs everywhere including CI (no Pi needed) ---

describe("the audited command set matches Pi's real RpcCommand arm names (T51B)", () => {
  it("the vendored Pi snapshot has exactly the 32 arm names T51A counted, no duplicates", () => {
    expect(VENDORED_PI_RPC_COMMAND_ARM_NAMES.length).toBe(32);
    expect(new Set(VENDORED_PI_RPC_COMMAND_ARM_NAMES).size).toBe(32);
  });

  it("docs/pi-extension-compatibility.md §9.2 has exactly one decision row per Pi arm, no duplicates", () => {
    const docSource = readFileSync(COMPATIBILITY_DOC_PATH, "utf8");
    const auditedNames = extractAuditedCommandNames(docSource);
    expect(auditedNames.length).toBe(32);
    expect(new Set(auditedNames).size).toBe(32);
  });

  it("the vendored Pi arm-name set equals T51A's audited decision-list set, naming any drift", () => {
    const docSource = readFileSync(COMPATIBILITY_DOC_PATH, "utf8");
    const auditedNames = new Set(extractAuditedCommandNames(docSource));
    const piNames = new Set(VENDORED_PI_RPC_COMMAND_ARM_NAMES);

    const newOrRenamedTo = [...piNames].filter((name) => !auditedNames.has(name)).sort();
    const removedOrRenamedFrom = [...auditedNames].filter((name) => !piNames.has(name)).sort();

    const problems: string[] = [];
    if (newOrRenamedTo.length > 0) {
      problems.push(
        `Pi declares ${newOrRenamedTo.length} RpcCommand arm(s) with no row in ` +
          `docs/pi-extension-compatibility.md §9.2: ${newOrRenamedTo.join(", ")}. ` +
          `Add a decision (mirrored / deliberately excluded / deferred) for each, per T51A's rule.`,
      );
    }
    if (removedOrRenamedFrom.length > 0) {
      problems.push(
        `docs/pi-extension-compatibility.md §9.2 has ${removedOrRenamedFrom.length} decision ` +
          `row(s) for a command Pi no longer declares (renamed or removed): ` +
          `${removedOrRenamedFrom.join(", ")}. Update §9.2 to match Pi's real RpcCommand union.`,
      );
    }

    expect(problems.join("\n")).toBe("");
  });

  it("records the Pi version this snapshot was vendored from, for a human to compare against what's installed", () => {
    expect(VENDORED_PI_RPC_TYPES_DTS_VERSION).toBe("0.84.1");
  });
});

describe("the web parity registry matches Pi's real RpcCommand arm names (T152)", () => {
  it("rpc-command-web-parity.ts has exactly one entry per Pi arm, no duplicates", () => {
    const parityFileSource = readFileSync(WEB_PARITY_FILE_PATH, "utf8");
    const parityNames = extractParityCommandNames(parityFileSource);
    expect(parityNames.length).toBe(32);
    expect(new Set(parityNames).size).toBe(32);
  });

  it("the vendored Pi arm-name set equals the web parity registry's command set, naming any drift", () => {
    const parityFileSource = readFileSync(WEB_PARITY_FILE_PATH, "utf8");
    const parityNames = new Set(extractParityCommandNames(parityFileSource));
    const piNames = new Set(VENDORED_PI_RPC_COMMAND_ARM_NAMES);

    const missingFromParity = [...piNames].filter((name) => !parityNames.has(name)).sort();
    const staleInParity = [...parityNames].filter((name) => !piNames.has(name)).sort();

    const problems: string[] = [];
    if (missingFromParity.length > 0) {
      problems.push(
        `Pi declares ${missingFromParity.length} RpcCommand arm(s) with no entry in ` +
          `apps/web/src/features/sessions/rpc-command-web-parity.ts: ${missingFromParity.join(", ")}. ` +
          `Add a "covered"/"gap" entry for each.`,
      );
    }
    if (staleInParity.length > 0) {
      problems.push(
        `apps/web/src/features/sessions/rpc-command-web-parity.ts has ${staleInParity.length} ` +
          `entry/entries for a command Pi no longer declares (renamed or removed): ` +
          `${staleInParity.join(", ")}. Update the registry to match Pi's real RpcCommand union.`,
      );
    }

    expect(problems.join("\n")).toBe("");
  });
});

describe("extractParityCommandNames ignores commented-out entries (T159)", () => {
  it("does not count a line-commented command: entry as present", () => {
    const fixture = [
      "export const SECTION_111_COMMAND_WEB_COVERAGE = [",
      '  { command: "prompt", status: "covered" },',
      '  // { command: "abort_bash", status: "gap" }, formerly here',
      "];",
    ].join("\n");

    expect(extractParityCommandNames(fixture)).toEqual(["prompt"]);
  });

  it("does not count a block-commented command: entry as present", () => {
    const fixture = [
      "export const SECTION_111_COMMAND_WEB_COVERAGE = [",
      '  { command: "prompt", status: "covered" },',
      "  /*",
      '   * { command: "abort_bash", status: "gap" },',
      "   */",
      "];",
    ].join("\n");

    expect(extractParityCommandNames(fixture)).toEqual(["prompt"]);
  });

  it("still counts a real entry that merely follows a comment on an earlier line", () => {
    const fixture = [
      "export const SECTION_111_COMMAND_WEB_COVERAGE = [",
      "  // note: https://example.com/some/path has a // in it too",
      '  { command: "prompt", status: "covered" },',
      '  { command: "abort_bash", status: "gap" },',
      "];",
    ].join("\n");

    expect(extractParityCommandNames(fixture)).toEqual(["prompt", "abort_bash"]);
  });

  it("does not truncate a real entry whose string literal contains a URL with // in it", () => {
    const fixture = [
      "export const SECTION_111_COMMAND_WEB_COVERAGE = [",
      '  { command: "prompt", status: "covered", note: "see https://example.com/x for detail" },',
      '  { command: "abort_bash", status: "gap" },',
      "];",
    ].join("\n");

    expect(extractParityCommandNames(fixture)).toEqual(["prompt", "abort_bash"]);
  });
});

// --- Layer 2: staleness check of the vendored snapshot itself ---
//
// Answers a different question from Layer 1: not "does the audited decision
// list still cover what we last verified Pi to declare" (always checked, on
// every machine, including CI) but "has Pi's real, installed RpcCommand
// union moved since we last vendored its arm names" (checked only where Pi
// is installed). `describe.skipIf` reports these as vitest's own SKIPPED
// count — a distinct, visible line, never folded into "passed" — when no
// installed Pi can be found.
describe.skipIf(!installedPiRpcTypesDtsPath)(
  "the vendored Pi RpcCommand arm-name snapshot stays honest against the installed Pi CLI (T51B staleness check)",
  () => {
    it("the vendored arm-name list still matches the installed Pi CLI's real RpcCommand union, naming any drift", () => {
      if (!installedPiRpcTypesDtsPath) {
        throw new Error("unreachable: describe.skipIf guards this block");
      }
      const installedNames = extractRpcCommandArmNames(
        readFileSync(installedPiRpcTypesDtsPath, "utf8"),
      );
      const installedSet = new Set(installedNames);
      const vendoredSet = new Set(VENDORED_PI_RPC_COMMAND_ARM_NAMES);

      const addedByPi = [...installedSet].filter((name) => !vendoredSet.has(name)).sort();
      const removedByPi = [...vendoredSet].filter((name) => !installedSet.has(name)).sort();

      const problems: string[] = [];
      if (addedByPi.length > 0) {
        problems.push(
          `the installed Pi CLI declares ${addedByPi.length} RpcCommand arm(s) missing from ` +
            `VENDORED_PI_RPC_COMMAND_ARM_NAMES: ${addedByPi.join(", ")}.`,
        );
      }
      if (removedByPi.length > 0) {
        problems.push(
          `VENDORED_PI_RPC_COMMAND_ARM_NAMES lists ${removedByPi.length} arm(s) the installed ` +
            `Pi CLI no longer declares (renamed or removed): ${removedByPi.join(", ")}.`,
        );
      }
      if (problems.length > 0) {
        problems.push(
          `Re-read the installed .d.ts, update VENDORED_PI_RPC_COMMAND_ARM_NAMES and bump ` +
            `VENDORED_PI_RPC_TYPES_DTS_VERSION (currently "${VENDORED_PI_RPC_TYPES_DTS_VERSION}") ` +
            `in rpc-types.test.ts, then re-run T51A's audit (docs/pi-extension-compatibility.md ` +
            `§9.2) for the new/renamed arm(s).`,
        );
      }

      expect(problems.join("\n")).toBe("");
    });

    it("the installed Pi CLI still declares exactly 32 RpcCommand arms, no duplicates", () => {
      if (!installedPiRpcTypesDtsPath) {
        throw new Error("unreachable: describe.skipIf guards this block");
      }
      const installedNames = extractRpcCommandArmNames(
        readFileSync(installedPiRpcTypesDtsPath, "utf8"),
      );
      expect(
        installedNames.length,
        `expected 32 RpcCommand arms, found ${installedNames.length}: ${installedNames.join(", ")}`,
      ).toBe(32);
      expect(new Set(installedNames).size).toBe(installedNames.length);
    });
  },
);
