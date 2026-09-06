import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ALLOWLISTED_PATHS,
  findStaleAllowlistViolations,
  findViolations,
} from "./guard-no-legacy-app-tree.mjs";

test("passes on a clean tree", () => {
  const paths = ["packages/protocol/src/index.ts", "apps/web/src/index.ts", "README.md"];
  const files = [{ path: "packages/protocol/src/index.ts", content: "export const x = 1;\n" }];

  const { pathViolations, referenceViolations } = findViolations(paths, files);

  assert.deepEqual(pathViolations, []);
  assert.deepEqual(referenceViolations, []);
});

test("fails on a seeded packages/app path violation", () => {
  const paths = [
    "packages/protocol/src/index.ts",
    "packages/app/src/desktop/index.tsx",
    "packages/app",
  ];

  const { pathViolations } = findViolations(paths, []);

  assert.deepEqual(pathViolations.sort(), ["packages/app", "packages/app/src/desktop/index.tsx"]);
});

test("does not flag paths that merely start with packages/app as a prefix string", () => {
  const paths = ["packages/app-store-notes/src/index.ts"];

  const { pathViolations } = findViolations(paths, []);

  assert.deepEqual(pathViolations, []);
});

test("fails on a seeded legacy @getpaseo/ import", () => {
  const paths = ["packages/frontend-core/src/legacy.ts"];
  const files = [
    {
      path: "packages/frontend-core/src/legacy.ts",
      content: 'import { DaemonClient } from "@getpaseo/client";\n',
    },
  ];

  const { referenceViolations } = findViolations(paths, files);

  assert.deepEqual(referenceViolations, [
    { path: "packages/frontend-core/src/legacy.ts", pattern: "@getpaseo/" },
  ]);
});

test("fails on a seeded packages/app import specifier", () => {
  const paths = ["packages/frontend-core/src/legacy.ts"];
  const files = [
    {
      path: "packages/frontend-core/src/legacy.ts",
      content: 'import { PullRequestPanel } from "packages/app/src/git/pull-request-panel";\n',
    },
  ];

  const { referenceViolations } = findViolations(paths, files);

  assert.deepEqual(referenceViolations, [
    { path: "packages/frontend-core/src/legacy.ts", pattern: "packages/app" },
  ]);
});

test("does not flag fixture/test data that merely contains the string packages/app", () => {
  const paths = ["packages/protocol/src/messages.pull-request-timeline.test.ts"];
  const files = [
    {
      path: "packages/protocol/src/messages.pull-request-timeline.test.ts",
      content: '  path: "packages/app/src/git/pull-request-panel/data.ts",\n',
    },
  ];

  const { referenceViolations } = findViolations(paths, files);

  assert.deepEqual(referenceViolations, []);
});

test("does not scan markdown/docs, so legitimate provenance prose is allowed", () => {
  const paths = ["docs/T02-provenance.md"];
  const files = [
    {
      // Never passed through in practice (main() filters by SCANNED_EXTENSIONS
      // before reading files), but the pure function should also stay silent
      // on a .md path even if content were supplied.
      path: "docs/T02-provenance.md",
      content: "Source: `D:\\paseo` — @getpaseo/protocol was renamed to @picompanion/protocol.",
    },
  ];

  const { referenceViolations } = findViolations(paths, files);

  assert.deepEqual(referenceViolations, []);
});

// ---------------------------------------------------------------------------
// T213: findStaleAllowlistViolations — fixture-level pass/fail cases. These
// build their own `allowlist` argument and their own `paths`/`files`, so
// (per this task's own trap list) they prove the pure function's shape only;
// the mutation proofs against the real ALLOWLISTED_PATHS follow below.
// ---------------------------------------------------------------------------

test("findStaleAllowlistViolations: passes when every entry names an existing, still-matching path", () => {
  const paths = ["scripts/ci/fake-guard.mjs"];
  const files = [
    {
      path: "scripts/ci/fake-guard.mjs",
      content: 'import { x } from "@getpaseo/client";\n',
    },
  ];

  const violations = findStaleAllowlistViolations(
    paths,
    files,
    new Set(["scripts/ci/fake-guard.mjs"]),
  );

  assert.deepEqual(violations, []);
});

test("findStaleAllowlistViolations: FAILS and names the entry when its path is not tracked", () => {
  const paths = ["scripts/ci/other-file.mjs"];
  const files = [];

  const violations = findStaleAllowlistViolations(
    paths,
    files,
    new Set(["scripts/ci/deleted-guard.mjs"]),
  );

  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "stale-missing-path");
  assert.equal(violations[0].path, "scripts/ci/deleted-guard.mjs");
});

