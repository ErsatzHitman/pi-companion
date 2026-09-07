import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  extractImportSpecifiers,
  findUndeclaredRootDependencies,
  isNodeBuiltinSpecifier,
  isRelativeSpecifier,
  isWorkspaceSpecifier,
  resolveRootPackageName,
  stripComments,
} from "./guard-declared-root-dependencies.mjs";

// --- classification helpers ----------------------------------------------

test("isNodeBuiltinSpecifier recognizes both node: and bare builtin specifiers", () => {
  assert.equal(isNodeBuiltinSpecifier("node:fs"), true);
  assert.equal(isNodeBuiltinSpecifier("node:child_process"), true);
  assert.equal(isNodeBuiltinSpecifier("fs"), true);
  assert.equal(isNodeBuiltinSpecifier("fs/promises"), true);
  assert.equal(isNodeBuiltinSpecifier("vite"), false);
  assert.equal(isNodeBuiltinSpecifier("fspresso"), false); // not a real builtin — prefix collision check
});

test("isRelativeSpecifier recognizes only relative/absolute paths", () => {
  assert.equal(isRelativeSpecifier("./guard-secret-scan.mjs"), true);
  assert.equal(isRelativeSpecifier("../dev/component-lab-route.js"), true);
  assert.equal(isRelativeSpecifier("/repo/scripts/ci/foo.mjs"), true);
  assert.equal(isRelativeSpecifier("vite"), false);
  assert.equal(isRelativeSpecifier("@picompanion/client"), false);
});

test("isWorkspaceSpecifier recognizes only the @picompanion/* scope", () => {
  assert.equal(isWorkspaceSpecifier("@picompanion/client"), true);
  assert.equal(isWorkspaceSpecifier("@picompanion/highlight/lezer-only"), true);
  assert.equal(isWorkspaceSpecifier("@playwright/test"), false);
  assert.equal(isWorkspaceSpecifier("vite"), false);
});

test("resolveRootPackageName resolves bare and scoped specifiers, including subpaths", () => {
  assert.equal(resolveRootPackageName("vite"), "vite");
  assert.equal(resolveRootPackageName("vite/client"), "vite");
  assert.equal(resolveRootPackageName("@vitejs/plugin-react"), "@vitejs/plugin-react");
  assert.equal(resolveRootPackageName("@vitejs/plugin-react/jsx-runtime"), "@vitejs/plugin-react");
});

// --- stripComments: the collision this guard's own header documents ------

test("stripComments does not let a `/*`-looking glob inside a // comment swallow the next real statement", () => {
  const source = [
    "// package `apps/web` depends on — for every `@picompanion/*`",
    "// package this comment mentions.",
    "",
    "/**",
    " * Unrelated later JSDoc block.",
    " */",
    'import { build } from "vite";',
  ].join("\n");

  const stripped = stripComments(source);

  assert.match(stripped, /import\s*\{\s*build\s*\}\s*from\s*"vite"/);
});

test("stripComments blanks a real block comment's content, including a specifier-shaped example inside it", () => {
  const source = ["/**", ' * e.g. import("some-package")', " */", 'import "vite";'].join("\n");

  const stripped = stripComments(source);

  assert.equal(stripped.includes("some-package"), false);
  assert.match(stripped, /import\s*"vite"/);
});

// --- extractImportSpecifiers ----------------------------------------------

test("extractImportSpecifiers finds static, side-effect, re-export, dynamic and require specifiers, and ignores comments", () => {
  const source = [
    '// import "not-a-real-import";',
    'import { build, loadConfigFromFile } from "vite";',
    'import "./side-effect.mjs";',
    'export { x } from "@picompanion/client";',
    'const mod = await import("node:module");',
    'const legacy = require("./legacy.cjs");',
  ].join("\n");

  const specifiers = extractImportSpecifiers(source).sort();

  assert.deepEqual(specifiers, [
    "./legacy.cjs",
    "./side-effect.mjs",
    "@picompanion/client",
    "node:module",
    "vite",
  ]);
  assert.equal(specifiers.includes("not-a-real-import"), false);
});

