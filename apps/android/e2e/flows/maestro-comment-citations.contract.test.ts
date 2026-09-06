import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createFlowRegistry } from "../harness/flow-registry.js";
import {
  checkCitedFiles,
  checkCitedSymbols,
  checkFileContentClaims,
  checkNoPropClaims,
  MAESTRO_DIR,
  REPO_ROOT,
  resetCitationCaches,
  resolveCitedFile,
} from "./maestro-comment-citations.js";
import {
  extractCitedFiles,
  extractCitedSymbols,
  extractFileContentClaims,
  extractNoPropClaims,
  parseMaestroCommentBlocks,
} from "./maestro-yaml.js";

/**
 * T84 (`docs/issues-from-plan.md`) — makes the gate read a Maestro
 * flow's COMMENTS, not only its steps. T72's `parseMaestroSteps`
 * (`./maestro-yaml.ts`) already lets every sibling `*.contract.test.ts`
 * in this directory check a flow's literal `assertVisible`/`tapOn`
 * steps against real source; nothing checked the flow's PROSE, and four
 * consecutive waves shipped a flow whose comments asserted a premise
 * another task in the same wave had already falsified — the sharpest
 * instance being `composer-inputs.yaml`'s header, which cited
 * `features/share/index.ts`'s old "Nothing imports this yet" note after
 * T69 (same wave) had already changed that file to "Mounted as of T69".
 * All 2027 tests at that point were blind to it; only a human reading
 * the yaml at the merge gate caught it.
 *
 * This file is that check, run over every real flow's real comments —
 * not a fixture, not a hand-copied excerpt. Three independent claims,
 * one per `maestro-comment-citations.ts` checker, each proven with a
 * real mutate-run-restore cycle (see this task's own report for the
 * exact byte-for-byte diff of every mutation and its restore):
 *
 * 1. `checkCitedFiles` — TRUE POSITIVE: temporarily renaming a real
 *    backtick file citation in `composer-inputs.yaml`'s header (a
 *    citation naming a file that then does not exist) makes this test
 *    fail, and the failure names the exact bogus path.
 * 2. `checkCitedSymbols` — TRUE POSITIVE: temporarily renaming a real
 *    backtick symbol citation (`` `ShareChooserScreen` `` in the same
 *    header) to a name nothing in source defines makes this test fail,
 *    and the failure names the exact bogus symbol.
 * 3. `checkFileContentClaims` — TRUE POSITIVE: this is the "a flow
 *    comment states a gap another task has since closed" case, proven
 *    against the one real "`<file>` says \"<quote>\"" claim this
 *    directory has today (`composer-inputs.yaml`'s header, about
 *    `features/share/index.ts`). Temporarily editing
 *    `features/share/index.ts` so it no longer contains "Mounted as of
 *    T69" — i.e. simulating a task reverting or rewording the very note
 *    the flow's premise depends on — makes this test fail, and the
 *    failure names both the file and the now-stale quote.
 * 4. TRUE NEGATIVE, all three: this file's own top-level `it` below
 *    (unmodified flows, unmodified source) passes today, over every
 *    real flow's real comments — hundreds of backtick spans, most of
 *    them plain prose (testIds, quoted UI strings, Maestro command
 *    names, task ids, this repo's own `Owns:` convention) that never
 *    trip any of the three checks. That is the check NOT firing on
 *    prose that is merely explanatory, demonstrated at the scale that
 *    matters — every flow this repository ships today, not one crafted
 *    fixture.
 */
describe("maestro flow comments — cited files, symbols, and content claims all resolve", () => {
  const registry = createFlowRegistry();

  for (const flowName of registry.listFlowNames()) {
    it(`${flowName}.yaml's comments cite only real files, real symbols, and current file content`, () => {
      resetCitationCaches();
      const flowPath = registry.resolveFlowPath(flowName);
      const yamlText = readFileSync(flowPath, "utf8");
      const blocks = parseMaestroCommentBlocks(yamlText);

      const fileFailures = blocks.flatMap((block) => checkCitedFiles(extractCitedFiles(block)));
      const symbolFailures = blocks.flatMap((block) =>
        checkCitedSymbols(extractCitedSymbols(block)),
      );
      const claimFailures = blocks.flatMap((block) =>
        checkFileContentClaims(extractFileContentClaims(block)),
      );
      // T91: the unquoted-premise check — see maestro-comment-citations.ts's
      // own doc comment for exactly what this does and does not cover.
      const noPropFailures = blocks.flatMap((block) =>
        checkNoPropClaims(extractNoPropClaims(block)),
      );

      const formatFailures = (failures: { line: number; message: string }[]) =>
        failures.map((f) => `  line ${f.line}: ${f.message}`).join("\n");

      expect(fileFailures, formatFailures(fileFailures)).toHaveLength(0);
      expect(symbolFailures, formatFailures(symbolFailures)).toHaveLength(0);
      expect(claimFailures, formatFailures(claimFailures)).toHaveLength(0);
      expect(noPropFailures, formatFailures(noPropFailures)).toHaveLength(0);
    });
  }
});

