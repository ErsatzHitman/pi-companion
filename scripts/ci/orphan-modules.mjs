// T125: the import-graph orphan walker, committed. T115's acceptance
// criterion ("the walker's orphan count drops by three, run base-vs-HEAD")
// was unverifiable by anyone until this existed: `scripts/ci/` held only
// the eight guard scripts, and the P6-W4 walk that produced the 27-orphan
// baseline was ad hoc in a session scratchpad, never committed.
//
// This module is pure, dependency-free graph logic only (no fs, no git) so
// `orphan-modules.test.mjs` can seed a synthetic file set without touching
// the real working tree. `run-orphan-modules.mjs` is the CLI entry point
// that reads `git ls-files`, package.json exports maps, and file contents,
// and calls into this module — the same split every other
// `scripts/ci/guard-*.mjs` / `run-guard-*.mjs` pair uses.
//
// Six over-reporting (and one under-reporting) modes are catalogued from the
// P6-W4 walk and each has a dedicated handling path below, exercised one at
// a time by `orphan-modules.test.mjs`:
//
//   (1) bare side-effect imports (`import "./x";`) and `export ... from`
//       barrels, both swallowed by a regex that only matches
//       `import X from "y"` — see extractSpecifiers's four patterns.
//   (2) doc-comment prose forging a fake edge (a comment that happens to
//       contain literal `from "./real-file"` text must not "use" that
//       file) — see stripComments, applied before specifier extraction.
//   (3) non-src entry points (`app.config.ts`, `plugins/**`, `modules/**`,
//       `*.config.*`) that nothing imports but that a bundler or Expo
//       config loads by file-system convention — see isConfigFile /
//       isConventionEntryDirectory.
//   (4) ESM `.js`/`.jsx` specifiers that must resolve back to `.ts`/`.tsx`
//       because the emitted file never exists in this repo's tracked
//       source tree — see resolveRelativeSpecifier's dist-extension
//       fallback. This one alone suppressed 807 false positives at P6-W4.
//   (5) CLI and child-process entry points (`scripts/**`, `codegen/**`,
//       `e2e/**`, and the three worker files spawned by path string rather
//       than imported: `daemon-worker.ts`, `worker-process.ts`,
//       `terminal-worker-process.ts`) — see isConventionEntryDirectory /
//       isNamedWorkerEntry.
//   (6) a package whose `exports` map carries a wildcard subpath (`"./*"`,
//       `packages/protocol`'s shape) makes every module under that
//       package's `src/` a public entry point, not just the files an
//       explicit subpath names — see packageHasWildcardExport. This is
//       exactly why `packages/protocol/src/literal-union.ts` (imported by
//       nothing anywhere in the repository, per T100's own `grep -rn`)
//       never surfaced as an orphan in any prior walk: mode 6 marks the
//       whole wildcarded `src/` reachable, so a genuinely dead file inside
//       it reads as "used" by construction. T100 deleted that file by
//       hand instead of relying on this walker to ever catch it — mode 6
//       is a documented blind spot, not a bug this walker can close for a
//       wildcard-exported package without losing the ability to treat
//       legitimately-public subpaths as entry points.

import { posix } from "node:path";

const { dirname, join, normalize, extname, basename } = posix;

/** Extensions this walker treats as real modules with edges to resolve.
 * `.d.ts` is deliberately excluded: ambient declaration files (`vite-env.d.ts`,
 * `expo-env.d.ts`) are never imported, they are pulled in by tsconfig's
 * `include` glob, so counting them as orphans would be noise, not signal. */
export const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const MODULE_EXTENSION_SET = new Set(MODULE_EXTENSIONS);

/**
 * @param {string} path repo-relative, forward-slash path
 * @returns {boolean}
 */
export function isTrackedModuleFile(path) {
  if (path.endsWith(".d.ts")) return false;
  return MODULE_EXTENSION_SET.has(extname(path));
}

// --- (2) comment stripping, applied before any specifier regex runs -------