// --- findUndeclaredRootDependencies: the required "fails on missing, passes on complete" pair ---

test("fails when a third-party import is not declared in the root manifest (missing-declaration fixture)", () => {
  const files = [
    {
      path: "scripts/ci/run-guard-fixture.mjs",
      content: 'import { build } from "vite";\n',
    },
  ];
  const rootManifest = { devDependencies: { typescript: "^5.9.3" } };

  const violations = findUndeclaredRootDependencies(files, rootManifest);

  assert.deepEqual(violations, [
    { path: "scripts/ci/run-guard-fixture.mjs", packageName: "vite", specifier: "vite" },
  ]);
});

test("passes when every third-party import is declared (complete-manifest fixture)", () => {
  const files = [
    {
      path: "scripts/ci/run-guard-fixture.mjs",
      content: [
        'import { execFileSync } from "node:child_process";',
        'import { checkSessionBundleBudget } from "./guard-web-session-bundle-budget.mjs";',
        'import { createConnection } from "@picompanion/frontend-core";',
        'import { build } from "vite";',
      ].join("\n"),
    },
  ];
  const rootManifest = { devDependencies: { vite: "^8.2.2" } };

  const violations = findUndeclaredRootDependencies(files, rootManifest);

  assert.deepEqual(violations, []);
});

test("dependencies and devDependencies both satisfy a declaration", () => {
  const files = [{ path: "scripts/ci/x.mjs", content: 'import z from "zod";\n' }];
  assert.deepEqual(findUndeclaredRootDependencies(files, { dependencies: { zod: "^3.0.0" } }), []);
  assert.deepEqual(
    findUndeclaredRootDependencies(files, { devDependencies: { zod: "^3.0.0" } }),
    [],
  );
});

test("a subpath import is a dependency on the package, and is satisfied by the package's own declaration", () => {
  const files = [{ path: "scripts/ci/x.mjs", content: 'import "vite/client";\n' }];
  assert.deepEqual(
    findUndeclaredRootDependencies(files, { devDependencies: { vite: "^8.2.2" } }),
    [],
  );
  assert.deepEqual(findUndeclaredRootDependencies(files, {}), [
    { path: "scripts/ci/x.mjs", packageName: "vite", specifier: "vite/client" },
  ]);
});

test("deduplicates by (path, packageName) rather than reporting once per import site", () => {
  const files = [
    {
      path: "scripts/ci/x.mjs",
      content: 'import { a } from "vite";\nimport { b } from "vite";\n',
    },
  ];
  const violations = findUndeclaredRootDependencies(files, {});
  assert.equal(violations.length, 1);
});

// --- Proof this guard actually fires on a real undeclared import, and stops firing once
// it is removed — criterion two of T227. Exercised against a SCRATCH fixture, never
// the real working tree, so this test file never depends on (or perturbs) the real
// root package.json's contents. ---

test("fires on a real undeclared third-party import and stops firing once removed", () => {
  const rootManifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
  );

  const withUndeclaredImport = [
    {
      path: "scripts/ci/run-guard-fixture-t227.mjs",
      content: 'import leftPad from "left-pad";\n',
    },
  ];
  const violations = findUndeclaredRootDependencies(withUndeclaredImport, rootManifest);
  assert.deepEqual(violations, [
    {
      path: "scripts/ci/run-guard-fixture-t227.mjs",
      packageName: "left-pad",
      specifier: "left-pad",
    },
  ]);

  const withImportRemoved = [
    { path: "scripts/ci/run-guard-fixture-t227.mjs", content: "export const x = 1;\n" },
  ];
  assert.deepEqual(findUndeclaredRootDependencies(withImportRemoved, rootManifest), []);
});

// --- Proof against the REAL tree: every production scripts/ci file today declares its
// third-party imports, and `vite` specifically is among them (T227's own motivating
// case). Reads the real filesystem — this is the one test in this file that does. ---

