import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  computeEntryPoints,
  extractSpecifiers,
  findOrphanModules,
  isConfigFile,
  isConventionEntryDirectory,
  isNamedWorkerEntry,
  packageHasWildcardExport,
  resolveRelativeSpecifier,
  resolveWorkspaceSpecifier,
  stripComments,
} from "./orphan-modules.mjs";

/** Builds the { files, contents, packages } shape findOrphanModules expects
 * from a plain { "path": "content" } map, so each test fixture reads as a
 * small file tree rather than three parallel arrays. */
function tree(fileContents, packages = []) {
  const files = Object.keys(fileContents);
  const contents = new Map(Object.entries(fileContents));
  return { files, contents, packages };
}

// --- Mode 1: bare side-effect imports and export...from barrels -----------

test("mode 1: a bare side-effect import and an export-from barrel are real edges", () => {
  const result = findOrphanModules(
    tree({
      "apps/web/src/app/root.test.ts": [
        'import "../features/register-side-effect";',
        'export * from "../features/barrel-target";',
      ].join("\n"),
      "apps/web/src/features/register-side-effect.ts": "export const registered = true;\n",
      "apps/web/src/features/barrel-target.ts": "export const barrelValue = 1;\n",
    }),
  );

  assert.deepEqual(result.orphans, []);
});

