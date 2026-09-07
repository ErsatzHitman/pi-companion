import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  findLegacySchemaReaderViolations,
  stripComments,
  stripCommentsAndStrings,
  stripStringLiterals,
} from "./guard-no-legacy-schema-reader.mjs";
import { isScannedPath } from "./run-guard-no-legacy-schema-reader.mjs";

test("passes on ordinary code that never mentions version or the envelope fields", () => {
  const files = [
    { path: "apps/android/src/features/composer/Composer.tsx", content: "export const x = 1;\n" },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), []);
});

test("passes on real, unrelated code that reads .attachments without any version===1 discriminant (packages/frontend-core/src/composer/drafts.ts's actual shape)", () => {
  const files = [
    {
      path: "packages/frontend-core/src/composer/drafts.ts",
      content: `
        export class DraftStore {
          async save(key, input) {
            const draft = {
              key,
              text: input.text,
              attachments: input.attachments ?? [],
              updatedAt: this.clock.now(),
            };
            await this.storage.put(this.collection, key, draft);
            return draft;
          }
          async listAll() {
            const drafts = await this.storage.list(this.collection);
            return [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
          }
        }
      `,
    },
  ];

  // input.attachments is a real dot-access on one field, but there is no
  // version===1 discriminant anywhere in the file, so this must not fire.
  // ([...drafts] also must not be mistaken for a `.drafts` access — see
  // the dedicated spread-operator case below.)
  assert.deepEqual(findLegacySchemaReaderViolations(files), []);
});

test("does not mistake a spread operator's trailing dot (...drafts) for a real .drafts property access", () => {
  const files = [
    {
      path: "apps/android/src/x.ts",
      content: `
        function f(version) {
          if (version === 1) {
            const drafts = [1, 2, 3];
            return [...drafts];
          }
        }
      `,
    },
  ];

  // version === 1 is present, but the only textual proximity to "drafts"
  // is a spread (...drafts), never a real .drafts member access or a
  // destructuring bind — must not fire.
  assert.deepEqual(findLegacySchemaReaderViolations(files), []);
});

test("does not fire on an object LITERAL constructing the §3 envelope shape as an opaque value (the exact shape versioned-import.test.ts writes)", () => {
  const files = [
    {
      path: "apps/android/src/platform/offline/some-file.ts",
      content: `
        const envelope = {
          version: 1,
          exportedAt: "2026-08-31T00:00:00.000Z",
          hosts: [],
          drafts: [],
          attachments: [],
          meta: { source: "legacy pi-companion export utility", note: "synthetic" },
        };
        await storage.put("legacy-export.envelope.v1", "synthetic-envelope", envelope);
      `,
    },
  ];

  // "version: 1" here is an object-literal KEY, not a `version === 1`
  // equality comparison, so the discriminant never fires at all — and
  // even if it did, hosts/drafts/attachments are object-literal keys
  // (no leading dot, never the left-hand side of an assignment), not
  // reads.
  assert.deepEqual(findLegacySchemaReaderViolations(files), []);
});

test("does not fire on the real, committed versioned-import.test.ts", () => {
  const content = readFileSync(
    "apps/android/src/platform/offline/versioned-import.test.ts",
    "utf8",
  );
  const violations = findLegacySchemaReaderViolations([
    { path: "apps/android/src/platform/offline/versioned-import.test.ts", content },
  ]);

  assert.deepEqual(violations, []);
});

test("does not fire on docs/frontend-data-migration.md's synthetic envelope example (out of scanned scope — not a .ts/.tsx file, and outside both scanned directories)", () => {
  const content = readFileSync("docs/frontend-data-migration.md", "utf8");
  // This module's own check function has no extension awareness (that
  // lives in run-guard-no-legacy-schema-reader.mjs's isScannedPath) — feed
  // it directly to prove the CONTENT itself is safe too, defense in depth.
  const violations = findLegacySchemaReaderViolations([
    { path: "docs/frontend-data-migration.md", content },
  ]);

  assert.deepEqual(violations, []);
});

test("fails on a real reader: version===1 discriminant plus a real .hosts dot-access read in the same file", () => {
  const files = [
    {
      path: "apps/android/src/platform/offline/legacy-envelope-importer.ts",
      content: `
        export function importLegacyEnvelope(raw) {
          const envelope = JSON.parse(raw);
          if (envelope.version === 1) {
            for (const host of envelope.hosts) {
              hostProfileStore.put(host);
            }
          }
        }
      `,
    },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), [
    { path: "apps/android/src/platform/offline/legacy-envelope-importer.ts", fields: ["hosts"] },
  ]);
});