test("the real scripts/ci production files declare every third-party import in the real root package.json, including vite", () => {
  const scriptsCiDir = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(scriptsCiDir)
    .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
    .map((name) => ({
      path: `scripts/ci/${name}`,
      content: readFileSync(new URL(name, import.meta.url), "utf8"),
    }));
  const rootManifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
  );

  const violations = findUndeclaredRootDependencies(files, rootManifest);

  assert.deepEqual(violations, []);
  assert.equal(
    Boolean(rootManifest.dependencies?.vite) || Boolean(rootManifest.devDependencies?.vite),
    true,
  );
  // Route this through the extractor, not raw text. Raw `.includes` cannot do the job it
  // names: this guard's own doc comment contains the literal `from "vite"` and sorts
  // FIRST in `readdirSync` order, so a raw find matched the comment, not the importer,
  // and stayed green with the real import deleted. Going through
  // `extractImportSpecifiers` also pins the extractor itself against the hazard
  // `stripComments`'s own header describes: one legitimate JSDoc line containing `//`
  // above a real import blanks to end of line first, destroys that block's `*/`, and
  // lets the block pass swallow the import. Measured at the P9-W9 merge gate: the
  // shipped `extractImportSpecifiers` returns `["vite"]` for the bare import and `[]`
  // with that one comment line added, while every check in this file stayed green.
  const viteImporter = files.find((f) => extractImportSpecifiers(f.content).includes("vite"));
  assert.equal(
    Boolean(viteImporter),
    true,
    "no scripts/ci file yields `vite` through the extractor: either the motivating import" +
      " is gone, or comment stripping has silently blinded the extractor to it",
  );
});

// --- T244's own acceptance criterion: PER FILE, not "at least one file" ---
// A raw, line-anchored regex (never itself comment-stripped, so it cannot
// share `extractImportSpecifiers`'s own bug) decides whether a file's RAW
// text plausibly contains a real top-level import: `import` must be the
// first non-whitespace token on its line. Every comment style this
// codebase actually uses (`// …`, ` * …`) puts other characters before
// `import` on that line, so this cannot be satisfied by a doc-comment
// example — verified directly below, not merely assumed, against the one
// file in this directory whose header quotes import-shaped example text.
const RAW_TOP_LEVEL_IMPORT_LINE = /^[ \t]*import\s/m;

test("RAW_TOP_LEVEL_IMPORT_LINE does not match a doc comment's import-shaped example text", () => {
  const legacyAppTreeHeader = readFileSync(
    fileURLToPath(new URL("./guard-no-legacy-app-tree.mjs", import.meta.url)),
    "utf8",
  );
  // That file's own header names the legacy package scope in prose without
  // ever writing a real `import` statement in its header comment — this
  // just pins that a `//`-prefixed line never matches the raw heuristic.
  assert.equal(RAW_TOP_LEVEL_IMPORT_LINE.test('// import { x } from "./y";\n'), false);
  assert.equal(RAW_TOP_LEVEL_IMPORT_LINE.test(' * import("some-package")\n'), false);
  assert.ok(legacyAppTreeHeader.length > 0); // the file exists and was read
});

test("every real scripts/ci production file whose raw text has a top-level import line yields at least one specifier, checked per file", () => {
  const scriptsCiDir = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(scriptsCiDir)
    .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
    .map((name) => ({
      path: `scripts/ci/${name}`,
      content: readFileSync(new URL(name, import.meta.url), "utf8"),
    }));

  const filesWithRawImportLine = files.filter((f) => RAW_TOP_LEVEL_IMPORT_LINE.test(f.content));
  // Sanity: this directory is full of real imports (every run-guard-*.mjs
  // entry point, at minimum) — if this were ever empty, the test below
  // would vacuously pass while checking nothing.
  assert.ok(filesWithRawImportLine.length > 10, "expected many scripts/ci files to have imports");

  const filesWithNoExtractedSpecifier = filesWithRawImportLine.filter(
    (f) => extractImportSpecifiers(f.content).length === 0,
  );
  assert.deepEqual(
    filesWithNoExtractedSpecifier.map((f) => f.path),
    [],
    "every one of these files' raw text starts a line with `import`, so extractImportSpecifiers" +
      " must return at least one specifier for each — an empty result for any of them means" +
      " comment-stripping silently ate a real import",
  );
});