describe("resolveCitedFile — the three-way resolution order", () => {
  it("resolves a citation relative to the flow's own directory (../maestro/)", () => {
    expect(resolveCitedFile("composer-inputs.yaml")).toBe(
      path.join(MAESTRO_DIR, "composer-inputs.yaml"),
    );
  });

  it("resolves a citation relative to the repo root when it is not relative to ../maestro/", () => {
    expect(resolveCitedFile("apps/android/package.json")).toBe(
      path.join(REPO_ROOT, "apps/android/package.json"),
    );
  });

  it("resolves a bare filename (no directory component) by basename under SOURCE_ROOTS", () => {
    const resolved = resolveCitedFile("composer-model.ts");
    expect(resolved).toBeDefined();
    expect(resolved).toMatch(/composer-model\.ts$/);
  });

  it("returns undefined for a file that does not exist under any resolution", () => {
    expect(resolveCitedFile("this-file-does-not-exist-anywhere.ts")).toBeUndefined();
  });
});

describe("checkCitedFiles — true positive and true negative on literal fixtures", () => {
  it("TRUE NEGATIVE: a citation naming a real file produces no failure", () => {
    expect(checkCitedFiles([{ line: 1, path: "composer-inputs.yaml" }])).toEqual([]);
  });

  it("TRUE POSITIVE: a citation naming a file nothing on disk resolves to fails, by name", () => {
    const failures = checkCitedFiles([{ line: 7, path: "features/share/index-renamed.ts" }]);
    expect(failures).toHaveLength(1);
    expect(failures[0].line).toBe(7);
    expect(failures[0].message).toContain("features/share/index-renamed.ts");
  });
});

describe("checkCitedSymbols — true positive and true negative on literal fixtures", () => {
  it("TRUE NEGATIVE: a citation naming a real, currently-defined symbol produces no failure", () => {
    expect(checkCitedSymbols([{ line: 1, name: "SessionRoute" }])).toEqual([]);
  });

  it("TRUE POSITIVE: a citation naming a symbol nothing defines fails, by name", () => {
    const failures = checkCitedSymbols([{ line: 42, name: "SessionRouteThatDoesNotExist" }]);
    expect(failures).toHaveLength(1);
    expect(failures[0].line).toBe(42);
    expect(failures[0].message).toContain("SessionRouteThatDoesNotExist");
  });
});

describe("checkFileContentClaims — true positive and true negative on literal fixtures", () => {
  it("TRUE NEGATIVE: a claim whose quote really is in the cited file today produces no failure", () => {
    const failures = checkFileContentClaims([
      { line: 1, file: "apps/android/src/features/share/index.ts", quote: "Mounted as of T69" },
    ]);
    expect(failures).toEqual([]);
  });

  it("TRUE POSITIVE: a claim whose quote is not in the cited file fails, naming both the file and the stale quote", () => {
    const failures = checkFileContentClaims([
      {
        line: 13,
        file: "apps/android/src/features/share/index.ts",
        quote: "Nothing imports this yet — this note was never removed",
      },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0].line).toBe(13);
    expect(failures[0].message).toContain("apps/android/src/features/share/index.ts");
    expect(failures[0].message).toContain("Nothing imports this yet — this note was never removed");
  });
});

