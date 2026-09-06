import assert from "node:assert/strict";
import test from "node:test";
import {
  extractImportSpecifiers,
  findNodeBuiltinViolations,
  isBareNodeBuiltinSpecifier,
  isNodeBuiltinSpecifier,
  isRelativeSpecifier,
  isTestOnlyPath,
  resolveRelativeSpecifier,
  stripComments,
} from "./guard-no-node-builtin-in-web-bundle.mjs";

const ENTRY = "apps/web/src/main.tsx";

test("passes on a clean graph with no node: builtin anywhere reachable", () => {
  const files = new Map([
    [ENTRY, 'import { App } from "./app/App.js";\n'],
    ["apps/web/src/app/App.tsx", "export function App() { return null; }\n"],
  ]);

  assert.deepEqual(findNodeBuiltinViolations(files, ENTRY), []);
});

test("fails on a direct node: builtin import in a reachable non-test file", () => {
  const files = new Map([
    [ENTRY, 'import { App } from "./app/App.js";\n'],
    [
      "apps/web/src/app/App.tsx",
      'import { readFileSync } from "node:fs";\nexport function App() { return readFileSync; }\n',
    ],
  ]);

  const violations = findNodeBuiltinViolations(files, ENTRY);

  assert.deepEqual(violations, [{ path: "apps/web/src/app/App.tsx", specifier: "node:fs" }]);
});

test("T133: fails on a bare (unprefixed) builtin import in a reachable non-test file", () => {
  const files = new Map([
    [ENTRY, 'import { App } from "./app/App.js";\n'],
    [
      "apps/web/src/app/App.tsx",
      'import { readFileSync } from "fs";\nexport function App() { return readFileSync; }\n',
    ],
  ]);

  const violations = findNodeBuiltinViolations(files, ENTRY);

  assert.deepEqual(violations, [{ path: "apps/web/src/app/App.tsx", specifier: "fs" }]);
});

test('T133: reproduces the exact T133 repro — bare `import "fs";` appended to the eb9fa55 file — and the node: form still fails separately', () => {
  // Mirrors docs/issues-from-plan.md's T133 reproduction: appending
  // `import "fs";` (bare, no `node:` prefix) to
  // apps/web/src/features/sessions/index.ts — the exact file P6-W5's
  // eb9fa55 fixed by hand — must fail this guard. Before T133 it did not:
  // isNodeBuiltinSpecifier only ever matched the `node:`-prefixed form.
  const bareFiles = new Map([
    [ENTRY, 'import { Sessions } from "./features/sessions/index.js";\n'],
    [
      "apps/web/src/features/sessions/index.ts",
      'export { SessionList } from "./SessionList.js";\nimport "fs";\n',
    ],
    [
      "apps/web/src/features/sessions/SessionList.tsx",
      "export function SessionList() { return null; }\n",
    ],
  ]);

  const bareViolations = findNodeBuiltinViolations(bareFiles, ENTRY);
  assert.deepEqual(bareViolations, [
    { path: "apps/web/src/features/sessions/index.ts", specifier: "fs" },
  ]);

  // The node:-prefixed form on the same file, proven separately (widening
  // to catch the bare form must not have narrowed or removed the original
  // T126 coverage).
  const prefixedFiles = new Map([
    [ENTRY, 'import { Sessions } from "./features/sessions/index.js";\n'],
    [
      "apps/web/src/features/sessions/index.ts",
      'export { SessionList } from "./SessionList.js";\nimport "node:fs";\n',
    ],
    [
      "apps/web/src/features/sessions/SessionList.tsx",
      "export function SessionList() { return null; }\n",
    ],
  ]);

  const prefixedViolations = findNodeBuiltinViolations(prefixedFiles, ENTRY);
  assert.deepEqual(prefixedViolations, [
    { path: "apps/web/src/features/sessions/index.ts", specifier: "node:fs" },
  ]);
});

test("T133: a bare specifier that only shares a builtin's name-prefix, not the name itself, is not a violation", () => {
  // "fs-extra" and "path-to-regexp" are real, differently-named npm
  // packages — not the builtin "fs" or "path". A guard built on a
  // hand-typed prefix/substring check could get this wrong; exact-match
  // against node:module's builtinModules cannot.
  const files = new Map([
    [
      ENTRY,
      'import { copy } from "fs-extra";\nimport { pathToRegexp } from "path-to-regexp";\ncopy; pathToRegexp;\n',
    ],
  ]);

  assert.deepEqual(findNodeBuiltinViolations(files, ENTRY), []);
});