test("fails on a NEGATED discriminant (version !== 1) — the guard-clause shape a real validating parser writes", () => {
  // P8-W9 merge gate: the original `={2,3}` pattern was blind to this, and
  // a working reader spelled this way passed the guard at the gate. Both of
  // this repository's own committed version discriminants
  // (paseo-worktree-service.ts:169, worktree-metadata.ts:266) are `!== 2`,
  // so the negated form is the common one, not the exotic one.
  const files = [
    {
      path: "apps/android/src/platform/offline/legacy-envelope-importer.ts",
      content: `
        export function importLegacyEnvelope(raw) {
          const envelope = JSON.parse(raw);
          if (envelope.version !== 1) {
            throw new Error("unsupported legacy envelope version");
          }
          for (const host of envelope.hosts) {
            hostProfileStore.put(host);
          }
        }
      `,
    },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), [
    { path: "apps/android/src/platform/offline/legacy-envelope-importer.ts", fields: ["hosts"] },
  ]);
});

test("fails on a switch over .version with a case 1: arm", () => {
  const files = [
    {
      path: "apps/android/src/platform/offline/legacy-envelope-importer.ts",
      content: `
        export function importLegacyEnvelope(envelope) {
          switch (envelope.version) {
            case 1:
              break;
            default:
              throw new Error("unsupported legacy envelope version");
          }
          const { drafts } = envelope;
          return drafts;
        }
      `,
    },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), [
    { path: "apps/android/src/platform/offline/legacy-envelope-importer.ts", fields: ["drafts"] },
  ]);
});

test("a bare case 1: in a switch that is NOT over a .version expression does not fire", () => {
  // The switch pattern is anchored on `switch (<...>.version)`, so an
  // ordinary numeric switch sitting in a file that also reads .hosts is
  // not a false positive.
  const files = [
    {
      path: "apps/android/src/platform/offline/retry-policy.ts",
      content: `
        export function backoffFor(attempt, session) {
          switch (attempt) {
            case 1:
              return 250;
            default:
              return 1000;
          }
          const hosts = session.hosts;
          return hosts;
        }
      `,
    },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), []);
});

test("fails on a destructuring read (const { drafts } = ...) rather than a dot-access", () => {
  const files = [
    {
      path: "packages/frontend-core/src/offline/legacy-importer.ts",
      content: `
        export function importDrafts(parsed) {
          if (1 === parsed.version) {
            const { drafts } = parsed;
            return drafts.map((d) => draftStore.save(d));
          }
        }
      `,
    },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), [
    { path: "packages/frontend-core/src/offline/legacy-importer.ts", fields: ["drafts"] },
  ]);
});

test("fails and lists every field actually read when a reader consumes more than one", () => {
  const files = [
    {
      path: "apps/android/src/platform/offline/legacy-importer.ts",
      content: `
        function importAll(envelope) {
          if (envelope.version === 1) {
            hostStore.replaceAll(envelope.hosts);
            draftStore.replaceAll(envelope.drafts);
          }
        }
      `,
    },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), [
    {
      path: "apps/android/src/platform/offline/legacy-importer.ts",
      fields: ["hosts", "drafts"],
    },
  ]);
});

test("a version===1 check alone, with no field read anywhere in the file, does not fire", () => {
  const files = [
    {
      path: "apps/android/src/x.ts",
      content: `if (protocolVersion === 1) { doSomethingUnrelated(); }`,
    },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), []);
});

test("a field read alone, with no version discriminant anywhere in the file, does not fire", () => {
  const files = [
    {
      path: "apps/android/src/x.ts",
      content: `function f(x) { return x.hosts.concat(x.drafts); }`,
    },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), []);
});

test("does not fire when the version check and field read live only inside a comment or a string literal", () => {
  const files = [
    {
      path: "apps/android/src/x.ts",
      content: `
        // A real reader would check envelope.version === 1 and then read
        // envelope.hosts, but nothing here actually does that.
        const note = "envelope.version === 1 && envelope.hosts";
        export const nothing = true;
      `,
    },
  ];

  assert.deepEqual(findLegacySchemaReaderViolations(files), []);
});