describe("checkNoPropClaims — true positive and true negative on literal fixtures (T91)", () => {
  const TERMINAL_ROUTE_TSX =
    "apps/android/src/app/h/[serverId]/session/[agentId]/terminal/[terminalId].tsx";

  it("TRUE NEGATIVE: a claim naming a prop the cited route really does not pass produces no failure", () => {
    const failures = checkNoPropClaims([
      {
        line: 1,
        file: TERMINAL_ROUTE_TSX,
        component: "TerminalScreen",
        prop: "thisPropWillNeverBeWiredHere",
      },
    ]);
    expect(failures).toEqual([]);
  });

  it("TRUE POSITIVE: a claim naming a prop the cited route DOES pass fails, naming the file, the component, and the prop", () => {
    // `webview` really is wired at this route today (T80) — the same
    // fact `files-and-terminal.contract.test.ts` independently pins by
    // source-text. This is what would have caught `84a9738` (P5-W22),
    // which carried exactly this claim a whole wave after the prop was
    // wired in.
    const failures = checkNoPropClaims([
      { line: 106, file: TERMINAL_ROUTE_TSX, component: "TerminalScreen", prop: "webview" },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0].line).toBe(106);
    expect(failures[0].message).toContain(TERMINAL_ROUTE_TSX);
    expect(failures[0].message).toContain("TerminalScreen");
    expect(failures[0].message).toContain("webview");
  });

  it("a claim naming a file that does not resolve fails, naming the file", () => {
    const failures = checkNoPropClaims([
      {
        line: 4,
        file: "app/h/[serverId]/session/[agentId]/nowhere/route-renamed.tsx",
        component: "NowhereScreen",
        prop: "thing",
      },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("route-renamed.tsx");
  });
});

describe("extractNoPropClaims — the true positive/true negative MUTATION pair (T91)", () => {
  // Mirrors the real, reproduced `84a9738` (P5-W22) sentence verbatim in
  // shape: a real `.tsx` file citation immediately followed by "passes",
  // a PascalCase component, and two `no `<prop>`` negations in the same
  // clause. This is the LIVE shape — the one that must fire.
  const LIVE_TEXT =
    "# `app/h/[serverId]/session/[agentId]/files/[...path].tsx` passes\n" +
    "# `FilesScreen` no `filePicker` and no `sharing`, so `files-screen.tsx`'s\n" +
    "# own `uploadController` is `null` whenever `filePicker` is missing.";

  it("TRUE POSITIVE: the live shape extracts both `no <prop>` claims, against the real cited component", () => {
    const block = parseMaestroCommentBlocks(LIVE_TEXT)[0];
    const claims = extractNoPropClaims(block);
    expect(claims).toEqual([
      expect.objectContaining({
        file: "app/h/[serverId]/session/[agentId]/files/[...path].tsx",
        component: "FilesScreen",
        prop: "filePicker",
      }),
      expect.objectContaining({
        file: "app/h/[serverId]/session/[agentId]/files/[...path].tsx",
        component: "FilesScreen",
        prop: "sharing",
      }),
    ]);
  });

  it(
    "TRUE NEGATIVE (mutation of the above): this directory's own real retrospective convention — " +
      "dropping the file citation and prefixing 'This paragraph used to say' — extracts nothing, " +
      "even though the exact same `no `filePicker``/`no `sharing`` words are still present",
    () => {
      // The real edit `files-and-terminal.yaml` carries today (see
      // "CLOSED AT THE P5-W22 MERGE GATE"): the file citation is
      // replaced by bare prose ("the route"), so the anchor's own file
      // citation requirement excludes it before RETROSPECTIVE_MARKER is
      // even consulted.
      const retrospectiveText =
        "# CLOSED AT THE P5-W22 MERGE GATE. This paragraph used to say the\n" +
        "# route passes `FilesScreen` no `filePicker` and no `sharing`, so\n" +
        "# `files-screen.tsx`'s `uploadController` stayed `null`.";
      const block = parseMaestroCommentBlocks(retrospectiveText)[0];
      expect(extractNoPropClaims(block)).toEqual([]);
    },
  );

  it(
    "TRUE NEGATIVE (second real shape): a retrospective paragraph that RE-CITES the file (gerund " +
      "'passing', preceded by 'used to say') extracts nothing, while the same sentence rewritten " +
      "as a live declarative 'passes' DOES extract — the exact `files-and-terminal.yaml` " +
      "webview/T80 diff, both sides",
    () => {
      const TERMINAL_ROUTE = "app/h/[serverId]/session/[agentId]/terminal/[terminalId].tsx";
      const retrospectiveText =
        "# PARTIALLY CLOSED BY T80. This paragraph used to say the terminal was\n" +
        "# unavailable for two reasons: no `react-native-webview` install, AND\n" +
        `# \`${TERMINAL_ROUTE}\` passing \`TerminalScreen\` a real \`transport\` but\n` +
        "# no `webview` prop at all. T80 closed the second reason.";
      const retrospectiveBlock = parseMaestroCommentBlocks(retrospectiveText)[0];
      expect(extractNoPropClaims(retrospectiveBlock)).toEqual([]);

      // The MUTATION: restore the exact live wording `84a9738` carried —
      // drop "used to say", change the gerund back to the declarative
      // "passes". Nothing else about the sentence changes.
      const liveText =
        "# Even once installed, and\n" +
        `# \`${TERMINAL_ROUTE}\` passes \`TerminalScreen\` a real \`transport\` but\n` +
        "# no `webview` prop at all — a second, independent reason.";
      const liveBlock = parseMaestroCommentBlocks(liveText)[0];
      expect(extractNoPropClaims(liveBlock)).toEqual([
        expect.objectContaining({
          file: TERMINAL_ROUTE,
          component: "TerminalScreen",
          prop: "webview",
        }),
      ]);
    },
  );
});

describe("extractFileContentClaims — does not fire on merely explanatory 'says' prose", () => {
  it("a comment using 'says' with no cited file before it extracts no claim", () => {
    const block = parseMaestroCommentBlocks(
      "# T77's own doc comment says why: resolving a session's workspace\n# root the honest way needs a real host, which this wave has none of.",
    )[0];
    expect(extractFileContentClaims(block)).toEqual([]);
  });

  it("a cited file with no 'says' anywhere near it extracts no claim", () => {
    const block = parseMaestroCommentBlocks(
      "# See `composer-model.ts` for the real `entryStatusLabel` values\n# this flow asserts against.",
    )[0];
    expect(extractFileContentClaims(block)).toEqual([]);
  });
});