test("T133: a local project file literally named fs.ts, reached through a relative specifier, is not a builtin and is not a violation", () => {
  // The other half of "a non-builtin module that happens to share a
  // builtin's name": a real project file named fs.ts, imported as "./fs".
  // isRelativeSpecifier means isBareNodeBuiltinSpecifier never even
  // considers it — it is walked and resolved as an ordinary project module.
  const files = new Map([
    [ENTRY, 'import { readLocalFs } from "./fs.js";\nreadLocalFs;\n'],
    ["apps/web/src/fs.ts", "export function readLocalFs() { return null; }\n"],
  ]);

  assert.deepEqual(findNodeBuiltinViolations(files, ENTRY), []);
});

test("reproduces the eb9fa55 barrel-export scenario: a node: import three re-exports deep is caught", () => {
  // Mirrors the real shape T126's brief cites: main.tsx -> App.tsx ->
  // features/sessions barrel (`export { ... } from "./plan-section-11-1-commands.js"`)
  // -> the module that actually imports node:fs/node:path/node:url.
  const files = new Map([
    [ENTRY, 'import { App } from "./app/App.js";\n'],
    [
      "apps/web/src/app/App.tsx",
      'export { loadSection111RpcCommands } from "../features/sessions/index.js";\n',
    ],
    [
      "apps/web/src/features/sessions/index.ts",
      [
        'export { SessionList } from "./SessionList.js";',
        "",
        "// T38A5: plan.md §11.1 command-parity check (parser plus the coverage",
        "// registry it is cross-checked against).",
        "export {",
        "  loadPlanMarkdown,",
        "  loadSection111RpcCommands,",
        "  parseSection111RpcCommands,",
        '} from "./plan-section-11-1-commands.js";',
        "",
      ].join("\n"),
    ],
    [
      "apps/web/src/features/sessions/SessionList.tsx",
      "export function SessionList() { return null; }\n",
    ],
    [
      "apps/web/src/features/sessions/plan-section-11-1-commands.ts",
      [
        'import { existsSync, readFileSync } from "node:fs";',
        'import { dirname, join } from "node:path";',
        'import { fileURLToPath } from "node:url";',
        "",
        "export function loadPlanMarkdown() { return existsSync && readFileSync && dirname && join && fileURLToPath; }",
        "export function loadSection111RpcCommands() { return loadPlanMarkdown(); }",
        "export function parseSection111RpcCommands(text) { return text; }",
        "",
      ].join("\n"),
    ],
  ]);

  const violations = findNodeBuiltinViolations(files, ENTRY);

  assert.deepEqual(violations.map((v) => v.specifier).sort(), ["node:fs", "node:path", "node:url"]);
  assert.ok(
    violations.every(
      (v) => v.path === "apps/web/src/features/sessions/plan-section-11-1-commands.ts",
    ),
  );
});

test("test-only files remain allowed even when the walk reaches them", () => {
  const files = new Map([
    // Entry directly imports a .test.ts file — contrived, but proves the
    // exemption is a real rule of the guard and not merely a side effect
    // of test files never being reachable in practice.
    [ENTRY, 'import "./features/sessions/plan-section-11-1-commands.test.js";\n'],
    [
      "apps/web/src/features/sessions/plan-section-11-1-commands.test.ts",
      'import { readFileSync } from "node:fs";\nreadFileSync;\n',
    ],
  ]);

  assert.deepEqual(findNodeBuiltinViolations(files, ENTRY), []);
});

test("T133: test-only files remain allowed for the BARE builtin form too, not only node:", () => {
  // Same allowance as the node:-prefixed case above, proven separately for
  // the bare form — widening to catch bare specifiers must not narrow the
  // test-only exemption to only the node:-prefixed check.
  const files = new Map([
    [ENTRY, 'import "./features/sessions/plan-section-11-1-commands.test.js";\n'],
    [
      "apps/web/src/features/sessions/plan-section-11-1-commands.test.ts",
      'import { readFileSync } from "fs";\nreadFileSync;\n',
    ],
  ]);

  assert.deepEqual(findNodeBuiltinViolations(files, ENTRY), []);
});

test("a fixture.test.ts file (double extension before .test.ts) is still recognised as test-only", () => {
  assert.equal(
    isTestOnlyPath("apps/web/src/features/composer/daemon-agent-turn-client.fixture.test.ts"),
    true,
  );
});

test("an unreachable production file's node: import never fails the guard", () => {
  const files = new Map([
    [ENTRY, 'import { App } from "./app/App.js";\n'],
    ["apps/web/src/app/App.tsx", "export function App() { return null; }\n"],
    // Present in the fixture, tracked, but nothing imports it — proves the
    // walk is genuinely reachability-based, not a directory-wide scan.
    [
      "apps/web/src/features/orphan/unreachable-node-user.ts",
      'import { readFileSync } from "node:fs";\nreadFileSync;\n',
    ],
  ]);

  assert.deepEqual(findNodeBuiltinViolations(files, ENTRY), []);
});

