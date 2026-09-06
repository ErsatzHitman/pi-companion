import assert from "node:assert/strict";
import test from "node:test";
import { findViolations } from "./guard-no-legacy-app-tree.mjs";

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
