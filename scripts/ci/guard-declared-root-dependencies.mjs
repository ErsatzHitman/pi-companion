// T227: CI guard — every third-party import `scripts/ci`'s own production
// modules use must be declared in the ROOT `package.json` (`dependencies`
// or `devDependencies`). `scripts/ci` runs from the repository root with
// no workspace manifest of its own, which is exactly why an import there
// has no other manifest to satisfy it: `run-guard-web-session-bundle-
// budget.mjs` imports `build`/`loadConfigFromFile`/`mergeConfig` from
// `vite`, and `vite` was declared only in `apps/web/package.json` — the
// import resolved purely because npm hoists that workspace's copy into the
// root `node_modules`. That is the T194 shape (a real dependency no
// manifest declares, working only by hoisting) one level removed: T194 was
// an app importing an undeclared WORKSPACE package; this is a CI script
// importing an undeclared THIRD-PARTY package. Both fail the same way — a
// nested or conflicting install anywhere in the tree stops the hoist from
// resolving it, and nothing before this guard would notice until that
// install actually happened.
//
// ## Scope: production `scripts/ci/*.mjs` files only, never `*.test.mjs`
//
// Several guards and their tests in this directory embed literal import
// statements as STRING/TEMPLATE-LITERAL FIXTURE TEXT, to feed some OTHER
// guard's own import-extraction logic under test — e.g.
// `guard-axe-route-coverage.test.mjs` contains real source lines reading
// `import { componentLabRoute } from "../dev/component-lab-route.js";`
// and `import { brokenRoute } from "./broken.js";` inside template-literal
// fixtures, where neither `component-lab-route.js` nor `broken.js` is a
// real file on disk — they exist only as fixture text for that guard's own
// route-import parser. A text-based scanner over `.test.mjs` files cannot
// tell that fixture text from a real import of the test file itself
// (both start a line with the literal word `import`), so scanning test
// files here would produce violations against specifiers nothing actually
// imports. Production `scripts/ci/*.mjs` files carry no equivalent
// fixture-string risk for THIS guard's own purpose (measured: the only
// real, non-fixture, non-comment bare/scoped specifier across every
// production file in this directory, at the commit T227 was written
// against, is `vite` in `run-guard-web-session-bundle-budget.mjs` — see
// this guard's own test for the read-only proof). Excluding test files is
// therefore a deliberate scope decision, not an oversight: it trades
// "test files' own real imports are unchecked" for "no false violation
// from a sibling guard's fixture text", and the former is the narrower,
// safer gap — every `*.test.mjs` file's own real top-level imports in this
// directory are `node:*` builtins or relative paths today, so nothing is
// silently missed by the exclusion as of this writing.
//
// ## Comments are stripped before parsing, string literals are not
//
// `guard-no-legacy-app-tree.mjs`'s own header comment quotes import-shaped
// example text naming the legacy package scope and the legacy app path —
// genuine doc-comment prose describing what its OWN pattern matches, not a
// real import. `stripComments` below erases
// `/* */` and `//` comment text before any extraction pattern runs (mirrors
// `guard-capability-prose.mjs`'s own `stripComments`), so a doc comment
// quoting example import syntax can never be mistaken for a real one. String
// literals are deliberately NOT stripped — the whole point is to read the
// specifier inside a real import statement's own string literal.
//
// That guard, by contrast, scans RAW text and allowlists its own path, so the
// same quotation is safe there and was NOT safe here. Quoting it in this file
// turned `guard-no-legacy-app-tree` red on the very commit that introduced this
// comment, breaking `main`. Describe those shapes; do not reproduce them — the
// same rule `docs/security-and-version-drift.md` applies to secret-shaped
// literals, for the same reason: a file's own explaining example is still text
// in the file. (CORRECTED at the P9-W9 merge gate: this comment previously
// reproduced that guard's three example specifiers verbatim.)
//
// Pure, dependency-free check functions only.
// `run-guard-declared-root-dependencies.mjs` is the CLI entry point.

import { builtinModules } from "node:module";

import { stripComments } from "./source-comment-stripper.mjs";

const BUILTIN_MODULE_NAMES = new Set(builtinModules);

/**
 * @param {string} specifier
 * @returns {boolean} whether `specifier` names a Node.js builtin module,
 *   `node:`-prefixed or bare (`"node:fs"`, `"fs"`, `"fs/promises"`)
 */
export function isNodeBuiltinSpecifier(specifier) {
  if (specifier.startsWith("node:")) return true;
  const bare = specifier.split("/")[0];
  return BUILTIN_MODULE_NAMES.has(bare);
}

/**
 * @param {string} specifier
 * @returns {boolean} whether `specifier` is a relative or absolute path
 *   import — never a root-manifest dependency
 */