/**
 * Strips block and line comments so a doc comment that happens to contain
 * literal import-shaped text (`e.g. import { X } from "./file"`) can never
 * be misread as a real edge. Deliberately simple — the same
 * `/\*[\s\S]*?\*\//` + `//.*$` pair `T130`'s sweep documents — not a full
 * tokenizer; good enough for this codebase's own source, not a general JS
 * parser.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// --- (1) specifier extraction: named, bare side-effect, barrel, dynamic ---

const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
// Covers `import X from "y"`, `import { X } from "y"`, and both
// `export { X } from "y"` and `export * from "y"` barrels — all of them
// have a `from "..."` clause.
const FROM_CLAUSE_PATTERN = /\bfrom\s+["'`]([^"'`]+)["'`]/g;
// Covers a bare side-effect import with no `from` clause at all:
// `import "./register-something";`.
const BARE_SIDE_EFFECT_IMPORT_PATTERN = /^\s*import\s+["'`]([^"'`]+)["'`]/gm;
const REQUIRE_CALL_PATTERN = /\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

const SPECIFIER_PATTERNS = [
  DYNAMIC_IMPORT_PATTERN,
  FROM_CLAUSE_PATTERN,
  BARE_SIDE_EFFECT_IMPORT_PATTERN,
  REQUIRE_CALL_PATTERN,
];

/**
 * @param {string} source raw file content
 * @returns {string[]} every distinct import/require/export-from specifier
 */
export function extractSpecifiers(source) {
  const clean = stripComments(source);
  const specifiers = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(clean))) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

// --- (3) + (5) path-based entry points: config files and CLI/child-process

// Matches `vite.config.ts`, `vitest.config.ts`, `metro.config.js`,
// `babel.config.js`, `playwright.config.ts`, `app.config.ts`, and any other
// `*.config.<ext>` file — none of these are ever statically imported; a
// bundler or framework loads them by file-system convention.
const CONFIG_FILE_PATTERN = /\.config\.[cm]?[jt]sx?$/;

/** @param {string} path @returns {boolean} */
export function isConfigFile(path) {
  return CONFIG_FILE_PATTERN.test(basename(path));
}

// Directory segments that mark every file beneath them as a CLI,
// child-process, plugin-config, or test-harness entry point: nothing in
// the repo imports them, a runner or `node`/child_process invokes them by
// path, or (for `plugins`/`modules`) Expo's config-plugin loader reads them
// by file-system convention instead of a static import.
const CONVENTION_ENTRY_DIR_SEGMENTS = new Set(["scripts", "codegen", "e2e", "plugins", "modules"]);

/** @param {string} path @returns {boolean} */
export function isConventionEntryDirectory(path) {
  return path.split("/").some((segment) => CONVENTION_ENTRY_DIR_SEGMENTS.has(segment));
}

// The three worker/child-process entry points named explicitly in T125's
// brief: each is spawned by a path string (child_process/worker_threads),
// never statically imported, so no amount of graph-walking will ever find
// an edge into them.
const NAMED_WORKER_ENTRY_BASENAMES = new Set([
  "daemon-worker.ts",
  "worker-process.ts",
  "terminal-worker-process.ts",
]);

/** @param {string} path @returns {boolean} */
export function isNamedWorkerEntry(path) {
  return NAMED_WORKER_ENTRY_BASENAMES.has(basename(path));
}

// Test files are always run directly by a test runner (vitest/`node --test`),
// never imported by production code, so they are entry points in their own
// right — and, being real files with real imports, useful graph roots that
// let a colocated `*.test.ts` reach the module it exercises.
const TEST_FILE_PATTERN =
  /\.(test|spec|contract\.test|e2e\.test|real\.e2e\.test|bench\.test)\.[cm]?[jt]sx?$/;

/** @param {string} path @returns {boolean} */
export function isTestFile(path) {
  return TEST_FILE_PATTERN.test(path);
}

// Framework bootstrap files nothing in this repo's own source imports:
// `apps/web/src/main.tsx` is wired only from `index.html`'s
// `<script type="module" src="/src/main.tsx">`, which this JS/TS-only
// walker never parses. Kept as a short, explicit, named allowlist rather
// than a heuristic — exactly one entry today.
const EXPLICIT_BOOTSTRAP_ENTRIES = new Set(["apps/web/src/main.tsx"]);

// Expo Router's file-based routing: every file under an app's route
// directory is a route (or route layout) the router discovers by
// file-system convention, never by import. This mirrors this repository's
// own `knip.json`, which declares `apps/android`'s entry as exactly
// `"src/app/**/*.{ts,tsx}"` — the same convention, independently encoded.
const ROUTER_ENTRY_DIR_PREFIXES = ["apps/android/src/app/"];