test('mode 1 regression check: a regex that only matches `import X from "y"` misses both forms', () => {
  // Same fixture as above, but exercised against the narrower pattern set
  // extractSpecifiers would produce if the bare-side-effect-import and
  // export-from handling were removed — proves the fixture really would
  // false-positive without it, not just that the real function passes.
  const naivePattern = /\bimport\s+[\w${},*\s]+\s+from\s+["'`]([^"'`]+)["'`]/g;
  const source = [
    'import "../features/register-side-effect";',
    'export * from "../features/barrel-target";',
  ].join("\n");

  const specifiers = [];
  let match;
  naivePattern.lastIndex = 0;
  while ((match = naivePattern.exec(source))) specifiers.push(match[1]);

  assert.deepEqual(specifiers, [], "a named-import-only regex must find neither specifier here");
  // ...while the real extractSpecifiers finds both.
  assert.deepEqual(extractSpecifiers(source).sort(), [
    "../features/barrel-target",
    "../features/register-side-effect",
  ]);
});

// --- Mode 2: doc-comment prose must not forge an edge ----------------------

test("mode 2: a doc comment mentioning a real file's import path does not rescue it", () => {
  const result = findOrphanModules(
    tree({
      "apps/web/src/app/root.test.ts": [
        "/**",
        ' * e.g. `import { helper } from "../features/truly-dead";`',
        " */",
        "export const noop = true;",
      ].join("\n"),
      "apps/web/src/features/truly-dead.ts": "export const helper = 1;\n",
    }),
  );

  assert.deepEqual(result.orphans, ["apps/web/src/features/truly-dead.ts"]);
});

test("mode 2 regression check: extracting specifiers without stripping comments forges the edge", () => {
  const source = [
    "/**",
    ' * e.g. `import { helper } from "../features/truly-dead";`',
    " */",
    "export const noop = true;",
  ].join("\n");

  // What extractSpecifiers would find if it skipped stripComments first.
  const withoutStripping = [];
  const fromClause = /\bfrom\s+["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = fromClause.exec(source))) withoutStripping.push(match[1]);
  assert.deepEqual(
    withoutStripping,
    ["../features/truly-dead"],
    "the comment text alone would forge an edge",
  );

  // The real function strips comments first, so it finds none.
  assert.deepEqual(extractSpecifiers(source), []);
  assert.equal(stripComments(source).includes("truly-dead"), false);
});

// --- Mode 3: non-src entry points (app.config.ts, plugins/**, modules/**, *.config.*) ---

test("mode 3: app.config.ts, a plugins/** file, and a modules/** file are entries with no importer", () => {
  const result = findOrphanModules(
    tree({
      "apps/android/app.config.ts": "export default { name: 'app' };\n",
      "apps/android/plugins/with-share-intent-module.ts":
        "export function withPlugin(c) { return c; }\n",
      "apps/android/modules/share-intent/index.ts": "export const native = {};\n",
    }),
  );

  assert.deepEqual(result.orphans, []);
  assert.equal(isConfigFile("apps/android/app.config.ts"), true);
  assert.equal(
    isConventionEntryDirectory("apps/android/plugins/with-share-intent-module.ts"),
    true,
  );
  assert.equal(isConventionEntryDirectory("apps/android/modules/share-intent/index.ts"), true);
});

test("mode 3 regression check: without the path-based entry rules, all three are unreachable", () => {
  // No import anywhere resolves to these three paths, so with
  // isPathBasedEntryPoint's config/plugins/modules branches removed,
  // computeEntryPoints would return an empty set and every file here would
  // be an orphan by construction.
  const files = [
    "apps/android/app.config.ts",
    "apps/android/plugins/with-share-intent-module.ts",
    "apps/android/modules/share-intent/index.ts",
  ];
  assert.equal(
    files.some((f) => isConfigFile(f) || isConventionEntryDirectory(f)),
    true,
  );
});

// --- Mode 4: ESM .js/.jsx specifiers resolving back to .ts/.tsx -----------

test("mode 4: a .js-suffixed relative specifier resolves to the tracked .ts source", () => {
  const result = findOrphanModules(
    tree({
      "packages/protocol/src/index.test.ts":
        'import { schema } from "./validation/ws-outbound.js";\n',
      "packages/protocol/src/validation/ws-outbound.ts": "export const schema = {};\n",
    }),
  );

  assert.deepEqual(result.orphans, []);
});

test("mode 4 regression check: resolving only the literal .js path (no .ts fallback) leaves the file unresolved", () => {
  const fileSet = new Set(["packages/protocol/src/validation/ws-outbound.ts"]);
  const resolved = resolveRelativeSpecifier(
    "packages/protocol/src/index.test.ts",
    "./validation/ws-outbound.js",
    fileSet,
  );
  assert.equal(resolved, "packages/protocol/src/validation/ws-outbound.ts");

  // The literal, un-mapped .js path is what a walker without the fallback
  // would have looked for — and it is never tracked, only the .ts source is.
  assert.equal(fileSet.has("packages/protocol/src/validation/ws-outbound.js"), false);
});

// --- Mode 5: CLI / child-process entry points (scripts/**, codegen/**, e2e/**, named workers) ---

test("mode 5: scripts/**, codegen/**, e2e/**, and a named worker file are entries with no importer", () => {
  const result = findOrphanModules(
    tree({
      "scripts/ci/some-guard.mjs": "console.log('guard');\n",
      "packages/server/codegen/generate-fixtures.ts": "export {};\n",
      "apps/web/e2e/smoke.spec.ts": "export {};\n",
      "packages/server/src/server/daemon-worker.ts": "process.on('message', () => {});\n",
    }),
  );

  assert.deepEqual(result.orphans, []);
  assert.equal(isNamedWorkerEntry("packages/server/src/server/daemon-worker.ts"), true);
});

test("mode 5 regression check: without the convention-dir/worker rules these four are unreachable", () => {
  assert.equal(isConventionEntryDirectory("scripts/ci/some-guard.mjs"), true);
  assert.equal(isConventionEntryDirectory("packages/server/codegen/generate-fixtures.ts"), true);
  assert.equal(isConventionEntryDirectory("apps/web/e2e/smoke.spec.ts"), true);
  assert.equal(isNamedWorkerEntry("packages/server/src/server/daemon-worker.ts"), true);
  // A path with none of those segments and a non-worker name gets none of
  // this — proving the rule is doing real, narrow work, not matching
  // everything.
  assert.equal(isConventionEntryDirectory("packages/server/src/server/bootstrap.ts"), false);
  assert.equal(isNamedWorkerEntry("packages/server/src/server/bootstrap.ts"), false);
});

// --- Mode 6: a wildcard "./*" exports map makes every src file a public entry ---

test('mode 6: a package with a wildcard "./*" export has no orphan in its src tree', () => {
  const packages = [
    {
      name: "@picompanion/protocol",
      dir: "packages/protocol",
      exports: { "./*": { types: "./dist/*.d.ts", default: "./dist/*.js" } },
    },
  ];

  const result = findOrphanModules(
    tree(
      {
        "packages/protocol/src/agent-labels.ts": "export const LABEL = 'x';\n",
        "packages/protocol/src/agent-lifecycle.ts": "export const LIFECYCLE = 'y';\n",
      },
      packages,
    ),
  );

  assert.deepEqual(result.orphans, []);
  assert.equal(packageHasWildcardExport(packages[0]), true);
});

test('mode 6 regression check: without wildcard handling, resolving a specific subpath through "./*" fails and the package\'s other files are unreachable', () => {
  const packages = [
    {
      name: "@picompanion/protocol",
      dir: "packages/protocol",
      exports: { "./*": { types: "./dist/*.d.ts", default: "./dist/*.js" } },
    },
  ];
  const fileSet = new Set(["packages/protocol/src/agent-labels.ts"]);

  // No explicit subpath key exists for "./agent-labels" — only the "./*"
  // wildcard fallback resolveWorkspaceSpecifier checks for. Confirm the
  // package really has no exact key, so a resolver naive enough to only
  // check exact keys (no wildcard fallback at all) would report this
  // specifier as unresolvable...
  assert.equal(Object.hasOwn(packages[0].exports, "./agent-labels"), false);
  const exactKeysOnly = packages[0].exports["./agent-labels"];
  assert.equal(exactKeysOnly, undefined);

  // ...while the real resolver's wildcard branch reports it resolvable (as
  // "the whole package is exported", not a specific file), and it is
  // computeEntryPoints's own wildcard-src-prefix pass — driven by that same
  // wildcard fact — that is what rescues these files: there is no per-file
  // exports entry to resolve them through individually.
  assert.deepEqual(
    resolveWorkspaceSpecifier("@picompanion/protocol/agent-labels", packages, fileSet),
    {
      kind: "wildcard",
    },
  );

  const entries = computeEntryPoints(["packages/protocol/src/agent-labels.ts"], packages);
  assert.equal(entries.has("packages/protocol/src/agent-labels.ts"), true);
});

// --- Sanity: a genuinely dead file, with none of the six protections, is still flagged ---

test("a file with no importer and none of the six protections is reported as an orphan", () => {
  const result = findOrphanModules(
    tree({
      "apps/web/src/app/root.test.ts": "export const noop = true;\n",
      "apps/web/src/features/genuinely-dead.ts": "export const unused = 1;\n",
    }),
  );

  assert.deepEqual(result.orphans, ["apps/web/src/features/genuinely-dead.ts"]);
});

// --- T252: migrated to the shared, order-independent tokenizer -----------
// This file's own `stripComments` used to be a hand-rolled BLOCK-first
// regex pair — the order T244 proved defective next door in
// `guard-capability-prose.mjs`, `guard-no-node-builtin-in-web-bundle.mjs`
// and `guard-no-duplicate-permission-state.mjs`. See this module's own
// header comment for the two real, in-tree files that reproduce the
// collision directly.

test("T252: guard-capability-prose.mjs's real ./source-comment-stripper.mjs import is no longer swallowed by comment-stripping order", () => {
  const content = readFileSync(
    fileURLToPath(new URL("./guard-capability-prose.mjs", import.meta.url)),
    "utf8",
  );

  // Before T252 (this module's own then-shipped block-first stripComments):
  // extractSpecifiers(content) did not contain this specifier at all. Two
  // of this file's own header lines cascade into the real collision: a
  // `//` comment reading `` `packaging/**` `` (whose `/*` closes early,
  // by accident, on an unrelated later `*/`) leaves a SECOND `//` comment's
  // `` `packages/*/src` `` / `` `apps/*/src` `` glob text to open its own
  // false block, which then runs forward and swallows this file's real
  // `import { stripComments as sharedStripComments } from
  // "./source-comment-stripper.mjs";` statement along with everything else
  // up to an unrelated JSDoc block far later in the file — the real edge
  // orphan-modules.mjs's own walker needs to see this file as depending on
  // ./source-comment-stripper.mjs was invisible to it purely because of
  // comment-stripping order. This is the real, in-tree file; a hand-
  // shortened fixture could not be made to reproduce the exact two-stage
  // cascade without becoming the file itself.
  assert.ok(
    extractSpecifiers(content).includes("./source-comment-stripper.mjs"),
    "extractSpecifiers must find this file's real ./source-comment-stripper.mjs import",
  );
});

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
    "function toPickedFile(name) {",
    "  return { name };",
    "}",
  ].join("\n");

  const stripped = stripComments(source);

  // Before T252, old block-first stripComments misread the "/*" hiding
  // inside the "*/*" string as a block comment's opener and swallowed
  // everything up to the JSDoc's OWN "*/" terminator further down —
  // deleting the rest of matchesAccept's real body, including this line,
  // without ever touching `function toPickedFile` (which sits after that
  // terminator and survives either way — not itself a discriminating
  // assertion).
  assert.match(stripped, /return mimeType === pattern;/);
  assert.match(stripped, /function\s+toPickedFile/);
  assert.match(stripped, /return\s*\{\s*name\s*\}/);
});