export function isRelativeSpecifier(specifier) {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

// This repository's own workspace scope. A `@picompanion/*` specifier is
// satisfied by npm workspace linking, never by a root-manifest
// `dependencies`/`devDependencies` entry — see
// `guard-declared-workspace-deps.mjs` for the sibling guard that checks
// THESE imports are declared in the correct WORKSPACE manifest instead.
const WORKSPACE_SCOPE = "@picompanion/";

/**
 * @param {string} specifier
 * @returns {boolean} whether `specifier` is this repository's own
 *   `@picompanion/*` workspace scope
 */
export function isWorkspaceSpecifier(specifier) {
  return specifier.startsWith(WORKSPACE_SCOPE);
}

/**
 * The root-manifest package name a specifier resolves to:
 * `"vite"` -> `"vite"`, `"vite/client"` -> `"vite"`,
 * `"@foo/bar"` -> `"@foo/bar"`, `"@foo/bar/baz"` -> `"@foo/bar"`.
 * @param {string} specifier
 * @returns {string}
 */
export function resolveRootPackageName(specifier) {
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) return segments.slice(0, 2).join("/");
  return segments[0];
}

// T244: this file used to hand-roll its own line-first-then-block
// `stripComments` here, with a paragraph describing the real collision that
// order has against a block comment containing literal `//`-shaped text;
// see `source-comment-stripper.mjs`'s own header for that collision's full
// history, including the fact that it happens right here — `guard-no-
// duplicate-permission-state.mjs` is one of the production files this
// guard scans, and its real header carries exactly that shape.
// `stripComments` is now the shared, order-independent tokenizer imported at
// the top of this file from `./source-comment-stripper.mjs` and re-exported
// here (this file's own test imports it directly), used identically by the
// other three guards T244 fixed. `guard-declared-root-dependencies.test.mjs`
// keeps this file's own per-file real-import proof (every production
// `.mjs` file whose raw text contains a real import still yields a
// specifier through the shared stripper) so a future regression in the
// shared module is still caught here, not only in that module's own test.
export { stripComments };

// Captures one `import ... from "specifier"` statement, including a
// multi-line named-import clause. `[^;]*?` (not `[\s\S]*?`) bounds the
// clause at the first `;` so it cannot cross into an unrelated later
// statement — mirrors `guard-declared-workspace-deps.mjs`'s own
// `STATIC_IMPORT_PATTERN` and the reasoning in its header comment.
const STATIC_IMPORT_PATTERN = /^[ \t]*import\s+(?:type\s+)?[^;]*?\s*from\s*["'`]([^"'`]+)["'`]/gm;

// A bare `import "specifier";` (side-effect only).
const SIDE_EFFECT_IMPORT_PATTERN = /^[ \t]*import\s*["'`]([^"'`]+)["'`]/gm;

// `export { X } from "specifier"` / `export type { X } from "specifier"`.
const REEXPORT_PATTERN = /^[ \t]*export\s+(?:type\s+)?\{[^}]*\}\s*from\s*["'`]([^"'`]+)["'`]/gm;

// `import("specifier")` — dynamic import, anywhere in the statement.
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g;

// `require("specifier")`.
const REQUIRE_PATTERN = /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g;

/**
 * @param {string} content source file text (comments not yet stripped)
 * @returns {string[]} every distinct import/require specifier this file's
 *   source contains, comment text excluded
 */
export function extractImportSpecifiers(content) {
  const stripped = stripComments(content);
  const found = new Set();
  for (const pattern of [
    STATIC_IMPORT_PATTERN,
    SIDE_EFFECT_IMPORT_PATTERN,
    REEXPORT_PATTERN,
    DYNAMIC_IMPORT_PATTERN,
    REQUIRE_PATTERN,
  ]) {
    for (const match of stripped.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

/**
 * @param {{ path: string, content: string }[]} files production
 *   `scripts/ci/*.mjs` files (never `*.test.mjs` — see this module's header)
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} rootManifest
 *   the repository root's own parsed `package.json`
 * @returns {{ path: string, packageName: string, specifier: string }[]}
 *   every third-party import whose resolved package name is declared in
 *   neither `dependencies` nor `devDependencies` of `rootManifest`,
 *   deduplicated by (path, packageName), sorted by path then packageName
 */
export function findUndeclaredRootDependencies(files, rootManifest) {
  const declared = new Set([
    ...Object.keys(rootManifest.dependencies ?? {}),
    ...Object.keys(rootManifest.devDependencies ?? {}),
  ]);
  const seen = new Set();
  const violations = [];

  for (const { path, content } of files) {
    for (const specifier of extractImportSpecifiers(content)) {
      if (isRelativeSpecifier(specifier)) continue;
      if (isNodeBuiltinSpecifier(specifier)) continue;
      if (isWorkspaceSpecifier(specifier)) continue;
      const packageName = resolveRootPackageName(specifier);
      if (declared.has(packageName)) continue;
      const key = `${path} ${packageName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({ path, packageName, specifier });
    }
  }

  violations.sort(
    (a, b) => a.path.localeCompare(b.path) || a.packageName.localeCompare(b.packageName),
  );
  return violations;
}
