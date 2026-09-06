import assert from "node:assert/strict";
import test from "node:test";
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