test("isScannedPath: only .ts/.tsx under apps/android/src or packages/frontend-core/src, excluding test files", () => {
  assert.equal(isScannedPath("apps/android/src/platform/offline/legacy-importer.ts"), true);
  assert.equal(isScannedPath("packages/frontend-core/src/offline/legacy-importer.ts"), true);
  assert.equal(isScannedPath("apps/android/src/platform/offline/legacy-importer.tsx"), true);

  assert.equal(isScannedPath("apps/android/src/platform/offline/versioned-import.test.ts"), false);
  assert.equal(isScannedPath("apps/web/src/platform/offline/legacy-importer.ts"), false);
  assert.equal(isScannedPath("packages/client/src/legacy-importer.ts"), false);
  assert.equal(isScannedPath("docs/frontend-data-migration.md"), false);
});

test("T206 mutation proof, reproduced inline: the same real reader shape the P8-W7 gate proved defeats versioned-import.test.ts is caught here", () => {
  // This is the RED case for the check this guard exists to add. The
  // P8-W7 gate's second experiment ("adding a working importer in a
  // different file under the same directory leaves the suite fully
  // green") described exactly this shape, added somewhere OTHER than
  // sqlite-structured-storage.ts. This test proves this guard — unlike
  // versioned-import.test.ts's own suite — does see it.
  const files = [
    {
      path: "apps/android/src/platform/offline/hypothetical-legacy-importer.ts",
      content: `
        import type { StructuredStorage } from "@picompanion/frontend-core";

        interface LegacyEnvelope {
          version: number;
          hosts: unknown[];
          drafts: unknown[];
          attachments: unknown[];
        }

        export async function importLegacyEnvelope(
          storage: StructuredStorage,
          raw: string,
        ): Promise<void> {
          const envelope = JSON.parse(raw) as LegacyEnvelope;
          if (envelope.version === 1) {
            for (const host of envelope.hosts) {
              await storage.put("hosts.profiles", String(Math.random()), host);
            }
            for (const draft of envelope.drafts) {
              await storage.put("composer/drafts", String(Math.random()), draft);
            }
          }
        }
      `,
    },
  ];

  const violations = findLegacySchemaReaderViolations(files);
  assert.equal(violations.length, 1);
  assert.equal(
    violations[0].path,
    "apps/android/src/platform/offline/hypothetical-legacy-importer.ts",
  );
  assert.deepEqual(violations[0].fields.sort(), ["drafts", "hosts"]);
});

test("running the real guard against the real, committed tree exits 0 today", () => {
  const result = execFileSync(
    process.execPath,
    ["scripts/ci/run-guard-no-legacy-schema-reader.mjs"],
    { encoding: "utf8" },
  );
  assert.match(result, /guard-no-legacy-schema-reader: OK/);
});

// --- T252: migrated to the shared, order-independent tokenizer -----------
// This file's own `stripComments` used to be a hand-rolled BLOCK-first
// regex pair, composed as `stripStringLiterals(stripComments(source))` —
// the exact `stripStringLiterals`/`STRING_LITERAL_TO_ERASE`/
// `stripCommentsAndStrings` trio T244 already fixed in
// `guard-capability-prose.mjs`, copied here verbatim. Block-first has no
// string-literal awareness, so a `/*`-shaped two-character sequence
// anywhere in the raw text — inside a live string, not only inside a `//`
// comment — is misread as a block comment's opener and swallows real code
// up to an unrelated `*/` far later in the file, which is exactly the
// shape a version-1-envelope reader could hide inside undetected.

test('stripComments does not let a `/*`-shaped sequence inside a string literal swallow real code (apps/android/src/platform/file-picker.ts\'s real `"*/*"` MIME wildcard)', () => {
  const source = [
    "function matchesAccept(mimeType, accept) {",
    "  return accept.some((pattern) => {",
    '    if (pattern === "*/*") return true;',
    "    return mimeType === pattern;",
    "  });",
    "}",
    "",
    "/** An unrelated later JSDoc block. */",
    "export function readLegacyEnvelope(envelope) {",
    "  if (envelope.version === 1) {",
    "    return envelope.hosts;",
    "  }",
    "}",
  ].join("\n");

  const stripped = stripComments(source);

  // Before T252 (this file's own then-shipped block-first stripComments):
  // the "*/*" string's own `/*` was misread as a block comment's opener,
  // and the match's CLOSING delimiter turned out to be the unrelated
  // JSDoc block's own real "*/" a few lines down — so everything strictly
  // BETWEEN those two points (the rest of matchesAccept's real body) was
  // silently deleted, while text after the JSDoc's own terminator
  // (readLegacyEnvelope and everything in it) survived either way. The
  // line inside that swallowed span is the one that actually
  // discriminates old order from the fix.
  assert.match(stripped, /return mimeType === pattern;/);
  assert.match(stripped, /function\s+readLegacyEnvelope/);
  assert.match(stripped, /envelope\.version\s*===\s*1/);
  assert.match(stripped, /envelope\.hosts/);

  // And the real guard's own detection logic, run through the full
  // stripCommentsAndStrings composition, now actually sees this file as a
  // violation — proving the fix reaches the guard's real behaviour, not
  // just the stripping helper in isolation.
  const violations = findLegacySchemaReaderViolations([
    { path: "apps/android/src/platform/fixture-legacy-reader.ts", content: source },
  ]);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].fields, ["hosts"]);
});