// --- T252's own acceptance criterion, this walker's own shape: PER FILE ---
// Mirrors `guard-declared-root-dependencies.test.mjs`'s "every real
// scripts/ci file whose raw text has a top-level import line yields at
// least one specifier, checked per file" — same heuristic, applied to this
// walker's own `extractSpecifiers` instead of that guard's
// `extractImportSpecifiers`, and widened to every real tracked module file
// this walker itself scans (`isTrackedModuleFile`'s extension set), not
// just `scripts/ci`.
const RAW_TOP_LEVEL_IMPORT_LINE = /^[ \t]*import\s/m;

test("every real tracked module file whose raw text has a top-level import line yields at least one specifier through extractSpecifiers, checked per file", () => {
  const repoRoot = fileURLToPath(new URL(".", import.meta.url)).replace(
    /scripts[\\/]ci[\\/]?$/,
    "",
  );
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((path) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path) && !path.endsWith(".d.ts"))
    // Test fixture files intentionally embed import-SHAPED text that names
    // files which do not exist on disk, to exercise some OTHER guard's own
    // parser under test — not real edges this walker should reason about.
    // Excluding them here mirrors `guard-declared-root-dependencies.mjs`'s
    // own documented scope decision for the identical reason.
    .filter(
      (path) =>
        !path.endsWith(".test.ts") && !path.endsWith(".test.tsx") && !path.endsWith(".test.mjs"),
    );

  assert.ok(tracked.length > 100, "expected many tracked module files");

  const filesWithRawImportLine = tracked.filter((path) => {
    const content = readFileSync(`${repoRoot}${path}`, "utf8");
    return RAW_TOP_LEVEL_IMPORT_LINE.test(content);
  });
  assert.ok(filesWithRawImportLine.length > 100, "expected many files with a real import line");

  const filesWithNoExtractedSpecifier = filesWithRawImportLine.filter((path) => {
    const content = readFileSync(`${repoRoot}${path}`, "utf8");
    return extractSpecifiers(content).length === 0;
  });

  assert.deepEqual(
    filesWithNoExtractedSpecifier,
    [],
    "every one of these files' raw text starts a line with `import`, so extractSpecifiers must" +
      " return at least one specifier for each — an empty result for any of them means comment" +
      " stripping silently ate a real import",
  );
});