test("a doc comment merely quoting a node: import does not forge a violation (comment-stripping)", () => {
  // Mirrors plan-section-11-1-commands.ts's own real header, which names
  // node:fs/node:path/node:url in prose describing why this guard exists.
  const files = new Map([
    [ENTRY, 'import { helper } from "./helper.js";\n'],
    [
      "apps/web/src/helper.ts",
      [
        "/**",
        " * This module used to import node:fs/node:path/node:url; see also",
        ' * `import("node:fs")`-shaped historical examples in the wave notes.',
        " */",
        '// from "node:path" is also mentioned here, in a line comment.',
        "export const helper = 1;",
        "",
      ].join("\n"),
    ],
  ]);

  assert.deepEqual(findNodeBuiltinViolations(files, ENTRY), []);
});

test("a real node: import on the line right after a matching doc comment still fails", () => {
  // The previous test proves comments alone cannot forge a violation; this
  // one proves stripping comments does not also blind the guard to a real,
  // adjacent import statement.
  const files = new Map([
    [ENTRY, 'import { helper } from "./helper.js";\n'],
    [
      "apps/web/src/helper.ts",
      [
        "/** This module used to import node:fs; now it really does again. */",
        'import { readFileSync } from "node:fs";',
        "export const helper = readFileSync;",
        "",
      ].join("\n"),
    ],
  ]);

  const violations = findNodeBuiltinViolations(files, ENTRY);
  assert.deepEqual(violations, [{ path: "apps/web/src/helper.ts", specifier: "node:fs" }]);
});

test("a dynamic import() reaching a node: builtin is caught (lazy routes use this form)", () => {
  const files = new Map([
    [ENTRY, 'const load = () => import("./lazy.js");\nload;\n'],
    ["apps/web/src/lazy.ts", 'import("node:fs").then((fs) => fs);\n'],
  ]);

  const violations = findNodeBuiltinViolations(files, ENTRY);
  assert.deepEqual(violations, [{ path: "apps/web/src/lazy.ts", specifier: "node:fs" }]);
});

test("a bare side-effect import (no `from` clause) is followed, e.g. CSS", () => {
  const files = new Map([
    [ENTRY, 'import "./styles/global.css";\n'],
    ["apps/web/src/styles/global.css", "body { margin: 0; }\n"],
  ]);

  // The CSS file resolves (proves the graph edge exists) and is never
  // parsed for further specifiers because its extension is not one this
  // guard knows how to parse.
  assert.deepEqual(findNodeBuiltinViolations(files, ENTRY), []);
});

test("a bare package specifier is treated as an external boundary and never walked", () => {
  const files = new Map([
    [
      ENTRY,
      'import("jsqr").then((mod) => mod);\nimport { x } from "@picompanion/frontend-core";\nx;\n',
    ],
  ]);

  // Neither bare specifier resolves to anything in `files` (there is no
  // node_modules in this fixture) — the walk must not throw or loop, and
  // must report no violations.
  assert.deepEqual(findNodeBuiltinViolations(files, ENTRY), []);
});

test("resolveRelativeSpecifier swaps an ESM .js specifier for the real .tsx source", () => {
  const files = new Map([["apps/web/src/app/App.tsx", "export const App = 1;\n"]]);

  assert.equal(
    resolveRelativeSpecifier("apps/web/src/main.tsx", "./app/App.js", files),
    "apps/web/src/app/App.tsx",
  );
});

test("resolveRelativeSpecifier swaps an ESM .jsx specifier for the real .tsx source", () => {
  const files = new Map([["apps/web/src/widget.tsx", "export const Widget = 1;\n"]]);

  assert.equal(
    resolveRelativeSpecifier("apps/web/src/main.tsx", "./widget.jsx", files),
    "apps/web/src/widget.tsx",
  );
});

test("resolveRelativeSpecifier resolves an extensionless specifier by trying known extensions", () => {
  const files = new Map([["apps/web/src/util.ts", "export const util = 1;\n"]]);

  assert.equal(
    resolveRelativeSpecifier("apps/web/src/main.tsx", "./util", files),
    "apps/web/src/util.ts",
  );
});

test("resolveRelativeSpecifier resolves a directory specifier to its index file", () => {
  const files = new Map([["apps/web/src/features/sessions/index.ts", "export const x = 1;\n"]]);

  assert.equal(
    resolveRelativeSpecifier("apps/web/src/main.tsx", "./features/sessions", files),
    "apps/web/src/features/sessions/index.ts",
  );
});