test('T252: apps/android/src/platform/file-picker.ts\'s real code around its "*/*" wildcard is no longer swallowed by comment-stripping order', () => {
  const filePickerPath = fileURLToPath(
    new URL("../../apps/android/src/platform/file-picker.ts", import.meta.url),
  );
  const content = readFileSync(filePickerPath, "utf8");

  // Before T252, block-first stripComments swallowed hundreds of real
  // characters here — the rest of matchesAccept, all of toPickedFile, and
  // more real declarations — because of this file's own real
  // `pattern === "*/*"` string. Every one of these is a real, later
  // top-level declaration the old order deleted along with it.
  const stripped = stripComments(content);
  assert.match(stripped, /function\s+toPickedFile/);
  assert.match(stripped, /function\s+permissionDenialSentinel/);
  assert.match(stripped, /function\s+createAndroidFilePicker/);
  assert.match(stripped, /function\s+createUnavailableFilePicker/);
});

test("erase-literals (stripCommentsAndStrings) and preserve-literals (stripComments) stay two different, separately-callable behaviours", () => {
  const source = [
    'const url = "https://example.com/*/glob";',
    "// a real comment",
    'export const label = "hosts and drafts";',
  ].join("\n");

  const preserved = stripComments(source);
  const erased = stripCommentsAndStrings(source);
  const stringsOnly = stripStringLiterals(source);

  // stripComments alone: comment gone, every string's content intact.
  assert.equal(preserved.includes("a real comment"), false);
  assert.match(preserved, /"https:\/\/example\.com\/\*\/glob"/);
  assert.match(preserved, /"hosts and drafts"/);

  // stripStringLiterals alone: comment text is untouched (it is not a
  // string literal), but every string's VALUE is erased.
  assert.equal(stringsOnly.includes("a real comment"), true);
  assert.equal(stringsOnly.includes("hosts and drafts"), false);
  assert.match(stringsOnly, /const url = ""/);

  // stripCommentsAndStrings: both the comment AND every string's value
  // are gone — calling it directly proves the composition still does
  // strictly more than stripComments alone, not that it collapsed into
  // the same function.
  assert.equal(erased.includes("a real comment"), false);
  assert.equal(erased.includes("hosts and drafts"), false);
  assert.notEqual(erased, preserved);
});

// --- T252's own acceptance criterion, this guard's own shape: PER FILE ---
// Mirrors `guard-no-duplicate-permission-state.test.mjs`'s "every real
// apps/android/src file whose raw text has a top-level `type X =` line
// still has one after stripComments, checked per file" — same heuristic,
// applied to this guard's own scan scope (both directories
// `isScannedPath` admits) and to a raw, never-comment-stripped detector
// for a real top-level declaration: any line starting with `export`.
const RAW_TOP_LEVEL_EXPORT_LINE = /^[ \t]*export\s/m;

test("every real file in this guard's own scan scope whose raw text has a top-level export line still has one after stripComments, checked per file", () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((path) => isScannedPath(path));

  assert.ok(tracked.length > 100, "expected many files in this guard's own scan scope");

  const filesWithNoSurvivingExport = [];
  for (const path of tracked) {
    const content = readFileSync(`${repoRoot}${path}`, "utf8");
    if (!RAW_TOP_LEVEL_EXPORT_LINE.test(content)) continue;
    const cleaned = stripComments(content);
    if (!RAW_TOP_LEVEL_EXPORT_LINE.test(cleaned)) filesWithNoSurvivingExport.push(path);
  }

  assert.deepEqual(
    filesWithNoSurvivingExport,
    [],
    "every one of these files' raw text starts a line with `export`, so it must still be" +
      " there after stripComments — losing it for any of these means comment stripping" +
      " silently ate a real declaration",
  );
});