test("findStaleAllowlistViolations: FAILS and names the entry when its file no longer matches LEGACY_IMPORT_PATTERN", () => {
  const paths = ["scripts/ci/fake-guard.mjs"];
  const files = [
    {
      path: "scripts/ci/fake-guard.mjs",
      content: "export const x = 1;\n",
    },
  ];

  const violations = findStaleAllowlistViolations(
    paths,
    files,
    new Set(["scripts/ci/fake-guard.mjs"]),
  );

  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "stale-clean");
  assert.equal(violations[0].path, "scripts/ci/fake-guard.mjs");
});

test("findStaleAllowlistViolations: an entry whose path exists but has no content supplied is skipped, not guessed at", () => {
  const paths = ["scripts/ci/fake-guard.mjs"];
  const files = []; // no content loaded for this path

  const violations = findStaleAllowlistViolations(
    paths,
    files,
    new Set(["scripts/ci/fake-guard.mjs"]),
  );

  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// T213: real-tree and mutation proofs against the SHIPPED ALLOWLISTED_PATHS —
// a fixture allowlist proves the pure function's shape (above) but nothing
// about scripts/ci/guard-no-legacy-app-tree.mjs's own real Set.
// ---------------------------------------------------------------------------

function readRealAllowlistedFiles() {
  return [...ALLOWLISTED_PATHS].map((path) => ({ path, content: readFileSync(path, "utf8") }));
}

test("the real tree today: both real ALLOWLISTED_PATHS entries exist and still match LEGACY_IMPORT_PATTERN", () => {
  const paths = [...ALLOWLISTED_PATHS, "packages/protocol/src/index.ts"];
  const files = readRealAllowlistedFiles();

  const violations = findStaleAllowlistViolations(paths, files);

  assert.deepEqual(violations, []);
});

test("T213 MUTATION PROOF: a real allowlist entry naming a path that is not tracked is a stale-missing-path violation", () => {
  const realPaths = [...ALLOWLISTED_PATHS, "packages/protocol/src/index.ts"];
  const files = readRealAllowlistedFiles();

  const mutatedAllowlist = new Set([
    ...ALLOWLISTED_PATHS,
    "scripts/ci/guard-no-legacy-app-tree-does-not-exist.mjs",
  ]);
  assert.ok(
    !realPaths.includes("scripts/ci/guard-no-legacy-app-tree-does-not-exist.mjs"),
    "the fixture key must genuinely not be tracked for this proof to mean anything",
  );

  const violations = findStaleAllowlistViolations(realPaths, files, mutatedAllowlist);

  const stale = violations.filter(
    (v) => v.path === "scripts/ci/guard-no-legacy-app-tree-does-not-exist.mjs",
  );
  assert.equal(stale.length, 1);
  assert.equal(stale[0].kind, "stale-missing-path");
  // The two real entries must still be reported clean alongside this
  // fabricated one -- this is "flag the one entry that is actually stale",
  // not "flag everything once the allowlist has any problem".
  for (const realEntry of ALLOWLISTED_PATHS) {
    assert.equal(
      violations.some((v) => v.path === realEntry),
      false,
    );
  }
});

test("T213 MUTATION PROOF: a real allowlist entry naming a file whose legacy reference has been removed is a stale-clean violation", () => {
  const realPaths = [...ALLOWLISTED_PATHS, "packages/protocol/src/index.ts"];
  const [targetPath] = ALLOWLISTED_PATHS;
  const realContent = readFileSync(targetPath, "utf8");

  // Strip every literal occurrence of the two excused strings -- this is
  // the pure-function equivalent of "the file was cleaned up and nobody
  // removed its exemption" (this module's header, T213), applied without
  // touching the real file on disk.
  const cleanedContent = realContent
    .split("@getpaseo/")
    .join("getpaseo-renamed/")
    .split("packages/app/")
    .join("packages/renamed-app/");

  const files = [...ALLOWLISTED_PATHS]
    .filter((path) => path !== targetPath)
    .map((path) => ({ path, content: readFileSync(path, "utf8") }))
    .concat([{ path: targetPath, content: cleanedContent }]);

  const violations = findStaleAllowlistViolations(realPaths, files);

  const stale = violations.filter((v) => v.path === targetPath);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].kind, "stale-clean");
  // The sibling entry (content untouched) must not also be reported.
  const [, siblingPath] = ALLOWLISTED_PATHS;
  assert.equal(
    violations.some((v) => v.path === siblingPath),
    false,
  );
});