test("resolveRelativeSpecifier returns null for a bare package specifier", () => {
  const files = new Map([["node_modules/react/index.js", "module.exports = {};\n"]]);

  assert.equal(resolveRelativeSpecifier("apps/web/src/main.tsx", "react", files), null);
});

test("resolveRelativeSpecifier returns null when nothing on disk matches any candidate", () => {
  const files = new Map();

  assert.equal(resolveRelativeSpecifier("apps/web/src/main.tsx", "./ghost", files), null);
});

test("isNodeBuiltinSpecifier only matches the node: prefix form", () => {
  assert.equal(isNodeBuiltinSpecifier("node:fs"), true);
  assert.equal(isNodeBuiltinSpecifier("node:fs/promises"), true);
  assert.equal(isNodeBuiltinSpecifier("fs"), false);
  assert.equal(isNodeBuiltinSpecifier("./fs"), false);
});

test("isBareNodeBuiltinSpecifier matches exact bare builtin names sourced from node:module", () => {
  assert.equal(isBareNodeBuiltinSpecifier("fs"), true);
  assert.equal(isBareNodeBuiltinSpecifier("path"), true);
  assert.equal(isBareNodeBuiltinSpecifier("buffer"), true);
  assert.equal(isBareNodeBuiltinSpecifier("assert/strict"), true);
});

test("isBareNodeBuiltinSpecifier does not match the node: prefix form (that is isNodeBuiltinSpecifier's job)", () => {
  assert.equal(isBareNodeBuiltinSpecifier("node:fs"), false);
});

test("isBareNodeBuiltinSpecifier does not match a relative specifier, even one named exactly like a builtin", () => {
  assert.equal(isBareNodeBuiltinSpecifier("./fs"), false);
  assert.equal(isBareNodeBuiltinSpecifier("../path"), false);
});

test("isBareNodeBuiltinSpecifier does not match a real, differently-named dependency (exact match only, no prefix match)", () => {
  assert.equal(isBareNodeBuiltinSpecifier("fs-extra"), false);
  assert.equal(isBareNodeBuiltinSpecifier("path-to-regexp"), false);
  assert.equal(isBareNodeBuiltinSpecifier("@picompanion/frontend-core"), false);
  assert.equal(isBareNodeBuiltinSpecifier("react"), false);
});

test("isRelativeSpecifier distinguishes relative from bare specifiers", () => {
  assert.equal(isRelativeSpecifier("./x"), true);
  assert.equal(isRelativeSpecifier("../x"), true);
  assert.equal(isRelativeSpecifier("/x"), true);
  assert.equal(isRelativeSpecifier("x"), false);
  assert.equal(isRelativeSpecifier("@picompanion/frontend-core"), false);
  assert.equal(isRelativeSpecifier("node:fs"), false);
});

test("stripComments removes block and line comments without touching code", () => {
  const source = [
    "/* header",
    " * more header",
    " */",
    'import { x } from "./x.js"; // trailing comment',
    "// a whole line comment",
    "const y = 1;",
    "",
  ].join("\n");

  const stripped = stripComments(source);

  assert.ok(stripped.includes('import { x } from "./x.js";'));
  assert.ok(!stripped.includes("header"));
  assert.ok(!stripped.includes("trailing comment"));
  assert.ok(!stripped.includes("a whole line comment"));
});

test("extractImportSpecifiers finds every supported import form in one file", () => {
  const source = [
    'import "./side-effect.css";',
    'import Default, { Named } from "./default-and-named.js";',
    'export { X } from "./barrel.js";',
    'export * from "./star-barrel.js";',
    'const dyn = () => import("./dynamic.js");',
    'const req = require("./required.js");',
    "Default; Named; X; dyn; req;",
    "",
  ].join("\n");

  const specifiers = extractImportSpecifiers(source);

  assert.deepEqual(specifiers.sort(), [
    "./barrel.js",
    "./default-and-named.js",
    "./dynamic.js",
    "./required.js",
    "./side-effect.css",
    "./star-barrel.js",
  ]);
});

test("isTestOnlyPath matches .test. and .spec. files, not ordinary source", () => {
  assert.equal(isTestOnlyPath("apps/web/src/app/App.test.tsx"), true);
  assert.equal(isTestOnlyPath("apps/web/src/app/App.spec.ts"), true);
  assert.equal(isTestOnlyPath("apps/web/src/app/App.tsx"), false);
  assert.equal(isTestOnlyPath("apps/web/src/features/testing/helpers.ts"), false);
});