/** @param {string} path @returns {boolean} */
export function isFrameworkBootstrapEntry(path) {
  if (EXPLICIT_BOOTSTRAP_ENTRIES.has(path)) return true;
  return ROUTER_ENTRY_DIR_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * @param {string} path
 * @returns {boolean} true when `path` is an entry point purely by virtue of
 *   where it lives or how it is named — independent of any package's
 *   `exports` map (see packageHasWildcardExport / exports-map subpath
 *   entries for that half).
 */
export function isPathBasedEntryPoint(path) {
  return (
    isConfigFile(path) ||
    isConventionEntryDirectory(path) ||
    isNamedWorkerEntry(path) ||
    isTestFile(path) ||
    isFrameworkBootstrapEntry(path)
  );
}

// --- (4) relative specifier resolution, with the .js/.jsx -> .ts/.tsx fix -

/**
 * @param {string} fromPath the importing file's repo-relative path
 * @param {string} specifier a relative specifier ("./x", "../y/z")
 * @param {Set<string>} fileSet every tracked module path, for membership checks
 * @returns {string|null} the resolved repo-relative path, or null
 */
export function resolveRelativeSpecifier(fromPath, specifier, fileSet) {
  const fromDir = dirname(fromPath);
  const joined = normalize(join(fromDir, specifier));
  const candidates = [];

  if (extname(joined)) {
    candidates.push(joined);
    // ESM source written against the compiled output's own extension
    // (`./foo.js`, `./foo.jsx`) must also try the `.ts`/`.tsx` original —
    // the emitted file is never tracked, only the source it came from is.
    // A literal `.js` specifier is ambiguous between the two: TypeScript's
    // NodeNext/bundler resolution requires writing `.js` in the specifier
    // even when the real source is a `.tsx` React component (this repo's
    // own `apps/web/src/main.tsx` does exactly that importing `./app/App.js`
    // for `App.tsx`), so both must be tried.
    if (joined.endsWith(".js")) {
      const stem = joined.slice(0, -3);
      candidates.push(`${stem}.ts`, `${stem}.tsx`);
    }
    if (joined.endsWith(".jsx")) candidates.push(`${joined.slice(0, -4)}.tsx`);
  } else {
    for (const ext of MODULE_EXTENSIONS) candidates.push(`${joined}${ext}`);
    for (const ext of MODULE_EXTENSIONS) candidates.push(join(joined, `index${ext}`));
  }

  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

// --- (6) workspace package specifier resolution, wildcard exports included

/**
 * @typedef {object} WorkspacePackage
 * @property {string} name        the package.json "name" field
 * @property {string} dir         repo-relative directory, no trailing slash
 * @property {Record<string, any>|undefined} exports the package.json "exports" map
 */

/**
 * @param {WorkspacePackage} pkg
 * @returns {boolean} true when this package's exports map contains a
 *   wildcard subpath (`"./*"`, `packages/protocol`'s shape today), which
 *   makes every module under its `src/` a public entry point — resolving
 *   one wildcarded subpath at a time would just rediscover the same fact
 *   file by file, so this is checked once per package instead.
 */
export function packageHasWildcardExport(pkg) {
  return Boolean(pkg.exports && Object.hasOwn(pkg.exports, "./*"));
}

/**
 * Turns one `exports` map target (a "source"/"import"/"types"/"default"/…
 * string) into every plausible tracked-source candidate path: the target
 * itself (covers packages like `relay`/`server` whose "source"/"import"
 * field already points straight at `src/`), plus — for a `dist/…` target —
 * the `src/…` file that dist mirrors (covers packages like `client`, whose
 * exports map has no "source" field at all, only compiled `dist/` paths).
 *
 * @param {string} pkgDir
 * @param {string} target
 * @returns {string[]}
 */
function candidateSrcPathsFromExportTarget(pkgDir, target) {
  const rel = target.replace(/^\.\//, "");
  const candidates = [`${pkgDir}/${rel}`];
  const distMatch = rel.match(/^dist\/(.+?)\.(?:d\.ts|js|jsx|mjs|cjs)$/);
  if (distMatch) {
    const stem = distMatch[1];
    candidates.push(`${pkgDir}/src/${stem}.ts`, `${pkgDir}/src/${stem}.tsx`);
  }
  return candidates;
}

const EXPORT_TARGET_FIELDS = [
  "source",
  "import",
  "node",
  "react-native",
  "browser",
  "types",
  "default",
];

/**
 * @param {Record<string, any>} exportEntry one value from a package's exports map
 * @param {string} pkgDir
 * @param {Set<string>} fileSet
 * @returns {string|null}
 */
function resolveExportEntryToFile(exportEntry, pkgDir, fileSet) {
  if (typeof exportEntry === "string") exportEntry = { default: exportEntry };
  for (const field of EXPORT_TARGET_FIELDS) {
    const target = exportEntry[field];
    if (typeof target !== "string") continue;
    for (const candidate of candidateSrcPathsFromExportTarget(pkgDir, target)) {
      if (fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * @param {string} specifier a bare import specifier, e.g. "@picompanion/client/internal/x"
 * @param {WorkspacePackage[]} packages
 * @param {Set<string>} fileSet
 * @returns {{ kind: "file", path: string } | { kind: "wildcard" } | null}
 *   null means "not a workspace package specifier, or its subpath could not
 *   be resolved to a tracked src file" — the caller treats that as an
 *   external/unresolvable specifier, never a crash.
 */
export function resolveWorkspaceSpecifier(specifier, packages, fileSet) {
  for (const pkg of packages) {
    if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) continue;
    if (!pkg.exports) return null;

    const subpath = specifier === pkg.name ? "." : `./${specifier.slice(pkg.name.length + 1)}`;
    const exactEntry = pkg.exports[subpath];
    if (exactEntry) {
      const resolved = resolveExportEntryToFile(exactEntry, pkg.dir, fileSet);
      return resolved ? { kind: "file", path: resolved } : null;
    }

    if (packageHasWildcardExport(pkg)) return { kind: "wildcard" };
    return null;
  }
  return null;
}

// --- graph assembly and the orphan walk ------------------------------------

/**
 * @param {string[]} files every tracked module path considered
 * @param {WorkspacePackage[]} packages
 * @returns {Set<string>} every file that is an entry point for reasons
 *   independent of incoming edges (test files, config files, CLI/worker
 *   entries, framework bootstrap files, every file under a
 *   wildcard-exported package's `src/`, and every file an explicit
 *   `exports` subpath names).
 */
export function computeEntryPoints(files, packages) {
  const entries = new Set();
  const wildcardPackageDirs = packages
    .filter(packageHasWildcardExport)
    .map((pkg) => `${pkg.dir}/src/`);

  for (const file of files) {
    if (isPathBasedEntryPoint(file)) {
      entries.add(file);
      continue;
    }
    if (wildcardPackageDirs.some((prefix) => file.startsWith(prefix))) {
      entries.add(file);
    }
  }

  const fileSet = new Set(files);
  for (const pkg of packages) {
    if (!pkg.exports) continue;
    for (const exportEntry of Object.values(pkg.exports)) {
      const resolved = resolveExportEntryToFile(exportEntry, pkg.dir, fileSet);
      if (resolved) entries.add(resolved);
    }
  }

  return entries;
}

/**
 * @param {{ files: string[], contents: Map<string, string>, packages: WorkspacePackage[] }} input
 * @returns {{ orphans: string[], reached: string[], entryPoints: string[] }}
 */
export function findOrphanModules({ files, contents, packages }) {
  const fileSet = new Set(files);
  const entryPoints = computeEntryPoints(files, packages);

  const graph = new Map();
  for (const file of files) {
    const content = contents.get(file) ?? "";
    const targets = new Set();
    for (const specifier of extractSpecifiers(content)) {
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const resolved = resolveRelativeSpecifier(file, specifier, fileSet);
        if (resolved) targets.add(resolved);
        continue;
      }
      const resolved = resolveWorkspaceSpecifier(specifier, packages, fileSet);
      if (resolved && resolved.kind === "file") targets.add(resolved.path);
      // resolved.kind === "wildcard" needs no edge: the whole target
      // package's src/ is already seeded into entryPoints above.
    }
    graph.set(file, targets);
  }

  const reached = new Set(entryPoints);
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const next of graph.get(current) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }

  const orphans = files.filter((file) => !reached.has(file)).sort();
  return { orphans, reached: [...reached].sort(), entryPoints: [...entryPoints].sort() };
}
