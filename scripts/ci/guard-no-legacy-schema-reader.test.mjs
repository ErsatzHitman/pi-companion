import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findLegacySchemaReaderViolations } from "./guard-no-legacy-schema-reader.mjs";
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
