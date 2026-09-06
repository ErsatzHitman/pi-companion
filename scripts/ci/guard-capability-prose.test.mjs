import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAPABILITIES,
  findCapabilityDenialViolations,
  isCapabilityMemberDeclared,
} from "./guard-capability-prose.mjs";
import { isAppSourcePath, isShippedSourcePath } from "./run-guard-capability-prose.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, ...relativePath.split("/")), "utf8");
}

const DAEMON_CLIENT_WITH_TRIO = `
export class DaemonClient {
  async setSteeringMode(agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null> {
    return null;
  }

  async setFollowUpMode(agentId: string, mode: QueueMode): Promise<AgentProviderNotice | null> {
    return null;
  }

  async getQueueModes(agentId: string): Promise<AgentQueueModes> {
    return { steeringMode: null, followUpMode: null };
  }
}
`;

const DAEMON_CLIENT_WITHOUT_TRIO = `
export class DaemonClient {
  async setAgentThinkingOption(agentId: string, option: string): Promise<AgentProviderNotice | null> {
    return null;
  }
}
`;

function shipped(content, filePath = "packages/client/src/daemon-client.ts") {
  return [{ path: filePath, content }];
}

test("passes when the trio does not exist on the client, even with denying prose", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content: "/** No shipped `DaemonClient` implements this. */\nexport interface X {}\n",
    },
  ];

  assert.deepEqual(
    findCapabilityDenialViolations({ shippedFiles: shipped(DAEMON_CLIENT_WITHOUT_TRIO), appFiles }),
    [],
  );
});

test("passes when the trio exists and prose makes no denying claim", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content: "/** Implemented by every real DaemonClient since T110. */\nexport interface X {}\n",
    },
  ];

  assert.deepEqual(
    findCapabilityDenialViolations({ shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO), appFiles }),
    [],
  );
});

test("fails on a live 'no shipped DaemonClient implements this' claim once the trio ships", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "/** As of P6-W6 no shipped `DaemonClient` implements this. */\nexport interface X {}\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "apps/web/src/features/composer/agent-turn-client.ts");
  assert.match(violations[0].capability, /queue-mode trio/);
});

test("fails on a live 'not implemented by any shipped DaemonClient' claim", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/daemon-agent-turn-client.ts",
      content:
        "/**\n * The steer/follow-up mode trio. Not implemented by any shipped\n * `DaemonClient` as of P6-W6.\n */\nexport interface Y {}\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("fails on a live 'true of every real DaemonClient' claim in a TEST TITLE (not a comment)", () => {
  // This is the exact shape of the P6-W6 Composer.test.tsx false premise —
  // a string literal test title, not a doc comment — proving the guard
  // scans string literals too, not only comments.
  const appFiles = [
    {
      path: "apps/web/src/features/composer/Composer.test.tsx",
      content:
        'it("renders unsupported for a client missing the trio (true of every real DaemonClient today)", async () => {});\n',
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("fails on a live 'no wire request to change it today' claim", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/use-composer.ts",
      content: "// steer-vs-follow-up has no wire request to change it today.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("fails on a live 'do not exist on any shipped DaemonClient' claim", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/daemon-agent-turn-client.ts",
      content: "// The trio's methods do not exist on any shipped `DaemonClient` yet.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("fails on a live 'stay undefined against every real DaemonClient' claim", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/daemon-agent-turn-client.ts",
      content:
        "// getQueueModes/setSteeringMode/setFollowUpMode stay undefined against every real DaemonClient today.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

// --- Historical-quotation handling (defect class 4, one level up) --------
//
// dabe8c4's own fix left several files QUOTING the exact false sentence
// verbatim inside a "CORRECTED: this said ..." explanation. These cases
// are the real, current committed text of those corrected files (modulo
// wording), and must NOT fail — each is paired with a mutation that
// removes only the historical marker and confirms the SAME phrase then
// fails, proving the marker (not the phrase's absence) is what suppresses
// it.

test("does not flag a CORRECTED historical quotation of the exact false sentence", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        '/**\n * CORRECTED (P6-W6 merge gate): this said "as of P6-W6 no shipped\n * `DaemonClient` implements this". T110 landed first in that wave.\n */\n',
    },
  ];

  assert.deepEqual(
    findCapabilityDenialViolations({ shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO), appFiles }),
    [],
  );
});

test("removing the CORRECTED marker from that same quotation makes it fail", () => {
  // Same phrase, marker text deleted -- proves the suppression above is
  // keyed on the marker, not on some accidental property of the sentence.
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "/**\n * As of P6-W6 no shipped\n * `DaemonClient` implements this. T110 landed first in that wave.\n */\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("does not flag a 'this said ...' historical quotation without the word CORRECTED", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/use-composer.ts",
      content:
        '/**\n * this said the mode was "entirely the daemon\'s decision" and had "no\n * wire request to change it today".\n */\n',
    },
  ];

  assert.deepEqual(
    findCapabilityDenialViolations({ shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO), appFiles }),
    [],
  );
});

test("a historical marker far outside the context window does not launder a real, current denial", () => {
  const farAwayMarker = "CORRECTED elsewhere in this file, unrelated. ".padEnd(400, "x");
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content: `${farAwayMarker}\nNo shipped \`DaemonClient\` implements this.\n`,
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

// --- Scan-scope checks -----------------------------------------------------

test("existence check strips comments: a method only mentioned in a client-side comment does not count as shipped", () => {
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "// TODO: someday add setSteeringMode\nexport class DaemonClient {}\n",
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content: "/** No shipped `DaemonClient` implements this. */\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("the pure function trusts whatever appFiles it is given — scope is the CLI wrapper's job", () => {
  // This function does not itself know or care that a path came from
  // docs/ rather than apps/web/src — it flags whatever `appFiles` names.
  // Keeping non-apps/*/src files (docs/issues-from-plan.md's own T124
  // write-up, CLAUDE.md's example phrases, this test file's fixtures) out
  // of the scan is `run-guard-capability-prose.mjs`'s responsibility: its
  // `isAppSourcePath` names only `apps/web/src/` and `apps/android/src/`.
  const appFiles = [
    {
      path: "docs/issues-from-plan.md",
      content: "no shipped `DaemonClient` implements this",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "docs/issues-from-plan.md");
});

test("flags every violating file, not just the first", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content: "No shipped `DaemonClient` implements this.\n",
    },
    {
      path: "apps/android/src/features/composer/use-queue-modes.ts",
      content: "True of every real `DaemonClient` today.\n",
    },
    {
      path: "apps/web/src/features/composer/clean-file.ts",
      content: "This file makes no claim either way.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.deepEqual(violations.map((v) => v.path).sort(), [
    "apps/android/src/features/composer/use-queue-modes.ts",
    "apps/web/src/features/composer/agent-turn-client.ts",
  ]);
});

// === T147: shipped-source scope widened past packages/client/src =========

test("T147: isShippedSourcePath covers every package's and app's src/, not just packages/client/src", () => {
  assert.equal(isShippedSourcePath("packages/client/src/daemon-client.ts"), true);
  assert.equal(isShippedSourcePath("packages/protocol/src/agent-types.ts"), true);
  assert.equal(isShippedSourcePath("packages/frontend-core/src/timeline/transcript-view.ts"), true);
  assert.equal(isShippedSourcePath("packages/server/src/server/index.ts"), true);
  assert.equal(isShippedSourcePath("apps/web/src/features/transcript/tool-call-row.tsx"), true);
  assert.equal(isShippedSourcePath("apps/android/src/app-shell/core.ts"), true);
});

test("T147: isShippedSourcePath excludes test files and non-src paths", () => {
  assert.equal(isShippedSourcePath("packages/client/src/daemon-client.test.ts"), false);
  assert.equal(
    isShippedSourcePath("apps/web/src/features/transcript/tool-call-row.test.tsx"), // hypothetical
    false,
  );
  assert.equal(isShippedSourcePath("docs/issues-from-plan.md"), false);
  assert.equal(isShippedSourcePath("packages/client/test/fixture.ts"), false);
  assert.equal(
    isShippedSourcePath("apps/android/e2e/flows/session-tree-sheet.contract.test.ts"),
    false,
  );
});

test("T147: isAppSourcePath is unchanged — apps/web/src and apps/android/src only, tests included", () => {
  assert.equal(isAppSourcePath("apps/web/src/features/composer/Composer.test.tsx"), true);
  assert.equal(isAppSourcePath("packages/client/src/daemon-client.ts"), false);
  assert.equal(isAppSourcePath("packages/protocol/src/agent-types.ts"), false);
});

// === T156: shipped-source scope widened to scripts/ci =====================
//
// T147 widened "shipped" from `packages/client/src` alone to every
// `packages/*/src` and `apps/*/src`, but never included `scripts/ci` — this
// repository's own CI guards, which are exactly the kind of place a
// capability can ship without ever touching a package's or app's `src/`.
// The P6-W15 merge gate proved the gap by changing ONLY a `CAPABILITIES`
// entry's member name between `joinAdjacentStringLiterals` (ships in
// `scripts/ci/guard-capability-prose.mjs`) and `useDiagnosticsExport`
// (ships in `apps/web/src/features/diagnostics/`) against the identical
// live denying sentence and getting exit 0 for the former, exit 1 for the
// latter.

test("T156: isShippedSourcePath now covers scripts/ci/*.mjs", () => {
  assert.equal(isShippedSourcePath("scripts/ci/guard-capability-prose.mjs"), true);
  assert.equal(isShippedSourcePath("scripts/ci/run-guard-capability-prose.mjs"), true);
  assert.equal(isShippedSourcePath("scripts/ci/orphan-modules.mjs"), true);
});

test("T156: isShippedSourcePath excludes scripts/ci/*.test.mjs", () => {
  assert.equal(isShippedSourcePath("scripts/ci/guard-capability-prose.test.mjs"), false);
  assert.equal(isShippedSourcePath("scripts/ci/orphan-modules.test.mjs"), false);
});

test("T156: isShippedSourcePath does not admit scripts/ wholesale — only scripts/ci", () => {
  // Per guard-capability-prose.mjs's "keep the guard survivable" note:
  // scripts/ci is the directory that holds guards; a scratch or one-off
  // script directory elsewhere under scripts/ is not shipped source.
  assert.equal(isShippedSourcePath("scripts/one-off-migration.mjs"), false);
  assert.equal(isShippedSourcePath("scripts/dev/seed.mjs"), false);
});

// CORRECTED (T179): this said "T156: isAppSourcePath is unaffected by the
// scripts/ci widening" and asserted `isAppSourcePath("scripts/ci/...")` is
// `false` — true when T156 only widened the SHIPPED (declaration) scan.
// T179 widens the DENIAL scan to `scripts/ci` too (see that task's block
// below), so `scripts/ci` is now in scope for both halves.
test("T179: isAppSourcePath now also covers scripts/ci (the denial scan, not just the shipped scan)", () => {
  // Not guard-capability-prose.mjs itself — see the "T179: guard-
  // capability-prose.mjs and its own test file are excluded" test below
  // for why that specific file (and its test) is the one exception.
  assert.equal(isAppSourcePath("scripts/ci/guard-docker-packaging-paths.mjs"), true);
});

