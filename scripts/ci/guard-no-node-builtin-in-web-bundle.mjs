// T126: CI guard — no module reachable from `apps/web`'s production entry
// (`apps/web/src/main.tsx`) may import a `node:` builtin. `vite build`
// reports that as a "has been externalized for browser compatibility"
// **warning** and still exits 0 (plan.md invariant note, this task's brief),
// so nothing before this guard stopped a future production import from
// putting `node:fs` back on the bundle graph the way T38A5 did and P6-W5's
// `eb9fa55` fixed by hand (a 17-line barrel-export block in
// `apps/web/src/features/sessions/index.ts`).
//
// T133: Vite externalizes a builtin the same way whether the specifier is
// written `node:fs` or the bare, unprefixed `fs` — but T126's original walk
// only ever checked the `node:`-prefixed form. Reproduced at the P6-W9 gate
// and again by the reviewer: appending `import "fs";` to
// `apps/web/src/features/sessions/index.ts` (the exact file the `eb9fa55`
// fix touched) left this guard at `OK ... exit=0` while
// `cd apps/web && npm run build` emitted one `has been externalized` line.
// This file now checks both forms. The bare-form check is exact-match
// against Node's own `node:module` `builtinModules` list (never a
// hand-typed list — a typo or a stale copy would either miss a real
// builtin or, worse, flag a same-named real dependency) and only ever
// applies to a specifier that is not already a relative path — a project
// file that merely happens to be named e.g. `fs.ts` is reached through a
// relative specifier (`"./fs"`), never a bare one, so it is never a
// candidate in the first place; see `isBareNodeBuiltinSpecifier`'s own
// comment and this file's test for the "shares a builtin's name but isn't
// one" case a hand-typed prefix list could get wrong.
//
// This is a real import-graph walk from the entry, not a whole-directory
// grep — a grep would flag test files (which legitimately read fixtures off
// disk with `node:fs`), miss a builtin reached only through a barrel
// re-export, and trip on a doc comment that merely *quotes* an import
// statement (`plan-section-11-1-commands.ts`'s own header names
// `node:fs`/`node:path`/`node:url` in prose describing why this guard
// exists). Comments are stripped before any regex runs against source text
// for exactly that reason.
//
// Pure, dependency-free (beyond `node:path` and `node:module`, which this
// *script* runs under Node — never bundled into `apps/web` itself) check
// functions only. `run-guard-no-node-builtin-in-web-bundle.mjs` is the CLI
// entry point CI actually runs, walking the real filesystem from the real
// entry; `guard-no-node-builtin-in-web-bundle.test.mjs` seeds a small
// in-memory file map instead so every catalogued resolution trap can be
// proven without touching the real working tree.

import { builtinModules } from "node:module";
import { posix } from "node:path";

/** A module reachable from the entry whose filename marks it as test-only
 * is allowed to import a `node:` builtin even if the walk somehow reaches
 * it (today it never does — nothing in `apps/web/src` imports a `.test.*`
 * file from production code — but the exemption is explicit and load-
 * bearing on its own, not merely a side effect of unreachability, so a
 * future barrel that accidentally pulls a fixture-loading `.test.ts` file
 * into the graph does not turn this guard red for a file whose `node:fs`
 * import never reaches a real browser). */
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[jt]sx?$/;

/** Extensions this guard knows how to parse for import specifiers. Every
 * other tracked file (`.css`, `.woff2`, `.txt`, …) is a valid resolution
 * target — an import can point at one — but is never itself walked for
 * further specifiers. */
const PARSEABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Extensions tried, in order, when a relative specifier has none of its
 * own (`from "./foo"`). */
const EXTENSIONLESS_RESOLUTION_ORDER = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

/** `index.*` basenames tried when a specifier resolves to a directory. */
const INDEX_BASENAMES = ["index.ts", "index.tsx", "index.js", "index.jsx"];

/** Exact-match set of every bare name Node itself considers a core module
 * (`"fs"`, `"path"`, `"buffer"`, `"assert/strict"`, the underscore-prefixed
 * internal stream/http modules, …), sourced from `node:module`'s own
 * `builtinModules` rather than typed out by hand here — a hand-typed list
 * can go stale as Node adds modules, or (worse for this guard specifically)
 * be built as a prefix/substring check that flags a real, differently-named
 * dependency that merely starts with a builtin's name (`"path-to-regexp"`,
 * `"fs-extra"`) as if it were the builtin itself. Membership is checked with
 * exact string equality for exactly that reason. */
const NODE_BUILTIN_MODULE_NAMES = new Set(builtinModules);

/**
 * Strips block and line comments before any import-specifier regex is run
 * against a file's text — the codebase's established defense against a
 * doc comment that quotes a real import statement forging an edge (P6-W6's
 * `session-tree-sheet.contract.test.ts` precedent; this exact file's own
 * header comment names `node:fs`/`node:path`/`node:url` in prose).
 *
 * @param {string} content
 * @returns {string}
 */
export function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Matches, in order of capture group: a dynamic `import("spec")`, a
 * `require("spec")`, the `from "spec"` clause of a static `import`/`export`
 * (covers named, default, namespace, type-only, and `export ... from`
 * barrel re-exports alike, since both keywords use `from`), and a bare
 * side-effect `import "spec";` with no `from` clause at all (e.g.
 * `apps/web/src/main.tsx`'s `import "./styles/global.css";`).
 *
 * @param {string} strippedContent content that has already had comments removed
 * @returns {string[]} raw import specifiers, in file order, duplicates included
 */
export function extractImportSpecifiers(strippedContent) {
  const pattern =
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)|\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)|\bfrom\s+["'`]([^"'`]+)["'`]|^[ \t]*import\s+["'`]([^"'`]+)["'`]\s*;/gm;
  const specifiers = [];
  let match;
  while ((match = pattern.exec(strippedContent)) !== null) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

/**
 * @param {string} specifier
 * @returns {boolean}
 */
export function isNodeBuiltinSpecifier(specifier) {
  return specifier.startsWith("node:");
}

/**
 * Matches the *bare*, unprefixed form of a Node builtin specifier —
 * `"fs"`, `"path"`, `"buffer"`, `"assert/strict"` — which Vite externalizes
 * for a browser build exactly the same way it does the `node:`-prefixed
 * form (T133's gap: `isNodeBuiltinSpecifier` alone never saw this form).
 *
 * Exact-match against `node:module`'s `builtinModules`, and only for a
 * specifier that is not already a relative path: a project file that
 * happens to be named `fs.ts` is only ever reached through a relative
 * specifier (`"./fs"`, `"../lib/fs"`), never a bare one, so
 * `isRelativeSpecifier` alone is what keeps a same-named local file from
 * ever being a candidate here — it is a real project module, walked and
 * resolved the ordinary way, not a builtin coincidence this function needs
 * to reason about.
 *
 * @param {string} specifier
 * @returns {boolean}
 */
export function isBareNodeBuiltinSpecifier(specifier) {
  return !isRelativeSpecifier(specifier) && NODE_BUILTIN_MODULE_NAMES.has(specifier);
}

/**
 * @param {string} specifier
 * @returns {boolean}
 */
export function isRelativeSpecifier(specifier) {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isTestOnlyPath(path) {
  return TEST_FILE_PATTERN.test(path);
}

/**
 * Resolves a relative import specifier to a repo-relative path present in
 * `files`, trying (in order) the exact join, the ESM `.js`/`.jsx` -> real
 * `.ts`/`.tsx` source-file swap (T125's catalogued trap D — this repository
 * writes `from "./App.js"` and ships `App.tsx`), each known extension
 * appended to an extensionless specifier, and each `index.*` basename under
 * a directory specifier. Returns `null` for anything unresolved — including
 * every bare package specifier (`"react"`, `"@picompanion/frontend-core"`,
 * `"jsqr"`), which this guard treats as an external boundary and never
 * walks into node_modules to resolve.
 *
 * @param {string} fromPath repo-relative path of the importing file
 * @param {string} specifier the raw specifier text
 * @param {Map<string, string>} files repo-relative path -> file content
 * @returns {string | null}
 */
export function resolveRelativeSpecifier(fromPath, specifier, files) {
  if (!isRelativeSpecifier(specifier)) return null;

  const baseDir = posix.dirname(fromPath);
  const rawCandidate = posix.normalize(posix.join(baseDir, specifier));

  const candidates = [rawCandidate];

  if (rawCandidate.endsWith(".js")) {
    const stem = rawCandidate.slice(0, -3);
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  } else if (rawCandidate.endsWith(".jsx")) {
    candidates.push(`${rawCandidate.slice(0, -4)}.tsx`);
  }

  if (posix.extname(rawCandidate) === "") {
    for (const ext of EXTENSIONLESS_RESOLUTION_ORDER) {
      candidates.push(rawCandidate + ext);
    }
    for (const indexBasename of INDEX_BASENAMES) {
      candidates.push(posix.join(rawCandidate, indexBasename));
    }
  }

  for (const candidate of candidates) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Walks the real import graph from `entryPath`, breadth-first, over the
 * in-memory `files` map, and reports every Node builtin import — both the
 * `node:`-prefixed form and the bare, unprefixed form (T133) — found on a
 * module the walk actually reaches — skipping any module whose path is
 * test-only (see `isTestOnlyPath`). Never recurses into a bare package
 * specifier or an unresolved relative one, and never re-parses a file this
 * walk has already visited.
 *
 * @param {Map<string, string>} files repo-relative path -> file content (test-only
 *   files included, so the walk itself proves they are unreached rather than
 *   merely omitted from the fixture)
 * @param {string} entryPath repo-relative path of the production entry module
 * @returns {{ path: string, specifier: string }[]} violations, in the order the walk found them
 */
export function findNodeBuiltinViolations(files, entryPath) {
  const visited = new Set();
  const queue = [entryPath];
  const violations = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const content = files.get(current);
    if (content === undefined) continue;

    const ext = posix.extname(current);
    if (!PARSEABLE_EXTENSIONS.has(ext)) continue;

    const testOnly = isTestOnlyPath(current);
    const specifiers = extractImportSpecifiers(stripComments(content));

    for (const specifier of specifiers) {
      if (isNodeBuiltinSpecifier(specifier) || isBareNodeBuiltinSpecifier(specifier)) {
        if (!testOnly) {
          violations.push({ path: current, specifier });
        }
        continue;
      }

      if (!isRelativeSpecifier(specifier)) continue; // external package: boundary, not walked

      const resolved = resolveRelativeSpecifier(current, specifier, files);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return violations;
}