test("T156: BEFORE this task's widening, a capability shipping only in scripts/ci cannot trip the guard even with a live denying sentence in the tree", () => {
  // Reproduces the exact P6-W15 merge-gate finding: an evidence pool
  // restricted to packages/*/src|apps/*/src (the pre-T156 scope, i.e.
  // deliberately excluding scripts/ci/guard-capability-prose.mjs's real
  // `joinAdjacentStringLiterals` declaration) never sees the capability as
  // shipped, so the live denying sentence must not be flagged — proving the
  // scope, not the phrase matching, was the whole gap.
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export class DaemonClient {}\n",
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "// flattenProse does not join adjacent string literals, so a denying phrase split " +
        "across a concatenation boundary escapes guard-capability-prose entirely.\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T147: BEFORE widening (packages/client/src-only shippedFiles) a non-client capability's live denial cannot trip the guard", () => {
  // Reproduces the exact P6-W12 merge-gate finding for
  // `useClipboardAction`: packages/client/src carries no clipboard code
  // at all, so with `shippedFiles` built the OLD way (packages/client/src
  // only -- simulated here by simply not including the declaring file),
  // even a live, unmarked denying sentence passes.
  const shippedFiles = [];
  const appFiles = [
    {
      path: "apps/web/src/features/diagnostics/CopyableField.tsx",
      content:
        "The old comment claimed `features/transcript/tool-call-row.tsx`'s `useClipboardAction` " +
        'swallows every clipboard failure in a bare `catch {}` and shows "Copied" ' +
        "regardless of whether the write succeeded.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T147: AFTER widening, the same denial trips once the declaring file (outside packages/client/src) is visible", () => {
  const shippedFiles = [
    {
      path: "apps/web/src/features/transcript/tool-call-row.tsx",
      content: "function useClipboardAction(label, copiedLabel) { return { run() {} }; }\n",
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/diagnostics/CopyableField.tsx",
      content:
        "The old comment claimed `features/transcript/tool-call-row.tsx`'s `useClipboardAction` " +
        'swallows every clipboard failure in a bare `catch {}` and shows "Copied" ' +
        "regardless of whether the write succeeded.",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.match(violations[0].capability, /clipboard-failure/);
});

// === T147: new declaration shapes (not every capability is a Promise-returning method) ===

test("isCapabilityMemberDeclared recognizes a function declaration (T139's useClipboardAction is not a class method)", () => {
  const source =
    "function useClipboardAction(label: string, copiedLabel: string) {\n  return {};\n}\n";
  assert.equal(isCapabilityMemberDeclared(source, "useClipboardAction"), true);
});

test("isCapabilityMemberDeclared recognizes a const arrow-function assignment", () => {
  const source = "export const useClipboardAction = (label: string) => {\n  return {};\n};\n";
  assert.equal(isCapabilityMemberDeclared(source, "useClipboardAction"), true);
});

test("isCapabilityMemberDeclared recognizes an interface/type property (T143's compaction fields are not methods)", () => {
  const source =
    "export type CompactionTranscriptEntry = TranscriptEntryBase & {\n" +
    "  readonly preTokens?: number;\n" +
    "  readonly summary?: string;\n" +
    "  readonly filesRead?: ReadonlyArray<string>;\n" +
    "};\n";
  assert.equal(isCapabilityMemberDeclared(source, "summary"), true);
  assert.equal(isCapabilityMemberDeclared(source, "filesRead"), true);
});

test("isCapabilityMemberDeclared's property pattern does not fire on prose that merely contains 'name:' mid-sentence", () => {
  // The exact false-positive T147 exists to avoid: a test title or doc
  // sentence phrased like "does not carry summary: at all" must not
  // self-certify the capability as shipped merely by resembling object
  // syntax -- the property pattern requires a real member boundary
  // (`{`, `;` or `,`) immediately before the name, which ordinary prose
  // does not have.
  const proseThatLooksLikeCode = 'it("does not carry summary: not yet available")';
  assert.equal(isCapabilityMemberDeclared(proseThatLooksLikeCode, "summary"), false);
});

test("isCapabilityMemberDeclared's property pattern ignores mere property ACCESS, not a declaration", () => {
  const source = "const note = entry.summary ? `Summary: ${entry.summary}` : '';\n";
  assert.equal(isCapabilityMemberDeclared(source, "summary"), false);
});

// === T147/T184: a file CAN certify its own capability as shipped =========
//
// CORRECTED (T184): this test used to be titled "the file being checked is
// excluded from its own shipped-evidence pool" and asserted `[]` here --
// pinning the per-appFile self-exclusion T147 added. That exclusion was
// the mechanism T184 found responsible for the P6-W23 blindness: T183's
// packaging build-order capability has exactly ONE declaring file, so
// excluding that file from its own evidence made the capability "never
// shipped" while judging it, and a real, live denial sitting right beside
// its own declaration could never be reported. Resolving "shipped?" once
// per capability over the FULL shippedFiles list (no per-appFile
// exclusion) fixes that: a file carrying both the real declaration and a
// false denying comment about it is now, correctly, a violation. See
// `findCapabilityDenialViolations`'s doc comment for the full reasoning
// and the "T184: declaring file's own denial" test below for the
// two-violation reproduction of the actual P6-W23 mutation.

test("T147/T184: a file carrying BOTH the real declaration and a live denying comment about it is now correctly flagged", () => {
  const content =
    "function useClipboardAction() { return {}; }\n" +
    '// swallows every clipboard failure in a bare `catch {}` and shows "Copied" regardless of whether the write succeeded\n';
  const shippedFiles = [{ path: "apps/web/src/features/transcript/tool-call-row.tsx", content }];
  const appFiles = [{ path: "apps/web/src/features/transcript/tool-call-row.tsx", content }];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "apps/web/src/features/transcript/tool-call-row.tsx");
  assert.match(violations[0].capability, /clipboard-failure/);
});

test("T147: the same denial trips once it moves to a DIFFERENT file than the one that declares the capability", () => {
  const declaration = "function useClipboardAction() { return {}; }\n";
  const denial =
    '// swallows every clipboard failure in a bare `catch {}` and shows "Copied" regardless of whether the write succeeded\n';
  const shippedFiles = [
    { path: "apps/web/src/features/transcript/tool-call-row.tsx", content: declaration },
  ];
  const appFiles = [
    { path: "apps/web/src/features/diagnostics/CopyableField.tsx", content: denial },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });
  assert.equal(violations.length, 1);
});

// === T139: real repo content — the actual shipped clipboard-failure state ===

test("T147/T139: the real, current CopyableField.tsx does not trip the clipboard-failure capability (its CORRECTED marker exempts the historical quotation)", () => {
  const shippedFiles = [
    {
      path: "apps/web/src/features/transcript/tool-call-row.tsx",
      content: readRepoFile("apps/web/src/features/transcript/tool-call-row.tsx"),
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/diagnostics/CopyableField.tsx",
      content: readRepoFile("apps/web/src/features/diagnostics/CopyableField.tsx"),
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T147/T139: reintroducing CopyableField.tsx's old (pre-P6-W12) denying sentence trips the clipboard-failure capability", () => {
  const shippedFiles = [
    {
      path: "apps/web/src/features/transcript/tool-call-row.tsx",
      content: readRepoFile("apps/web/src/features/transcript/tool-call-row.tsx"),
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/diagnostics/CopyableField.tsx",
      content:
        "/**\n * This is a deliberate contrast with\n" +
        " * `features/transcript/tool-call-row.tsx`'s existing `useClipboardAction`\n" +
        " * (out of this task's owned files, so not edited here): that helper\n" +
        " * swallows every clipboard failure in a bare `catch {}` and shows\n" +
        ' * "Copied" regardless of whether the write succeeded — precisely the\n' +
        ' * "silent no-op" shape this repository\'s rules name as worse than a\n' +
        " * visible failure. `CopyableField` never does that.\n" +
        " */\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "apps/web/src/features/diagnostics/CopyableField.tsx");
  assert.match(violations[0].capability, /clipboard-failure/);
});

test("T147/T139: tool-call-row.tsx's own pre-T139 denying sentence shape ('never throws ... silently inert') would trip the guard", () => {
  const shippedFiles = [
    {
      path: "apps/web/src/features/transcript/tool-call-row.tsx",
      content: readRepoFile("apps/web/src/features/transcript/tool-call-row.tsx"),
    },
  ];
  // A different file re-stating tool-call-row.tsx's pre-T139 phrasing --
  // proves the "never throws ... silently inert" phrase itself is caught
  // (self-exclusion above already covers the same-file case separately).
  const appFiles = [
    {
      path: "apps/web/src/features/diagnostics/CopyableField.tsx",
      content:
        "// useClipboardAction never throws -- an absent Clipboard API just leaves the button silently inert.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });
  assert.equal(violations.length, 1);
});

// === T143/T146: real repo content — the actual carried compaction fields ===
//
// T146 (`16d73eb`) deleted compaction-row.tsx's false "isn't available here
// yet" sentence after this task's own gate found it still live post-T143.
// These tests use the real, current committed files on both sides.

test("T147/T143: the real, current compaction-row.tsx does not trip the compaction-fields capability", () => {
  const shippedFiles = [
    {
      path: "packages/frontend-core/src/timeline/transcript-view.ts",
      content: readRepoFile("packages/frontend-core/src/timeline/transcript-view.ts"),
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/transcript/compaction-row.tsx",
      content: readRepoFile("apps/web/src/features/transcript/compaction-row.tsx"),
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T147/T143: reintroducing compaction-row.tsx's pre-T146 denying sentence trips the compaction-fields capability", () => {
  const shippedFiles = [
    {
      path: "packages/frontend-core/src/timeline/transcript-view.ts",
      content: readRepoFile("packages/frontend-core/src/timeline/transcript-view.ts"),
    },
  ];
  // The exact sentence compaction-row.tsx's messageFor() rendered to every
  // web user, before T146, for every completed compaction -- pinned here
  // verbatim from the pre-T146 commit (cedf76a) rather than paraphrased.
  const appFiles = [
    {
      path: "apps/web/src/features/transcript/compaction-row.tsx",
      content:
        " A summary of what changed, and which files were read or modified, isn't available here yet — the app doesn't carry that detail from the agent today.",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "apps/web/src/features/transcript/compaction-row.tsx");
  assert.match(violations[0].capability, /compaction summary and file details/);
});

test("T147/T143: BEFORE widening, packages/client/src alone cannot see the compaction-fields capability", () => {
  // packages/client/src has no compaction summary/file fields at all --
  // the capability lives entirely in packages/frontend-core/src and
  // packages/protocol/src, so a client-only shippedFiles pool (the guard's
  // pre-T147 scope) leaves even a live, unmarked denial undetected.
  const shippedFiles = [];
  const appFiles = [
    {
      path: "apps/web/src/features/transcript/compaction-row.tsx",
      content:
        " A summary of what changed, and which files were read or modified, isn't available here yet — the app doesn't carry that detail from the agent today.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

// === T151: joins adjacent `+`-concatenated string literals before matching
// denying prose ==============================================================
//
// The hole: `apps/web/src/features/sessions/rpc-command-web-parity.ts`'s
// `export_html` note wraps its sentences across `+`-joined string literals
// (oxfmt's printWidth:100 forces the split), and the exact shape below —
// a denying phrase with the concatenation boundary landing INSIDE it —
// exited 0 at the P6-W14 review while the identical sentence on one
// literal exited 1. Each test below is paired with the mutation
// instruction in the task report: comment out `joinAdjacentStringLiterals`
// in `flattenProse` and confirm the split-literal case here goes red while
// the one-literal case stays green.

test("T151: catches a denying phrase split across a `+` concatenation boundary", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "export const note =\n" +
        '  "The daemon owns this outright, and there is no wire request to change " +\n' +
        '  "it today.";\n',
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0].capability, /queue-mode trio/);
  assert.match(violations[0].phrase, /no wire request to change it today/i);
});

test("T151: the same phrase on one literal (no concatenation) still matches, unchanged", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        'export const note = "The daemon owns this outright, and there is no wire request to ' +
        'change it today.";\n',
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("T151: joins a chain of three or more concatenated literals, not just a pair", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const note =\n" +
        '  "As of today, " +\n' +
        '  "there is no wire request " +\n' +
        '  "to change it today.";\n',
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("T151: single-quote literals join the same way as double-quote literals", () => {
  // The phrase itself spans the concatenation boundary (not merely present
  // whole inside one literal) so this only passes if the join is real.
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const note =\n" +
        "  'This is fixed, and there is no wire request to change ' +\n" +
        "  'it today.';\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("T151: template-literal (backtick) concatenation joins too", () => {
  // Same requirement as the single-quote case above: the phrase spans the
  // boundary between the two backtick literals.
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const note =\n" +
        "  `Nothing changes this: there is no wire request to change ` +\n" +
        "  `it today.`;\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("T151: does NOT join across a non-literal expression (a variable) between two `+` operands", () => {
  // Guards against the defect class T124 warns about: joining every `+` it
  // sees, not just literal-to-literal chains. `middle` is a variable, not
  // a string literal, so the two literal halves must stay unjoined and the
  // (deliberately incomplete) phrase on either side of it must not match.
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const middle = computeMiddle();\n" +
        "const note =\n" +
        '  "There is no wire request to change " +\n' +
        "  middle +\n" +
        '  "it today.";\n',
    },
  ];

  assert.deepEqual(
    findCapabilityDenialViolations({ shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO), appFiles }),
    [],
  );
});

test("T151: does not treat numeric addition as a literal join (no false positive from arithmetic)", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const total = 1 + 2;\n" +
        "/** No shipped `DaemonClient` implements this — total is unrelated arithmetic. */\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  // The unrelated arithmetic must not interfere with detecting the real,
  // un-concatenated denying phrase that follows it.
  assert.equal(violations.length, 1);
});

test("T151: a CORRECTED historical quotation split across a concatenation boundary is still exempt", () => {
  // Proves the join happens BEFORE the historical-marker check, and that
  // joining does not shift the marker window off its target: the marker
  // and the quoted phrase are on opposite sides of the concatenation.
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const note =\n" +
        '  "CORRECTED (P6-W6 merge gate): this said there is " +\n' +
        '  "no wire request to change it today.";\n',
    },
  ];

  assert.deepEqual(
    findCapabilityDenialViolations({ shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO), appFiles }),
    [],
  );
});

test("T151: removing the CORRECTED marker from that same split quotation makes it fail", () => {
  // Same phrase, split the same way, with EVERY historical marker word
  // (not just "CORRECTED" -- "this said" alone is also a marker; see the
  // "does not flag a 'this said ...'" case above) deleted, so this is a
  // live claim rather than a quotation of a past mistake.
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const note =\n" +
        '  "As things stand, there is " +\n' +
        '  "no wire request to change it today.";\n',
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
});

test("T151: the real, current rpc-command-web-parity.ts export_html note (kept concatenated on purpose) does not trip the diagnostics-export capability", () => {
  // This file's `export_html` note is deliberately left as a `+`-chain
  // (its own comment explains why: T151 keeps it that way as a live
  // demonstration case). It reads "No SESSION-export action exists in
  // apps/web." -- already qualified, so it must not match
  // `/no export action exists in apps\/web/i` whether or not literals are
  // joined. This proves the join does not introduce a false positive
  // against real, already-correct concatenated prose.
  const shippedFiles = [
    {
      path: "apps/web/src/features/diagnostics/use-diagnostics-export.ts",
      content: readRepoFile("apps/web/src/features/diagnostics/use-diagnostics-export.ts"),
    },
    {
      path: "apps/web/src/features/diagnostics/diagnostics-export.ts",
      content: readRepoFile("apps/web/src/features/diagnostics/diagnostics-export.ts"),
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/sessions/rpc-command-web-parity.ts",
      content: readRepoFile("apps/web/src/features/sessions/rpc-command-web-parity.ts"),
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

// === T156: joins adjacent string literals before matching denying prose
// (joinAdjacentStringLiterals) — real repo content =========================
//
// `joinAdjacentStringLiterals` ships in
// `scripts/ci/guard-capability-prose.mjs` itself, which is exactly why this
// `CAPABILITIES` entry was inert before this task widened `isShippedSourcePath`
// to include `scripts/ci`: with the pre-T156 scope, `shippedFiles` below
// (a real read of `guard-capability-prose.mjs`, tagged with its real
// `scripts/ci/` path) would never be classified as shipped source, so the
// exact same reintroduced sentence two tests down would NOT have tripped
// this capability under the old scope — see the "BEFORE this task's
// widening" test above, which reproduces that with a synthetic evidence
// pool instead of the real file.

test("T164: the real, current rpc-command-web-parity.ts's CORRECTED note contains no denying phrase for the joinAdjacentStringLiterals capability, so it does not need the historical-quote exemption to pass", () => {
  // T164 checked this: the file's `export_html` note, once corrected
  // (`eb37062`), no longer contains the wording any `denyingPhrases` entry
  // matches at all — not even the pre-join, split-across-`+` shape this
  // capability exists to catch. So this test proves the note is clean, not
  // that `HISTORICAL_QUOTE_MARKERS` is what saves it: the `CORRECTED (T151)`
  // marker text is never reached, because `findCapabilityDenialViolations`
  // only inspects the marker window after a phrase match, and there is no
  // match here to inspect one before. The exemption itself is proven by the
  // marker-deletion pair below ("T151: removing the CORRECTED marker...").
  const shippedFiles = [
    {
      path: "scripts/ci/guard-capability-prose.mjs",
      content: readRepoFile("scripts/ci/guard-capability-prose.mjs"),
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/sessions/rpc-command-web-parity.ts",
      content: readRepoFile("apps/web/src/features/sessions/rpc-command-web-parity.ts"),
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T156: reintroducing rpc-command-web-parity.ts's pre-eb37062 denying sentence (verbatim) trips the joinAdjacentStringLiterals capability", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-capability-prose.mjs",
      content: readRepoFile("scripts/ci/guard-capability-prose.mjs"),
    },
  ];
  // Verbatim pre-eb37062 wording of rpc-command-web-parity.ts's export_html
  // note (the "-" side of that commit's diff), reproduced here rather than
  // paraphrased — this is the exact sentence the P6-W15 merge gate found
  // still live and corrected into the "CORRECTED (T151)" note the real
  // file carries today.
  const appFiles = [
    {
      path: "apps/web/src/features/sessions/rpc-command-web-parity.ts",
      content:
        "export const SECTION_111_COMMAND_WEB_COVERAGE = [\n" +
        "  {\n" +
        '    command: "export_html",\n' +
        '    status: "gap",\n' +
        "    note:\n" +
        '      "No wire message and no client method reach this — grep for export_html/exportHtml/exportHTML across " +\n' +
        '      "packages/protocol/src/messages.ts and packages/client/src returns zero. " +\n' +
        '      "No SESSION-export action exists in apps/web. (Qualified at the P6-W14 gate: T41B2 shipped a " +\n' +
        '      "diagnostics export — `useDiagnosticsExport`, `buildDiagnosticsExportBundle`, and a visible " +\n' +
        '      "`Export diagnostics (.json)` button — which is a different capability from `export_html`\'s " +\n' +
        '      "session-transcript export. The unqualified sentence this replaced became literally false the " +\n' +
        '      "moment that landed. Kept on ONE literal line so the guard entry above can still see it: " +\n' +
        '      "flattenProse does not join adjacent string literals, so a denying phrase split across a " +\n' +
        '      "concatenation boundary escapes guard-capability-prose entirely.)",\n' +
        "  },\n" +
        "];\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "apps/web/src/features/sessions/rpc-command-web-parity.ts");
  assert.match(violations[0].capability, /joinAdjacentStringLiterals/);
});

// === T157: LITERAL_CHAIN's second copy of STRING_LITERAL must use its OWN
// backreference =============================================================
//
// T151's `LITERAL_CHAIN` embedded `STRING_LITERAL.source` twice without
// renumbering its capturing group, so the SECOND literal's `\1` still
// pointed at the FIRST literal's captured quote character — silently
// requiring every literal in a chain to close with the SAME delimiter,
// which the doc comment never claimed and which a real oxfmt-formatted
// mixed-delimiter chain has no reason to obey. Measured against the real
// `flattenProse` at the P6-W15 merge gate: `"A " + "B"` and `'A ' + 'B'`
// joined; `"A " + 'B'` and `` `A ` + "B" `` did not; and `"A " + 'B ' + "C"`
// neither joined NOR left the source text intact — it re-parsed the tail of
// the chain using a WRONG closing quote, silently swallowing the second
// literal's own closing delimiter and the following `+` as if they were
// part of that literal's content, and losing the third literal's opening
// quote as raw, unquoted text in the flattened output. Each test below is
// paired with the mutation instruction in the task report: reinstate the
// reused `\1` (drop `SECOND_LITERAL`, use `STRING_LITERAL` twice again) and
// confirm every mismatched-delimiter case here goes red while the
// same-delimiter T151 cases above stay green.

test("T157: a two-literal chain with MISMATCHED delimiters (double quote then single quote) still joins", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const note =\n" +
        '  "The daemon owns this outright, and there is no wire request to change " +\n' +
        "  'it today.';\n",
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0].phrase, /no wire request to change it today/i);
});

test("T157: a two-literal chain with MISMATCHED delimiters (backtick then double quote) still joins", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const note =\n" +
        "  `Nothing changes this: there is no wire request to change ` +\n" +
        '  "it today.";\n',
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0].phrase, /no wire request to change it today/i);
});

test("T157: a three-literal chain with a MIXED MIDDLE delimiter joins correctly, without mangling the recovered text", () => {
  // The exact pathological shape from the task table: `"A " + 'B ' + "C"`,
  // scaled up to a real denying phrase split three ways with the middle
  // segment in single quotes and both outer segments in double quotes.
  // Under the reused-`\1` bug this neither joins the phrase nor leaves the
  // source untouched — it consumes the second literal's closing quote AND
  // the following `+` as content, then re-anchors on the third literal's
  // OPENING quote as if it were the second literal's closer, so this case
  // is the strongest possible discriminator between the two behaviours.
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const note =\n" +
        '  "As of today, there is no wire request " +\n' +
        "  'to change ' +\n" +
        '  "it today.";\n',
    },
  ];

  const violations = findCapabilityDenialViolations({
    shippedFiles: shipped(DAEMON_CLIENT_WITH_TRIO),
    appFiles,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0].phrase, /no wire request to change it today/i);
});

test("T157: a mixed-delimiter chain does not swallow the statement that follows it", () => {
  // Proves the fixed chain match still terminates where the chain actually
  // ends: a second, independent denying sentence placed right after a
  // mixed-delimiter chain must be found as its own violation, not absorbed
  // into (or lost inside) the chain's match.
  const appFiles = [
    {
      path: "apps/web/src/features/composer/agent-turn-client.ts",
      content:
        "const note =\n" +
        '  "There is " +\n' +
        "  'no wire request ' +\n" +
        '  "to change it today.";\n' +
        'export const other = "swallows every clipboard failure in a bare catch {}";\n',
    },
  ];

  const shippedFiles = [
    ...shipped(DAEMON_CLIENT_WITH_TRIO),
    {
      path: "apps/web/src/features/transcript/tool-call-row.tsx",
      content: "function useClipboardAction() {}",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 2);
  assert.ok(violations.some((v) => /no wire request to change it today/i.test(v.phrase)));
  assert.ok(violations.some((v) => /swallows every clipboard failure/i.test(v.phrase)));
});

// T162: transfer cancellation (cancel on useFileUpload/useFileDownload).
// A pure FORWARD guard — at P6-W16 no denying prose existed anywhere in
// `apps/web/src`/`apps/android/src` for this capability, so it cannot be
// pinned against a real historical sentence the way the entries above
// are. The in-place proof (insert a denying sentence into the real,
// committed `use-file-upload.ts`, confirm `run-guard-capability-
// prose.mjs` exits 1, restore byte-identically) is recorded in T162's
// commit message and report; these tests are the permanent synthetic
// pin that survives after that file was restored.

// T169: reshaped from a bare `const cancel = useCallback(...)` (which the
// old `["useFileUpload", "cancel"]` string-group matched, but the new
// `CONTROLLER_CANCEL_MEMBER` regex group does not — it matches only the
// controller's own `cancel: () => void` interface member) to the real
// shape `use-file-upload.ts`/`use-file-download.ts` actually declare: the
// hook function plus a `FooController` interface whose `cancel` member is
// `() => void`. Reshaping this fixture (not abandoning it) is the disclosed
// cost of the fix — see T169's report.
const CANCEL_HOOK_SHIPPED = `
export interface FileUploadController {
  cancel: () => void;
}
export function useFileUpload(options) {
  return {};
}
`;

test("T162: passes when 'cancel' does not exist on either hook, even with denying prose", () => {
  const appFiles = [
    {
      path: "apps/web/src/features/files/use-file-upload.ts",
      content: "Uploads cannot be cancelled once started.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles: [], appFiles }), []);
});

test("T162: fails on a live 'uploads cannot be cancelled' claim once cancel() ships", () => {
  const shippedFiles = [
    { path: "apps/web/src/features/files/use-file-upload.ts", content: CANCEL_HOOK_SHIPPED },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/files/file-upload-panel.tsx",
      content: "A note explaining that uploads cannot be cancelled once started.",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.match(violations[0].capability, /transfer cancellation/);
  assert.match(violations[0].phrase, /uploads cannot be cancelled/i);
});

test("T162: fails on a live 'no way to cancel an in-flight transfer' claim", () => {
  const shippedFiles = [
    { path: "apps/web/src/features/files/use-file-download.ts", content: CANCEL_HOOK_SHIPPED },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/files/file-download-action.tsx",
      content: "There is no way to cancel an in-flight transfer once it begins.",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.match(violations[0].phrase, /no way to cancel an in-flight transfer/i);
});

test("T162: fails on a live 'transfers cannot be interrupted' claim", () => {
  const shippedFiles = [
    { path: "apps/web/src/features/files/use-file-upload.ts", content: CANCEL_HOOK_SHIPPED },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/files/file-upload-panel.tsx",
      content: "Once started, file transfers cannot be interrupted.",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.match(violations[0].phrase, /transfers cannot be interrupted/i);
});

test("T162: does NOT false-positive on the real, current use-file-upload.ts protocol-disclosure comment", () => {
  // CORRECTED (P6-W17 merge gate): this said use-file-upload.ts's module
  // doc "truthfully discloses a boundary ... 'protocol has no cancel opcode
  // a client could send' — an accurate statement of a limit". T162 and
  // T163 landed in the same wave and T163 shipped that opcode, so the
  // sentence was false within the hour and has been rewritten. The
  // `cancelUpload` entry is what guards that claim now.
  //
  // CORRECTED (P6-W18 merge gate): this said the test proves "the real
  // file's REMAINING honest limit — this hook does not send the opcode
  // yet (T165)" must not trip the entry. T165 (`9e54ff5`) landed that
  // call, so the file has no such limit left and the test now passes
  // because nothing in the file matches any phrase at all — the same
  // shape T164 was filed for. What it still guards is real: the entry's
  // phrases must stay narrow enough that this file's honest prose about
  // cancellation does not trip them. Check this FIRST, per T162's
  // acceptance criteria: if it trips, the phrases are too broad.
  const shippedFiles = [
    {
      path: "apps/web/src/features/files/use-file-upload.ts",
      content: readRepoFile("apps/web/src/features/files/use-file-upload.ts"),
    },
    {
      path: "apps/web/src/features/files/use-file-download.ts",
      content: readRepoFile("apps/web/src/features/files/use-file-download.ts"),
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/files/use-file-upload.ts",
      content: readRepoFile("apps/web/src/features/files/use-file-upload.ts"),
    },
    {
      path: "apps/web/src/features/files/use-file-download.ts",
      content: readRepoFile("apps/web/src/features/files/use-file-download.ts"),
    },
    {
      path: "apps/web/src/features/files/file-upload-panel.tsx",
      content: readRepoFile("apps/web/src/features/files/file-upload-panel.tsx"),
    },
    {
      path: "apps/web/src/features/files/file-download-action.tsx",
      content: readRepoFile("apps/web/src/features/files/file-download-action.tsx"),
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T162: reintroducing the exact RED sentence into the real use-file-upload.ts trips the guard (in-place proof, synthetic pin)", () => {
  // Pins, permanently, the in-place RED this task ran and then restored:
  // inserting "TEMP-T162-RED: uploads cannot be cancelled once started."
  // into the real module doc comment. Recreated here from the real file's
  // committed text plus that exact inserted sentence, rather than a
  // paraphrase, so this test fails if the phrase ever stops matching the
  // words actually used in the in-place proof.
  const realUploadHook = readRepoFile("apps/web/src/features/files/use-file-upload.ts");
  const withRedSentence = realUploadHook.replace(
    "All of the above was established by reading the server and protocol",
    "TEMP-T162-RED: uploads cannot be cancelled once started.\n" +
      " * All of the above was established by reading the server and protocol",
  );
  assert.notEqual(
    withRedSentence,
    realUploadHook,
    "fixture setup must actually insert the sentence",
  );

  const violations = findCapabilityDenialViolations({
    // use-file-download.ts (a DIFFERENT path from the appFile below) also
    // declares `cancel`, so this proves "shipped" via a real sibling
    // file — the appFile's own (unmodified) content is deliberately NOT
    // relied on here, matching the guard's self-exclusion rule (see
    // `findCapabilityDenialViolations`'s doc comment).
    shippedFiles: [
      {
        path: "apps/web/src/features/files/use-file-download.ts",
        content: readRepoFile("apps/web/src/features/files/use-file-download.ts"),
      },
    ],
    appFiles: [
      { path: "apps/web/src/features/files/use-file-upload.ts", content: withRedSentence },
    ],
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0].capability, /transfer cancellation/);
  assert.match(violations[0].phrase, /uploads cannot be cancelled/i);
});

test("T162: ordinary unrelated 'cannot be cancelled' prose (not about a transfer) does not trip the guard", () => {
  const shippedFiles = [
    { path: "apps/web/src/features/files/use-file-upload.ts", content: CANCEL_HOOK_SHIPPED },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/approvals/approval-dialog.tsx",
      content: "Once the agent has already acted, this approval cannot be cancelled.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

// T168: the entry above used to key "shipped" off a bare `cancel` token,
// which is declared all over the tree independent of these two hooks — so
// it would keep firing even if `cancel()` were deleted from BOTH
// `useFileUpload` and `useFileDownload` entirely. `methodNames` is now a
// pair of AND-groups (`["useFileUpload", "cancel"]` /
// `["useFileDownload", "cancel"]`): "shipped" requires ONE shipped file to
// declare both names in a group, so an unrelated `cancel` elsewhere, or a
// hook that no longer has one, can no longer satisfy it on its own.
//
// The first test below is a baseline sanity check: with no `cancel`
// declared ANYWHERE in the shipped tree, both the pre-T168 (`["cancel"]`)
// and post-T168 (AND-group) schemes agree the capability is not shipped —
// it does not by itself distinguish the two. The SECOND test is the one
// T162's entry could not make and the reason this task exists: an
// unrelated `cancel` elsewhere in the tree is exactly the shape that made
// the old bare token wrong, and this test was confirmed (by temporarily
// reverting `methodNames` to `["cancel"]` and re-running) to fail against
// the pre-T168 entry while passing against the post-T168 one.

test("T168: does NOT fire when the hooks exist but neither declares cancel() (capability removed)", () => {
  // Simulates T41A3's `cancel()` being deleted from both hooks: the
  // functions remain, but no `cancel` member is declared anywhere in
  // either file.
  const shippedFiles = [
    {
      path: "apps/web/src/features/files/use-file-upload.ts",
      content: "export function useFileUpload(options) { return {}; }",
    },
    {
      path: "apps/web/src/features/files/use-file-download.ts",
      content: "export function useFileDownload(options) { return {}; }",
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/files/file-upload-panel.tsx",
      content: "A note explaining that uploads cannot be cancelled once started.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T168: an UNRELATED cancel() elsewhere in the tree does not satisfy the shipped gate", () => {
  // A `cancel` declared in a totally different feature (an approval
  // dialog) must not be treated as evidence that the file-transfer
  // cancellation capability shipped — only a `cancel` co-declared with
  // `useFileUpload`/`useFileDownload` in the SAME file counts. This is
  // the exact defect T168 fixes: the pre-T168 entry (`methodNames:
  // ["cancel"]`) marks this "shipped" (an unrelated `cancel` function
  // exists in the tree) and forbids the denying phrase below even though
  // neither hook has a `cancel()` — verified by mutation, see the block
  // comment above.
  const shippedFiles = [
    {
      path: "apps/web/src/features/files/use-file-upload.ts",
      content: "export function useFileUpload(options) { return {}; }",
    },
    {
      path: "apps/web/src/features/approvals/approval-dialog.tsx",
      content: "export function cancel() { /* dismiss the approval prompt */ }",
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/files/file-upload-panel.tsx",
      content: "There is no way to cancel an in-flight transfer once it begins.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

// T169: T168's own commit message named `use-file-download.ts`'s
// `MinimalStreamReader.cancel?(reason?: unknown): Promise<void> | void` —
// declared in the SAME FILE as `useFileDownload` — as "the archetype of the
// problem", then shipped two tests that both put the unrelated `cancel` in
// a DIFFERENT file (`approvals/approval-dialog.tsx`). Neither test could
// catch the real collision, because co-declaration in the same file is
// exactly the shape an AND-group over bare names cannot exclude. Reproduced
// against the real, committed `use-file-download.ts` before this fix (see
// T169's report); these two tests are the permanent synthetic pin.

const UNRELATED_SAME_FILE_STREAM_READER_CANCEL = `
export interface MinimalStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel?(reason?: unknown): Promise<void> | void;
}
export function useFileDownload(options) {
  return {};
}
`;

test("T169: an unrelated cancel() in the SAME FILE as the hook, in a different shape, does not satisfy the shipped gate", () => {
  // This is the exact defect T168 left standing: `useFileDownload` and a
  // `cancel` are both declared in this one file, which satisfies
  // `["useFileDownload", "cancel"]` (T168's bare-name group) even though
  // the `cancel` here is `MinimalStreamReader`'s optional, `Promise`-
  // returning stream-cancel callback, not `FileDownloadController.cancel:
  // () => void`. `CONTROLLER_CANCEL_MEMBER` only matches the latter shape,
  // so this file no longer counts as evidence the capability shipped.
  const shippedFiles = [
    {
      path: "apps/web/src/features/files/use-file-download.ts",
      content: UNRELATED_SAME_FILE_STREAM_READER_CANCEL,
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/files/file-download-action.tsx",
      content: "There is no way to cancel an in-flight transfer once it begins.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T169: a real controller cancel() declared in the SAME FILE as the hook still satisfies the shipped gate", () => {
  // Sanity check for the other direction: the genuine shape (an interface
  // member `cancel: () => void` alongside the hook function, in one file,
  // exactly like `FileDownloadController`/`useFileDownload` today) must
  // still count as shipped — the fix narrows WHICH `cancel` counts, it does
  // not stop recognizing the real one.
  const shippedFiles = [
    {
      path: "apps/web/src/features/files/use-file-download.ts",
      content: `
export interface FileDownloadController {
  cancel: () => void;
}
export function useFileDownload(options) {
  return {};
}
`,
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/files/file-download-action.tsx",
      content: "There is no way to cancel an in-flight transfer once it begins.",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.match(violations[0].capability, /transfer cancellation/);
});

test("T169: reproduces the real, committed use-file-download.ts's blind spot in place (verified pre-fix, pinned here for the future)", () => {
  // The real file: `FileDownloadController.cancel` genuinely removed
  // (simulating T41A3 being undone) while `MinimalStreamReader.cancel?`
  // stays exactly as committed today, in the same file. Before this fix,
  // `findCapabilityDenialViolations` reported this capability "shipped" via
  // the stream-reader's unrelated `cancel` and flagged the denying
  // sentence below; after the fix it must go quiet, since neither hook's
  // real cancel exists anymore.
  const realDownload = readRepoFile("apps/web/src/features/files/use-file-download.ts");
  const withoutControllerCancel = realDownload.replace(
    "  cancel: () => void;",
    "  // cancel() removed from FileDownloadController (simulated)",
  );
  assert.notEqual(
    withoutControllerCancel,
    realDownload,
    "fixture setup must actually remove FileDownloadController.cancel",
  );
  assert.match(
    withoutControllerCancel,
    /MinimalStreamReader[\s\S]*cancel\?\(reason\?: unknown\)/,
    "fixture setup must leave the unrelated MinimalStreamReader.cancel? in place",
  );

  const shippedFiles = [
    {
      path: "apps/web/src/features/files/use-file-upload.ts",
      content: "export function useFileUpload(options) { return {}; }",
    },
    {
      path: "apps/web/src/features/files/use-file-download.ts",
      content: withoutControllerCancel,
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/files/file-download-action.tsx",
      content: "There is no way to cancel an in-flight transfer once it begins.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

// === T172: the compaction-fields entry's shipped-gate hole ===
//
// The pre-T172 entry was `methodNames: ["summary", "filesRead",
// "filesModified"]` — three separate single-member tokens, OR across
// members AND OR across files (see `Capability`'s typedef and
// `findCapabilityDenialViolations`'s `capability.methodNames.some(...)`).
// `summary` alone, run through `isCapabilityMemberDeclared`'s permissive
// property-shape regex, is declared in 33 shipped files that have nothing
// to do with compaction (measured directly against the real tree:
// `ModelThinkingPicker.tsx`, `QueueModePicker.tsx`, `ConnectForm.tsx`,
// `ShareChooserScreen.tsx`, `RecordList.tsx`,
// `packages/cli/src/commands/loop/inspect.ts`, and 27 more) — so the entry
// could never become "not shipped" again once any ONE of the three names
// existed anywhere in the tree, regardless of whether the four files that
// actually carry this capability still declared it. Reproduced in place
// before the fix: stripping the trio from all four real declaring files
// and re-inserting the exact pre-T146 sentence into the real
// `compaction-row.tsx` still exited 1 (a guard forbidding a sentence that
// had become true again) — see this task's report for the full
// `run-guard-capability-prose.mjs` transcript.
//
// The fix replaces the three bare tokens with a single AND-group of three
// `RegExp` members (`COMPACTION_SUMMARY_FIELD`/`COMPACTION_FILES_READ_FIELD`/
// `COMPACTION_FILES_MODIFIED_FIELD` in `guard-capability-prose.mjs`), each
// anchored to an actual TypeScript field-type annotation rather than a bare
// name — see that file's comment for why a bare-name AND-group (T168's fix
// for `cancel`) is not narrow enough here on its own: two files that
// genuinely carry the same wire values without ever declaring a typed field
// (`packages/protocol/src/messages.ts`'s zod schema,
// `packages/server/src/server/agent/providers/pi/agent.ts`'s
// result-composition object) would otherwise keep the entry "shipped" even
// after the trio is deleted from every real declaring file.

test("T172: a bare 'summary' field declared in an unrelated file does not satisfy the compaction-fields shipped gate", () => {
  // The exact shape of the 33-file spread this task exists to fix: a
  // completely unrelated component (a picker, a form, a list) with its own
  // `summary?: string` field, nowhere near `filesRead`/`filesModified`.
  // Under the old flat `["summary", "filesRead", "filesModified"]` scheme
  // this alone marked the capability "shipped" (confirmed by temporarily
  // reverting `methodNames` to that flat array and re-running this exact
  // fixture — see the report); under the new AND-group it must not.
  const shippedFiles = [
    {
      path: "apps/android/src/features/composer/ModelThinkingPicker.tsx",
      content: "interface ModelThinkingPickerProps {\n  summary?: string;\n}\n",
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/transcript/compaction-row.tsx",
      content:
        " A summary of what changed, and which files were read or modified, isn't available here yet — the app doesn't carry that detail from the agent today.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T172: messages.ts's real zod-schema shape alone does not satisfy the compaction-fields shipped gate", () => {
  // The real, committed shape (`z.string().optional()`, `z.array(z.string())
  // .optional()`) genuinely carries these three wire values but never
  // declares a TypeScript-typed field — `COMPACTION_SUMMARY_FIELD` requires
  // literal `: string` immediately after the colon, which `: z.string()`
  // is not. If this were treated as evidence, deleting the trio from the
  // four real declaring files while leaving `messages.ts` untouched (as
  // this task's own scope does not touch `messages.ts`) would keep the
  // entry "shipped" forever, the same defect this task exists to fix.
  const shippedFiles = [
    {
      path: "packages/protocol/src/messages.ts",
      content: readRepoFile("packages/protocol/src/messages.ts"),
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/transcript/compaction-row.tsx",
      content:
        " A summary of what changed, and which files were read or modified, isn't available here yet — the app doesn't carry that detail from the agent today.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T172: pi/agent.ts's real result-composition shape alone does not satisfy the compaction-fields shipped gate", () => {
  // `{ summary: result.summary }`, `{ filesRead: fileLists.readFiles }` are
  // value constructions, not type declarations — no `: string` or
  // `: string[]`/`ReadonlyArray<string>` follows the colon, so none of the
  // three RegExp members match.
  const shippedFiles = [
    {
      path: "packages/server/src/server/agent/providers/pi/agent.ts",
      content: readRepoFile("packages/server/src/server/agent/providers/pi/agent.ts"),
    },
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/transcript/compaction-row.tsx",
      content:
        " A summary of what changed, and which files were read or modified, isn't available here yet — the app doesn't carry that detail from the agent today.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T172: each of the four real declaring files, alone, satisfies the compaction-fields shipped gate", () => {
  const declaringFiles = [
    "packages/protocol/src/agent-types.ts",
    "packages/frontend-core/src/timeline/transcript-view.ts",
    "packages/server/src/server/agent/agent-sdk-types.ts",
    "apps/android/src/features/composer/turn-status-model.ts",
  ];
  const appFiles = [
    {
      path: "apps/web/src/features/transcript/compaction-row.tsx",
      content:
        " A summary of what changed, and which files were read or modified, isn't available here yet — the app doesn't carry that detail from the agent today.",
    },
  ];

  for (const declaringFile of declaringFiles) {
    const violations = findCapabilityDenialViolations({
      shippedFiles: [{ path: declaringFile, content: readRepoFile(declaringFile) }],
      appFiles,
    });
    assert.equal(violations.length, 1, `expected ${declaringFile} alone to mark this shipped`);
    assert.match(violations[0].capability, /compaction summary and file details/);
  }
});

// Removes exactly the interface/type-property lines this capability's three
// RegExp members match (`summary?: string;`, `filesRead?: string[];` /
// `readonly filesRead?: readonly string[];` / `filesRead?:
// ReadonlyArray<string>;`, and the `filesModified` equivalents), leaving
// every doc comment and every OTHER reference (a property access, a zod
// schema, a value-construction object literal) untouched. This is the exact
// mutation this task's report ran against the real, committed files before
// restoring them byte-identically — reproduced here as a permanent fixture
// so the fix stays proven without mutating the real tree again.
function stripCompactionFieldLines(source) {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(
        /^(readonly\s+)?summary\??\s*:\s*string;?$/.test(trimmed) ||
        /^(readonly\s+)?filesRead\??\s*:\s*(readonly\s+)?(string\[\]|ReadonlyArray<string>);?$/.test(
          trimmed,
        ) ||
        /^(readonly\s+)?filesModified\??\s*:\s*(readonly\s+)?(string\[\]|ReadonlyArray<string>);?$/.test(
          trimmed,
        )
      );
    })
    .join("\n");
}

test("T172: reproduces the real, committed fix in place — stripping the trio from all four real declaring files leaves zero declaring evidence, so the pre-T146 sentence no longer trips the guard", () => {
  const declaringFiles = [
    "packages/protocol/src/agent-types.ts",
    "packages/frontend-core/src/timeline/transcript-view.ts",
    "packages/server/src/server/agent/agent-sdk-types.ts",
    "apps/android/src/features/composer/turn-status-model.ts",
  ];

  const shippedFiles = declaringFiles.map((declaringFile) => {
    const real = readRepoFile(declaringFile);
    const stripped = stripCompactionFieldLines(real);
    assert.notEqual(
      stripped,
      real,
      `fixture setup must actually strip fields from ${declaringFile}`,
    );
    // The typed `summary` field is gone from all four files after stripping
    // — this alone is enough to break the AND-group for every one of them,
    // since every member must match in the SAME file. Not asserted for
    // `filesRead`/`filesModified` here: `turn-status-model.ts`'s own
    // `describeCompactionFiles(filesRead: readonly string[] | undefined, ...)`
    // helper genuinely keeps a typed `filesRead`/`filesModified` PARAMETER
    // (a real, unrelated declaration this stripper does not target) even
    // after stripping the two interfaces' properties — proof that the
    // AND-group, not a blanket absence of every matching substring, is what
    // makes this fix correct: that file still fails the group overall
    // because `summary` is gone, exactly as `findCapabilityDenialViolations`
    // below confirms.
    assert.doesNotMatch(
      stripped,
      /\bsummary\??\s*:\s*string\b/,
      `${declaringFile} must have no typed 'summary' field left`,
    );
    return { path: declaringFile, content: stripped };
  });

  const appFiles = [
    {
      path: "apps/web/src/features/transcript/compaction-row.tsx",
      content:
        " A summary of what changed, and which files were read or modified, isn't available here yet — the app doesn't carry that detail from the agent today.",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

// === T179: DENIAL scan widened to scripts/ci and packaging/** ============
//
// T147 and T156 widened the SHIPPED (declaration) scan twice, but the
// DENIAL scan — which files get checked for false prose — was still only
// `apps/web/src` and `apps/android/src`. Every false-premise site the
// P6-W20 and P6-W21 gates found lived outside that scope (four in
// `packaging/**`, two in `scripts/ci`) and was invisible to
// `isAppSourcePath` by construction: `run-guard-capability-prose.mjs`
// exited 0 with all six present. Widened to the two DEMONSTRATED trees —
// see that file's own comment for why `.github/**` and `docs/**` were
// deliberately left out.

test("T179: isAppSourcePath now covers scripts/ci/*.mjs, tests included (the denial scan, unlike the shipped scan, must see a false TEST TITLE too)", () => {
  assert.equal(isAppSourcePath("scripts/ci/guard-docker-packaging-paths.mjs"), true);
  assert.equal(isAppSourcePath("scripts/ci/guard-docker-packaging-paths.test.mjs"), true);
  assert.equal(isAppSourcePath("scripts/ci/orphan-modules.mjs"), true);
});

test("T179: isAppSourcePath does not admit scripts/ wholesale — only scripts/ci, mirroring isShippedSourcePath's own restriction", () => {
  assert.equal(isAppSourcePath("scripts/one-off-migration.mjs"), false);
  assert.equal(isAppSourcePath("scripts/dev/seed.mjs"), false);
});

test("T179: isAppSourcePath now covers packaging/** — Dockerfile (no extension), README.md, flake.nix", () => {
  assert.equal(isAppSourcePath("packaging/docker/Dockerfile"), true);
  assert.equal(isAppSourcePath("packaging/docker/README.md"), true);
  assert.equal(isAppSourcePath("packaging/nix/README.md"), true);
  assert.equal(isAppSourcePath("packaging/nix/flake.nix"), true);
  assert.equal(isAppSourcePath("packaging/README.md"), true);
});

test("T179: isAppSourcePath does not admit arbitrary packaging/** files — only the curated Dockerfile/.md/.nix shapes", () => {
  assert.equal(isAppSourcePath("packaging/docker/entrypoint.sh"), false);
  assert.equal(isAppSourcePath("packaging/docker/.dockerignore"), false);
  assert.equal(isAppSourcePath("packaging/some-binary.tar.gz"), false);
});

test("T179: isShippedSourcePath is unaffected by the denial-scan widening — packaging/** never counts as declaration evidence", () => {
  assert.equal(isShippedSourcePath("packaging/docker/Dockerfile"), false);
  assert.equal(isShippedSourcePath("packaging/docker/README.md"), false);
  assert.equal(isShippedSourcePath("packaging/nix/flake.nix"), false);
});

test("T179: BEFORE this task's widening, a live denying sentence in packaging/** could not trip the guard even with the capability shipped", () => {
  // Reproduces the P6-W20/P6-W21 finding by construction: an appFiles pool
  // restricted to the pre-T179 scope (apps/web/src, apps/android/src only)
  // never sees packaging/**, so a live denial there is invisible — proving
  // the scope, not the phrase matching, was the gap (same shape as T156's
  // analogous "BEFORE" test for scripts/ci above).
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export async function cancelUpload(): Promise<void> {}\n",
    },
  ];
  const candidateAppFiles = [
    {
      path: "packaging/docker/README.md",
      content: "The protocol has no cancel opcode.\n",
    },
  ];
  const preT179AppFiles = candidateAppFiles.filter(
    (file) => file.path.startsWith("apps/web/src/") || file.path.startsWith("apps/android/src/"),
  );

  assert.deepEqual(preT179AppFiles, []); // nothing in the pre-T179 scope
  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles: preT179AppFiles }), []);
});

test("T179: a live denying sentence in packaging/** is flagged once the capability is shipped", () => {
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export async function cancelUpload(): Promise<void> {}\n",
    },
  ];
  const appFiles = [
    {
      path: "packaging/docker/README.md",
      content: "The protocol has no cancel opcode.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "packaging/docker/README.md");
  assert.equal(
    violations[0].capability,
    "upload cancel opcode (cancelUpload/file.upload.cancel.request)",
  );
});

test("T179: a live denying sentence in scripts/ci is flagged once the capability is shipped", () => {
  const shippedFiles = [
    {
      path: "apps/web/src/features/diagnostics/diagnostics-export.ts",
      content:
        "export function useDiagnosticsExport() {}\nexport function buildDiagnosticsExportBundle() {}\n",
    },
  ];
  const appFiles = [
    {
      path: "scripts/ci/guard-example-fixture.mjs",
      content: "// No export action exists in apps/web.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "scripts/ci/guard-example-fixture.mjs");
  assert.equal(
    violations[0].capability,
    "redacted diagnostics export (useDiagnosticsExport/buildDiagnosticsExportBundle)",
  );
});

test("T179: a CORRECTED historical quotation in packaging/** does not trip the guard, in the newly widened scope", () => {
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export async function cancelUpload(): Promise<void> {}\n",
    },
  ];
  const appFiles = [
    {
      path: "packaging/docker/README.md",
      content:
        "CORRECTED (T179 test): this said the protocol has no cancel opcode. That is no longer true.\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T179: deleting only the CORRECTED marker from that same packaging/** sentence makes it a live violation again", () => {
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export async function cancelUpload(): Promise<void> {}\n",
    },
  ];
  const appFiles = [
    {
      path: "packaging/docker/README.md",
      content: "the protocol has no cancel opcode. That is no longer true.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "packaging/docker/README.md");
});

test("T179: a CORRECTED historical quotation in scripts/ci does not trip the guard, in the newly widened scope", () => {
  const shippedFiles = [
    {
      path: "apps/web/src/features/diagnostics/diagnostics-export.ts",
      content:
        "export function useDiagnosticsExport() {}\nexport function buildDiagnosticsExportBundle() {}\n",
    },
  ];
  const appFiles = [
    {
      path: "scripts/ci/guard-example-fixture.mjs",
      content:
        "// CORRECTED (T179 test): this said no export action exists in apps/web. No longer true.\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T179: guard-capability-prose.mjs, its own test file, and its CLI entry point are excluded from the widened scripts/ci denial scan (all three are the definition of a denying phrase, not a claim about it)", () => {
  assert.equal(isAppSourcePath("scripts/ci/guard-capability-prose.mjs"), false);
  assert.equal(isAppSourcePath("scripts/ci/guard-capability-prose.test.mjs"), false);
  assert.equal(isAppSourcePath("scripts/ci/run-guard-capability-prose.mjs"), false);
  // Confirms the exclusion is exact, not a blanket "guard-*" or "*prose*"
  // pattern: a sibling scripts/ci guard remains in scope.
  assert.equal(isAppSourcePath("scripts/ci/guard-docker-packaging-paths.mjs"), true);
});

// === T183: a CAPABILITIES entry for the packaging build-order capability ==
//
// T179 widened WHERE the denial scan looks (scripts/ci, packaging/**) but
// added no entry describing WHAT to look for about the packaging
// build-order capability (T174's `findBuildOrderViolations`, T178's
// comment-awareness) — so the six false-premise sites the P6-W20/P6-W21
// gates found stayed uncatchable even once in scope. These tests prove the
// new entry both fires on the real shape of those sites' underlying claim
// and goes quiet once `findBuildOrderViolations` is gone.

test("T183: findBuildOrderViolations, declared only in the real guard-docker-packaging-paths.mjs, marks the build-order capability shipped", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-docker-packaging-paths.mjs",
      content: readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs"),
    },
  ];
  const appFiles = [
    {
      path: "packaging/docker/README.md",
      content:
        "The guard checks that the build order matches `packages/server/package.json`'s `prepack`.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "packaging/docker/README.md");
  assert.equal(
    violations[0].capability,
    "packaging build-order checking (findBuildOrderViolations)",
  );
});

test("T183: the second denying phrase (the T43A1-invariant overclaim) also fires once shipped", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-docker-packaging-paths.mjs",
      content: readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs"),
    },
  ];
  const appFiles = [
    {
      path: "packaging/nix/README.md",
      content: "This packaging path cannot silently skip the T43A1 bundling invariant.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(
    violations[0].capability,
    "packaging build-order checking (findBuildOrderViolations)",
  );
});

test("T183: a CORRECTED historical quotation of the build-order denial does not trip the guard", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-docker-packaging-paths.mjs",
      content: readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs"),
    },
  ];
  const appFiles = [
    {
      path: "packaging/docker/README.md",
      content:
        "CORRECTED (T183 test): this said the guard checks that the build order matches " +
        "`packages/server/package.json`'s `prepack`. That is no longer true.\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T183: deleting only the CORRECTED marker from that same sentence makes it a live violation again", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-docker-packaging-paths.mjs",
      content: readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs"),
    },
  ];
  const appFiles = [
    {
      path: "packaging/docker/README.md",
      content:
        "the guard checks that the build order matches `packages/server/package.json`'s `prepack`. That is no longer true.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "packaging/docker/README.md");
});

test("T183: reproduces the real, committed packaging tree — every corrected site already carries a marker, so today's tree is clean", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-docker-packaging-paths.mjs",
      content: readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs"),
    },
  ];
  const appFiles = [
    "packaging/docker/Dockerfile",
    "packaging/docker/README.md",
    "packaging/nix/README.md",
    "scripts/ci/guard-docker-packaging-paths.mjs",
  ].map((filePath) => ({ path: filePath, content: readRepoFile(filePath) }));

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles }).filter(
    (v) => v.capability === "packaging build-order checking (findBuildOrderViolations)",
  );

  assert.deepEqual(violations, []);
});

test("T183: reproduces the real, committed Dockerfile's own #-wrapped sentence as a live violation once its CORRECTED marker is removed", () => {
  // packaging/docker/Dockerfile wraps this exact claim across three `#`
  // comment lines; flattenProse collapses whitespace but never strips a
  // Dockerfile's `#` gutter the way it strips a JSDoc `*` gutter, so the
  // first denying phrase above uses `[\s#]+` rather than `\s+` between
  // words specifically so this real, multi-line, `#`-prefixed copy still
  // matches once unmarked.
  const real = readRepoFile("packaging/docker/Dockerfile");
  assert.match(
    real,
    /CORRECTED \(P6-W20 gate\): this said the\n# guard checks that the build ORDER matches/,
  );

  const unmarked = real.replace(/CORRECTED \(P6-W20 gate\): this said /, "");
  assert.notEqual(unmarked, real);

  const shippedFiles = [
    {
      path: "scripts/ci/guard-docker-packaging-paths.mjs",
      content: readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs"),
    },
  ];
  const appFiles = [{ path: "packaging/docker/Dockerfile", content: unmarked }];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles }).filter(
    (v) => v.capability === "packaging build-order checking (findBuildOrderViolations)",
  );

  assert.equal(violations.length, 1);
});

test("T183: with findBuildOrderViolations's declaration removed, the same denying sentence is ALLOWED (the shipped-gate token disappears with the capability)", () => {
  const real = readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs");
  const withoutDeclaration = real.replace(
    "export function findBuildOrderViolations(",
    "export function findBuildOrderViolationsRENAMED(",
  );
  assert.notEqual(withoutDeclaration, real, "fixture setup must actually rename the declaration");
  assert.equal(
    isCapabilityMemberDeclared(withoutDeclaration, "findBuildOrderViolations"),
    false,
    "the renamed file must no longer declare the bare member name",
  );

  const shippedFiles = [
    { path: "scripts/ci/guard-docker-packaging-paths.mjs", content: withoutDeclaration },
  ];
  const appFiles = [
    {
      path: "packaging/docker/README.md",
      content:
        "The guard checks that the build order matches `packages/server/package.json`'s `prepack`.\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

// === T184: shipped-resolution once per capability, not per (capability, appFile) ===

test("T184: the declaring file's OWN denial is now reported — reproduces the exact P6-W23 mutation as TWO violations", () => {
  // The P6-W23 gate's reproduction: append the byte-identical line below to
  // BOTH guard-docker-packaging-paths.mjs (the sole declaring file for
  // findBuildOrderViolations) and guard-dockerignore-depth.mjs (an
  // unrelated packaging guard). Pre-T184, run-guard-capability-prose.mjs
  // exited 1 reporting exactly ONE violation -- the dockerignore-depth
  // copy -- because the per-appFile self-exclusion made the capability
  // "never shipped" while the declaring file itself was under judgment.
  const denialLine =
    "\n// The guard checks that the build order matches packages/server/package.json prepack.\n";

  const packagingPathsReal = readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs");
  const dockerignoreDepthReal = readRepoFile("scripts/ci/guard-dockerignore-depth.mjs");
  const packagingPathsMutated = packagingPathsReal + denialLine;
  const dockerignoreDepthMutated = dockerignoreDepthReal + denialLine;

  const shippedFiles = [
    { path: "scripts/ci/guard-docker-packaging-paths.mjs", content: packagingPathsMutated },
  ];
  const appFiles = [
    { path: "scripts/ci/guard-docker-packaging-paths.mjs", content: packagingPathsMutated },
    { path: "scripts/ci/guard-dockerignore-depth.mjs", content: dockerignoreDepthMutated },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles }).filter(
    (v) => v.capability === "packaging build-order checking (findBuildOrderViolations)",
  );

  assert.equal(violations.length, 2);
  const paths = violations.map((v) => v.path).sort();
  assert.deepEqual(paths, [
    "scripts/ci/guard-docker-packaging-paths.mjs",
    "scripts/ci/guard-dockerignore-depth.mjs",
  ]);
});

test("T147/T184: an interface-property-shaped denying STRING LITERAL still cannot self-certify a capability as shipped", () => {
  // T147's original concern, restated in isCapabilityMemberDeclared's doc
  // comment: a capability whose curated member is an interface property
  // (`summary:`, `filesRead:`) could be marked "shipped" by the very
  // sentence denying it, because a string literal is not a comment. This
  // fixture constructs exactly that shape for a REAL curated capability
  // (useClipboardAction, a bare-string OR-member): the only "evidence" in
  // the whole shippedFiles pool is a string literal shaped like an object
  // property (`"{ useClipboardAction: fallback }"`), which the OLD
  // comment-only stripping would not have removed, and there is no real
  // `function useClipboardAction(`/`const useClipboardAction =`/
  // `async useClipboardAction(` anywhere.
  assert.equal(
    isCapabilityMemberDeclared(
      'export const NOTE = "{ useClipboardAction: fallback }";\n',
      "useClipboardAction",
    ),
    false,
    "a string literal shaped like a property declaration must not count as a real declaration",
  );

  // End-to-end through the actual guard pipeline: the SAME file supplies
  // both the property-shaped string "evidence" and a live denying comment
  // for the real clipboard-failure capability. If the string literal
  // could self-certify "shipped", this would report a violation; because
  // it cannot, the capability stays unshipped and the denial is correctly
  // ALLOWED (the app genuinely doesn't have useClipboardAction in this
  // fixture, so prose saying so is true).
  const content =
    'export function CopyableField() {\n  const shape = "{ useClipboardAction: fallback }";\n' +
    '  // swallows every clipboard failure in a bare `catch {}` and shows "Copied" regardless of whether the write succeeded\n' +
    "  return shape;\n}\n";
  const shippedFiles = [{ path: "apps/web/src/features/diagnostics/CopyableField.tsx", content }];
  const appFiles = [{ path: "apps/web/src/features/diagnostics/CopyableField.tsx", content }];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T147/T184: the same fixture DOES flag once a real declaration exists elsewhere — the string literal was never the reason it passed", () => {
  // Companion to the test above: proves the previous [] result was really
  // because nothing declares useClipboardAction, not because the fixture
  // is inert for some unrelated reason. Adding a genuine declaration in a
  // SEPARATE file flips it to a real violation, using the exact same
  // property-shaped-string appFile content as evidence that the string
  // itself still contributes nothing.
  const denialFileContent =
    'export function CopyableField() {\n  const shape = "{ useClipboardAction: fallback }";\n' +
    '  // swallows every clipboard failure in a bare `catch {}` and shows "Copied" regardless of whether the write succeeded\n' +
    "  return shape;\n}\n";
  const realDeclaration = "function useClipboardAction() { return {}; }\n";

  const shippedFiles = [
    { path: "apps/web/src/features/diagnostics/CopyableField.tsx", content: denialFileContent },
    { path: "apps/web/src/features/transcript/tool-call-row.tsx", content: realDeclaration },
  ];
  const appFiles = [
    { path: "apps/web/src/features/diagnostics/CopyableField.tsx", content: denialFileContent },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });
  assert.equal(violations.length, 1);
  assert.match(violations[0].capability, /clipboard-failure/);
});

test("T184: a RegExp group member's declaration check is also immune to a property-shaped string literal", () => {
  // The same protection extended to the RegExp member path (T169's
  // CONTROLLER_CANCEL_MEMBER, T183's FIND_BUILD_ORDER_VIOLATIONS_MEMBER):
  // findCapabilityDenialViolations's isGroupMemberDeclared now runs BOTH
  // member shapes against the same comments-and-strings-stripped source.
  // A string literal that merely CONTAINS the exact regex-matched text
  // ("function findBuildOrderViolations(") must not count as a
  // declaration.
  const content =
    'export const EXAMPLE = "function findBuildOrderViolations( ) { return []; }";\n' +
    "// the guard checks that the build order matches packages/server/package.json prepack.\n";
  const shippedFiles = [{ path: "scripts/ci/guard-docker-packaging-paths.mjs", content }];
  const appFiles = [{ path: "scripts/ci/guard-docker-packaging-paths.mjs", content }];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

// === T187: re-measure T183's six sites now that T184 removed the
// per-appFile self-exclusion, and decide, per site, whether to widen ===
//
// Each fixture below is one of T179's six real corrected sentences,
// reconstructed UNMARKED (no "CORRECTED"/"this said" prefix) so the
// result reflects only `denyingPhrases` coverage, not the separate
// historical-quote exemption already covered by the "T183" tests above.
// This IS the pinned six-site table CLAUDE.md's T187 section asks for:
// changing `denyingPhrases` on the "packaging build-order checking" entry
// without re-running every one of these six is exactly the mistake this
// task exists to prevent.

const BUILD_ORDER_CAPABILITY = "packaging build-order checking (findBuildOrderViolations)";

function buildOrderViolations(sentence) {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-docker-packaging-paths.mjs",
      content: readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs"),
    },
  ];
  const appFiles = [{ path: "packaging/docker/README.md", content: `${sentence}\n` }];
  return findCapabilityDenialViolations({ shippedFiles, appFiles }).filter(
    (v) => v.capability === BUILD_ORDER_CAPABILITY,
  );
}

test("T187: site 1 (Dockerfile's build-order-matches-prepack claim) is catchable, unchanged", () => {
  const violations = buildOrderViolations(
    "The guard checks that the build order matches packages/server/package.json's prepack.",
  );
  assert.equal(violations.length, 1);
});

test("T187: site 2 (the .dockerignore-exclusion claim) is deliberately NOT phrase-matched", () => {
  // See the entry's own doc comment: this denies a DIFFERENT,
  // still-genuinely-absent capability (whether this guard checks a COPY
  // source against `.dockerignore` exclusion) -- unrelated to build
  // order -- so matching it here would forbid an accurate sentence,
  // under the wrong capability's name, that has no announced plan to
  // ever become false.
  const violations = buildOrderViolations(
    "The guard checks the source is not excluded by .dockerignore in a way that would break the build.",
  );
  assert.equal(violations.length, 0);
});

test("T187: site 3 (the T43A1-bundling-invariant claim) is catchable, unchanged", () => {
  const violations = buildOrderViolations(
    "This packaging path cannot silently skip the T43A1 bundling invariant.",
  );
  assert.equal(violations.length, 1);
});

test("T187: site 4 (the REQUIRED_WORKSPACE_BUILD_STEPS provenance claim) is deliberately NOT phrase-matched", () => {
  // Denies that the workspace list is derived from live `package.json`
  // reads rather than the hardcoded literal array it is by design -- a
  // provenance/implementation-detail claim, not a claim that build-order
  // checking is absent, and likely to stay accurate indefinitely.
  const violations = buildOrderViolations(
    "Those workspace names are checked against real package.json files in this repository.",
  );
  assert.equal(violations.length, 0);
});

test("T187: site 5 (the T171-equivalence overclaim) is deliberately NOT phrase-matched", () => {
  // The correction's own text says the true relationship is "strictly
  // weaker", not "absent" -- T171 and this guard check different
  // artifacts at different pipeline stages by design, so a phrase
  // forbidding "this is weaker than T171" would forbid an accurate,
  // permanent statement. Even the original false sentence never claimed
  // build-order checking was absent; it claimed a false equivalence to a
  // different guard.
  const violations = buildOrderViolations(
    "This is the exact failure mode T171 guards on the OUTPUT side, checked here on the INPUT (packaging-recipe) side instead.",
  );
  assert.equal(violations.length, 0);
});

test("T187: site 6 (the comment-free-by-construction claim) is now catchable — widened by T187", () => {
  const violations = buildOrderViolations(
    "That output is comment-free by construction, since both extractors only ever collect RUN lines / phase-string bodies.",
  );
  assert.equal(violations.length, 1);
});

test("T187: site 6's real, committed CORRECTED quotation in guard-docker-packaging-paths.mjs does not trip the widened phrase", () => {
  const real = readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs");
  assert.match(real, /CORRECTED \(P6-W21 gate\): this said that output is/);

  const shippedFiles = [{ path: "scripts/ci/guard-docker-packaging-paths.mjs", content: real }];
  const appFiles = [{ path: "scripts/ci/guard-docker-packaging-paths.mjs", content: real }];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles }).filter(
    (v) => v.capability === BUILD_ORDER_CAPABILITY,
  );
  assert.deepEqual(violations, []);
});

test("T187: deleting only that CORRECTED marker makes the real quotation a live violation again", () => {
  const real = readRepoFile("scripts/ci/guard-docker-packaging-paths.mjs");
  const unmarked = real.replace(/CORRECTED \(P6-W21 gate\): this said /, "");
  assert.notEqual(unmarked, real);

  const shippedFiles = [{ path: "scripts/ci/guard-docker-packaging-paths.mjs", content: unmarked }];
  const appFiles = [{ path: "scripts/ci/guard-docker-packaging-paths.mjs", content: unmarked }];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles }).filter(
    (v) => v.capability === BUILD_ORDER_CAPABILITY,
  );
  assert.equal(violations.length, 1);
});

test("T187: the widened phrase's anchor text has exactly one hit across every real app-source file in scope", () => {
  // Whole-scope collision check: walk every tracked path
  // isAppSourcePath admits (mirrors the denial scan's real trees:
  // apps/web/src, apps/android/src, scripts/ci, packaging/**) and confirm
  // the new phrase matches only the one real, CORRECTED-marked site it
  // was written for -- never an unrelated TRUE sentence elsewhere.
  //
  // T193: the phrase used to be RE-TYPED here as its own literal, so this
  // test could not notice the shipped `denyingPhrases` entry changing
  // underneath it -- the P6-W25 merge gate proved that by swapping the
  // shipped phrase for `/T174 closed the ordering gap/i` (a true, in-scope
  // sentence) and watching this test keep passing. Reading the phrase out
  // of the real `CAPABILITIES` entry instead means a rename of the
  // capability fails loudly here (the `.find` below returns `undefined`
  // and the `assert.ok` fails) and a changed or reordered `denyingPhrases`
  // entry changes what this test actually checks the collision of, rather
  // than leaving it checking a phrase nothing ships any more. See
  // `guard-capability-prose.mjs`'s "packaging build-order checking" entry:
  // its THIRD `denyingPhrase` (index 2) is site 6's comment-free-by-
  // construction claim -- the one this test names.
  const packagingCapability = CAPABILITIES.find(
    (capability) => capability.name === BUILD_ORDER_CAPABILITY,
  );
  assert.ok(
    packagingCapability,
    `expected a CAPABILITIES entry named ${JSON.stringify(BUILD_ORDER_CAPABILITY)}`,
  );
  const phrase = packagingCapability.denyingPhrases[2];
  assert.ok(
    phrase,
    "expected the packaging build-order capability to have a third denyingPhrase " +
      "(T187's widened site-6 comment-free-by-construction phrase)",
  );

  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: repoRoot })
    .split("\n")
    .filter(Boolean);
  const appPaths = tracked.filter(isAppSourcePath);

  const matches = [];
  for (const appPath of appPaths) {
    const flat = readRepoFile(appPath)
      .replace(/^[ \t]*\*(?!\*)[ \t]?/gm, "")
      .replace(/\s+/g, " ");
    if (phrase.test(flat)) matches.push(appPath);
  }

  assert.deepEqual(matches, ["scripts/ci/guard-docker-packaging-paths.mjs"]);
});

// === T197: DENIAL scan widened to docs/** ==================================
//
// T147 and T156 widened the SHIPPED (declaration) scan; T179 widened the
// DENIAL scan to scripts/ci and packaging/**. `docs/` was left out of both,
// and T179's own comment (see `run-guard-capability-prose.mjs`'s header,
// "CORRECTED (T197)") explained why: `docs/issues-from-plan.md`'s ledger
// narrates past waves' already-fixed defects, quoting the exact false
// sentences a prior gate corrected. P8-W5 then shipped
// `docs/legacy-retirement.md` -- 370 lines, almost entirely capability
// claims -- that this guard could not see at all, the same
// "curated-entry-the-runner-can't-see" shape one directory over. This
// section proves the widening is real (a seeded docs/ denial is caught),
// proves the ledger carve-out is exact rather than a blanket docs/
// exclusion (every OTHER docs/*.md file stays in scope), and proves the
// historical-quotation carve-out still works against the real
// docs/legacy-retirement.md.

test("T197: isAppSourcePath now covers docs/*.md", () => {
  assert.equal(isAppSourcePath("docs/legacy-retirement.md"), true);
  assert.equal(isAppSourcePath("docs/agent-configuration-surface.md"), true);
  assert.equal(isAppSourcePath("docs/T02-provenance.md"), true);
});

test("T197: isAppSourcePath excludes docs/issues-from-plan.md specifically, not docs/ at large", () => {
  assert.equal(isAppSourcePath("docs/issues-from-plan.md"), false);
  // Confirms the exclusion is exact, not a blanket "docs/*plan*" or
  // "docs/*.md starting with issues" pattern: a differently-named ledger
  // file would remain in scope.
  assert.equal(isAppSourcePath("docs/other-ledger.md"), true);
});

test("T197: isAppSourcePath does not admit non-Markdown docs/ files", () => {
  assert.equal(isAppSourcePath("docs/diagram.png"), false);
  assert.equal(isAppSourcePath("docs/notes.txt"), false);
});

test("T197: isShippedSourcePath is unaffected by the denial-scan widening — docs/ never counts as declaration evidence", () => {
  assert.equal(isShippedSourcePath("docs/legacy-retirement.md"), false);
  assert.equal(isShippedSourcePath("docs/issues-from-plan.md"), false);
});

test("T197: BEFORE this task's widening, a live denying sentence in docs/ could not trip the guard even with the capability shipped", () => {
  // Reproduces the P8-W5 finding by construction: an appFiles pool
  // restricted to the pre-T197 scope (apps/web/src, apps/android/src,
  // scripts/ci, packaging/**) never sees docs/, so a live denial there is
  // invisible — same shape as T179's own "BEFORE" tests above.
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export async function cancelUpload(): Promise<void> {}\n",
    },
  ];
  const candidateAppFiles = [
    {
      path: "docs/legacy-retirement.md",
      content: "The protocol has no cancel opcode.\n",
    },
  ];
  const preT197AppFiles = candidateAppFiles.filter(
    (file) =>
      file.path.startsWith("apps/web/src/") ||
      file.path.startsWith("apps/android/src/") ||
      file.path.startsWith("scripts/ci/") ||
      file.path.startsWith("packaging/"),
  );

  assert.deepEqual(preT197AppFiles, []); // nothing in the pre-T197 scope
  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles: preT197AppFiles }), []);
});

test("T197: a live denying sentence in docs/ is flagged once the capability is shipped", () => {
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export async function cancelUpload(): Promise<void> {}\n",
    },
  ];
  const appFiles = [
    {
      path: "docs/legacy-retirement.md",
      content: "The protocol has no cancel opcode.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "docs/legacy-retirement.md");
  assert.equal(
    violations[0].capability,
    "upload cancel opcode (cancelUpload/file.upload.cancel.request)",
  );
});

test("T197: the same seeded denial in docs/, with the denial removed, passes clean (the discriminating half of the regression proof)", () => {
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export async function cancelUpload(): Promise<void> {}\n",
    },
  ];
  const appFiles = [
    {
      path: "docs/legacy-retirement.md",
      content: "The protocol supports cancelling an in-flight upload.\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T197: a CORRECTED historical quotation in docs/ does not trip the guard, in the newly widened scope", () => {
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export async function cancelUpload(): Promise<void> {}\n",
    },
  ];
  const appFiles = [
    {
      path: "docs/legacy-retirement.md",
      content:
        "CORRECTED (T197 test): this said the protocol has no cancel opcode. That is no longer true.\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T197: deleting only the CORRECTED marker from that same docs/ sentence makes it a live violation again", () => {
  const shippedFiles = [
    {
      path: "packages/client/src/daemon-client.ts",
      content: "export async function cancelUpload(): Promise<void> {}\n",
    },
  ];
  const appFiles = [
    {
      path: "docs/legacy-retirement.md",
      content: "the protocol has no cancel opcode. That is no longer true.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, "docs/legacy-retirement.md");
});

test("T197: the real docs/legacy-retirement.md — the file that motivated this task — scans clean against the full real CAPABILITIES list", () => {
  // Full end-to-end proof against the committed tree: every shipped file
  // this guard would actually read, and the real docs/legacy-retirement.md
  // content (which the P8-W5 merge gate already checked once as a
  // one-off; this pins it as a real regression test). 0 violations
  // expected — T197 is hardening, not a fix for a live defect in this file.
  //
  // CORRECTED (P8-W6 merge gate): this title said the file scans clean
  // "and its own three CORRECTED markers". Both halves were wrong. The
  // file carries FOUR such markers (lines 9, 35, 295, 332), and they are
  // inert here: no denyingPhrase in CAPABILITIES matches this document's
  // text at all, so the count is 0 violations with the markers present
  // and 0 with every marker neutralised. This assertion proves the file
  // scans clean; it proves nothing about the historical-quotation
  // exemption. That mechanism is proved by the matched pair above, which
  // builds content containing a real matching phrase and shows deleting
  // only the marker turns 0 violations into 1.
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: repoRoot })
    .split("\n")
    .filter(Boolean);
  const shippedFiles = tracked
    .filter(isShippedSourcePath)
    .map((p) => ({ path: p, content: readRepoFile(p) }));

  const violations = findCapabilityDenialViolations({
    shippedFiles,
    appFiles: [
      { path: "docs/legacy-retirement.md", content: readRepoFile("docs/legacy-retirement.md") },
    ],
  });

  assert.deepEqual(violations, []);
});

test("T197: the reference-only Paseo documents CLAUDE.md names all scan clean too", () => {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: repoRoot })
    .split("\n")
    .filter(Boolean);
  const shippedFiles = tracked
    .filter(isShippedSourcePath)
    .map((p) => ({ path: p, content: readRepoFile(p) }));

  const referenceOnlyDocs = [
    "docs/T02-provenance.md",
    "docs/T03-provenance.md",
    "docs/T04-provenance.md",
    "docs/frontend-data-migration.md",
    "docs/pi-extension-compatibility.md",
  ];
  const appFiles = referenceOnlyDocs.map((p) => ({ path: p, content: readRepoFile(p) }));

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T197: on the real, committed tree, run-guard-capability-prose.mjs's own denial scan (docs/ included) exits clean", () => {
  // End-to-end proof at the CLI-entry-point level, not just via the pure
  // function: excludes exactly docs/issues-from-plan.md (per
  // `DOCS_LEDGER_DENIAL_EXCLUSIONS`) and includes every other tracked
  // docs/*.md file, with zero violations on the committed tree — matching
  // this task's brief: hardening, not a fix for a live defect.
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: repoRoot })
    .split("\n")
    .filter(Boolean);
  const docPaths = tracked.filter((p) => p.startsWith("docs/"));
  const scannedDocPaths = docPaths.filter(isAppSourcePath);
  assert.ok(scannedDocPaths.length > 0);
  assert.ok(!scannedDocPaths.includes("docs/issues-from-plan.md"));
  assert.ok(docPaths.includes("docs/issues-from-plan.md")); // the exclusion has something real to exclude

  const shippedFiles = tracked
    .filter(isShippedSourcePath)
    .map((p) => ({ path: p, content: readRepoFile(p) }));
  const appFiles = tracked
    .filter(isAppSourcePath)
    .map((p) => ({ path: p, content: readRepoFile(p) }));

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

// === T207: DENIAL scan widened to .github/workflows/*.yml and
// apps/android/maestro/*.md, plus a CAPABILITIES entry for the new
// appId/package pairing guard ==================================
//
// Same shape as T179 and T197: neither of the two false-premise sites
// this widening targets (the workflow header/run-step comment, the
// maestro README paragraph) lived under any previously-scanned tree, so
// the un-widened scan would have exited 0 with both still false the
// moment T207 shipped the fix they were disclosing the absence of.

test("T207: isAppSourcePath now covers .github/workflows/*.yml", () => {
  assert.equal(isAppSourcePath(".github/workflows/android-maestro-e2e.yml"), true);
  assert.equal(isAppSourcePath(".github/workflows/ci.yml"), true);
});

test("T207: isAppSourcePath now covers apps/android/maestro/*.md", () => {
  assert.equal(isAppSourcePath("apps/android/maestro/README.md"), true);
});

test("T207: isAppSourcePath does not admit apps/android/maestro/*.yaml (a different guard's job) or unrelated workflow-adjacent files", () => {
  assert.equal(isAppSourcePath("apps/android/maestro/smoke.yaml"), false);
  assert.equal(isAppSourcePath(".github/dependabot.yml"), false);
  assert.equal(isAppSourcePath(".github/ISSUE_TEMPLATE/bug.md"), false);
});

test("T207: isShippedSourcePath is unaffected by the denial-scan widening", () => {
  assert.equal(isShippedSourcePath(".github/workflows/android-maestro-e2e.yml"), false);
  assert.equal(isShippedSourcePath("apps/android/maestro/README.md"), false);
});

test("T207: findAppIdPackagePairingViolations, declared only in the real guard-app-id-package-pairing.mjs, marks the capability shipped and fires on the workflow header's original claim", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-app-id-package-pairing.mjs",
      content: readRepoFile("scripts/ci/guard-app-id-package-pairing.mjs"),
    },
  ];
  const appFiles = [
    {
      path: ".github/workflows/android-maestro-e2e.yml",
      content: "# `packaged-app-smoke` cannot pass as written even with EXPO_TOKEN configured.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].path, ".github/workflows/android-maestro-e2e.yml");
  assert.equal(
    violations[0].capability,
    "appId/package pairing guard (findAppIdPackagePairingViolations)",
  );
});

test("T207: the run-step denying phrase fires across a #-wrapped multi-line comment", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-app-id-package-pairing.mjs",
      content: readRepoFile("scripts/ci/guard-app-id-package-pairing.mjs"),
    },
  ];
  const appFiles = [
    {
      path: ".github/workflows/android-maestro-e2e.yml",
      content: "# why this step cannot succeed until T207: the flow it runs is\n# pinned.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });
  assert.equal(violations.length, 1);
});

test("T207: the README denying phrase fires in plain Markdown prose", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-app-id-package-pairing.mjs",
      content: readRepoFile("scripts/ci/guard-app-id-package-pairing.mjs"),
    },
  ];
  const appFiles = [
    {
      path: "apps/android/maestro/README.md",
      content:
        "This job cannot pass yet, and the blocker is a wiring defect rather than the missing secret.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });
  assert.equal(violations.length, 1);
});

test("T207: a CORRECTED historical quotation of the workflow-header denial does not trip the guard", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-app-id-package-pairing.mjs",
      content: readRepoFile("scripts/ci/guard-app-id-package-pairing.mjs"),
    },
  ];
  const appFiles = [
    {
      path: ".github/workflows/android-maestro-e2e.yml",
      content:
        "# CORRECTED (T207): this said `packaged-app-smoke` cannot pass as written even\n" +
        "# with a valid EXPO_TOKEN. That is fixed.\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T207: deleting only the CORRECTED marker from that same sentence makes it a live violation again", () => {
  const shippedFiles = [
    {
      path: "scripts/ci/guard-app-id-package-pairing.mjs",
      content: readRepoFile("scripts/ci/guard-app-id-package-pairing.mjs"),
    },
  ];
  const appFiles = [
    {
      path: ".github/workflows/android-maestro-e2e.yml",
      content:
        "# `packaged-app-smoke` cannot pass as written even\n# with a valid EXPO_TOKEN. That is fixed.\n",
    },
  ];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles });
  assert.equal(violations.length, 1);
});

test("T207: with findAppIdPackagePairingViolations's declaration removed, the same denying sentence is ALLOWED (the shipped-gate token disappears with the capability)", () => {
  const real = readRepoFile("scripts/ci/guard-app-id-package-pairing.mjs");
  const withoutDeclaration = real.replace(
    "export function findAppIdPackagePairingViolations(",
    "export function findAppIdPackagePairingViolationsRENAMED(",
  );
  assert.notEqual(withoutDeclaration, real, "fixture setup must actually rename the declaration");
  assert.equal(
    isCapabilityMemberDeclared(withoutDeclaration, "findAppIdPackagePairingViolations"),
    false,
    "the renamed file must no longer declare the bare member name",
  );

  const shippedFiles = [
    { path: "scripts/ci/guard-app-id-package-pairing.mjs", content: withoutDeclaration },
  ];
  const appFiles = [
    {
      path: ".github/workflows/android-maestro-e2e.yml",
      content: "# `packaged-app-smoke` cannot pass as written even with EXPO_TOKEN configured.\n",
    },
  ];

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});

test("T207: reproduces the real, committed tree — every corrected site already carries a marker, so today's tree is clean", () => {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: repoRoot })
    .split("\n")
    .filter(Boolean);
  const shippedFiles = tracked
    .filter(isShippedSourcePath)
    .map((p) => ({ path: p, content: readRepoFile(p) }));
  const appFiles = [
    ".github/workflows/android-maestro-e2e.yml",
    "apps/android/maestro/README.md",
  ].map((p) => ({ path: p, content: readRepoFile(p) }));

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles }).filter(
    (v) => v.capability === "appId/package pairing guard (findAppIdPackagePairingViolations)",
  );

  assert.deepEqual(violations, []);
});

test("T207: reproduces the real, committed workflow's own #-wrapped header sentence as a live violation once its CORRECTED marker is removed", () => {
  const real = readRepoFile(".github/workflows/android-maestro-e2e.yml");
  assert.match(real, /CORRECTED \(T207\): this said `packaged-app-smoke`/);

  const unmarked = real.replace(/CORRECTED \(T207\): this said /, "");
  assert.notEqual(unmarked, real);

  const shippedFiles = [
    {
      path: "scripts/ci/guard-app-id-package-pairing.mjs",
      content: readRepoFile("scripts/ci/guard-app-id-package-pairing.mjs"),
    },
  ];
  const appFiles = [{ path: ".github/workflows/android-maestro-e2e.yml", content: unmarked }];

  const violations = findCapabilityDenialViolations({ shippedFiles, appFiles }).filter(
    (v) => v.capability === "appId/package pairing guard (findAppIdPackagePairingViolations)",
  );

  assert.equal(violations.length, 1);
});

test("T207: on the real, committed tree, run-guard-capability-prose.mjs's own denial scan (workflows + maestro docs included) exits clean", () => {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: repoRoot })
    .split("\n")
    .filter(Boolean);
  const workflowAndMaestroDocPaths = tracked.filter(
    (p) => p.startsWith(".github/workflows/") || p === "apps/android/maestro/README.md",
  );
  const scannedPaths = workflowAndMaestroDocPaths.filter(isAppSourcePath);
  assert.deepEqual(scannedPaths.sort(), workflowAndMaestroDocPaths.sort());

  const shippedFiles = tracked
    .filter(isShippedSourcePath)
    .map((p) => ({ path: p, content: readRepoFile(p) }));
  const appFiles = tracked
    .filter(isAppSourcePath)
    .map((p) => ({ path: p, content: readRepoFile(p) }));

  assert.deepEqual(findCapabilityDenialViolations({ shippedFiles, appFiles }), []);
});
