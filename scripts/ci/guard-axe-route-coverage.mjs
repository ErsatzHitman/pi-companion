// T44A2 (plan.md §10.5: "Web axe gates pass across every route"). Pure,
// dependency-free check functions; `run-guard-axe-route-coverage.mjs` is
// this module's CLI entry point (wired into CI as the
// `guard-axe-route-coverage` job in `.github/workflows/ci.yml`).
//
// ## What this closes
//
// `apps/web/e2e/accessibility.spec.ts` sweeps every route
// `apps/web/src/routes/route-tree.ts` declares with a real-browser axe
// check. The risk a hand-written route list always carries — this
// repository's single most-repeated defect class, "a check that cannot
// fail" — is that the sweep silently covers fewer routes than the app
// actually serves the moment a new route is added and nobody remembers
// to add its sweep. This guard closes that by deriving the REAL route
// list straight from `route-tree.ts` itself (following its own imports,
// reading each route file's own `path:` literal) rather than trusting
// any hand-typed copy, and comparing it against
// `apps/web/e2e/fixtures/route-coverage-manifest.ts`'s `ROUTE_COVERAGE`
// — the one curated list of "swept" vs. "deliberately exempt, with a
// reason" — in BOTH directions:
//
//   1. every route `route-tree.ts` declares has a `ROUTE_COVERAGE` entry
//      (a route added there with nothing said about it here is exactly
//      the drift this guard exists to catch);
//   2. every `ROUTE_COVERAGE` entry names a route that still exists in
//      `route-tree.ts` (a stale entry — the route was renamed or
//      removed — cannot silently keep "covering" nothing forever); and
//   3. every `swept: false` entry carries a non-empty `reason` (an
//      exemption with no reason is indistinguishable from one nobody
//      thought about).
//
// `apps/web/e2e/accessibility.spec.ts`'s own `SWEEPS` table is checked
// by a SEPARATE, independent mechanism — not this guard: it is typed as
// `Record<SweptRoutePath, RouteSweep>`, where `SweptRoutePath` is a
// union of string-literal types derived FROM `ROUTE_COVERAGE` itself
// (`route-coverage-manifest.ts`'s `as const satisfies`), so
// `npm run typecheck` fails to build the moment that table and this
// manifest disagree about which routes are swept. This guard does not
// re-implement that check (a regex reading of spec test titles would be
// exactly the "satisfied by a comment/decorative literal" failure mode
// this repository's own source-text-assertion catalogue warns against —
// nothing stops a title existing with no real body behind it) — it
// relies on the TypeScript compiler for that half instead, which cannot
// be fooled the same way.
//
// ## Deliberately narrow parsing, not a generic TS/JS parser
//
// This reads exactly three shapes of source text, the same discipline
// `guard-capability-prose.mjs`/`guard-no-legacy-schema-reader.mjs` use
// elsewhere in this directory: a `route-tree.ts` `import { X } from
// "path";` line, its `addChildren([...])` array (an ordered list of
// bare identifiers, blank lines and `//` comments only — no nested
// calls), and each route module's first `path: "..."` string literal.
// A route file that stopped declaring `path:` as a plain string literal
// (e.g. computed at runtime) would silently fall out of the derived
// list — narrower coverage, never a false claim of coverage — see
// `guard-no-legacy-schema-reader.mjs`'s own header for the identical
// "narrow beats a generic interpreter" reasoning applied here.

import { dirname, join } from "node:path";

const ROUTE_TREE_PATH = "apps/web/src/routes/route-tree.ts";
const MANIFEST_PATH = "apps/web/e2e/fixtures/route-coverage-manifest.ts";
const ROUTE_FILE_EXTENSIONS = [".tsx", ".ts"];

/**
 * `import { X } from "PATH";` lines in `route-tree.ts` — a plain named
 * import of exactly one identifier, which is the only shape that file
 * uses. Returns a map of export name -> import specifier (e.g.
 * `"indexRoute" -> "./index.js"`), in no particular order (call order
 * comes from `parseAddChildrenOrder` instead).
 */
export function parseRouteTreeImports(routeTreeSource) {
  const importRe = /import\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*"([^"]+)";/g;
  const imports = new Map();
  let match;
  while ((match = importRe.exec(routeTreeSource)) !== null) {
    imports.set(match[1], match[2]);
  }
  return imports;
}

/**
 * The ordered list of route identifiers inside `rootRoute.addChildren([
 * ... ])`. Comment lines (`// ...`) are stripped before splitting on
 * commas, so a `T25A: dev-only component lab.` style comment beside an
 * entry is never mistaken for part of an identifier.
 */
export function parseAddChildrenOrder(routeTreeSource) {
  const match = routeTreeSource.match(/addChildren\(\[([\s\S]*?)\]\)/);
  if (!match) {
    return [];
  }
  const withoutLineComments = match[1].replace(/\/\/.*$/gm, "");
  return withoutLineComments
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "rootRoute");
}

/**
 * The first `path: "..."` string literal in a route module's source.
 * `component-lab-route.tsx`/`recipe-lab-route.tsx` each declare it
 * TWICE (a dev branch and a production `notFound()` branch) with the
 * identical literal both times, so taking the first occurrence is
 * correct for every route file in this repository today — see this
 * module's header for what happens if that ever stops being true.
 */
export function extractRoutePath(routeFileSource) {
  const match = routeFileSource.match(/path:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Resolves a `route-tree.ts`-relative import specifier (e.g.
 * `"../dev/component-lab-route.js"`) to a real file, trying `.tsx` then
 * `.ts` in place of the specifier's own (always-`.js`, per this
 * codebase's ESM-import convention) extension. `fileExists` and
 * `routeTreeDir` are injected so this stays a pure function under test —
 * see `computeDeclaredRoutes` for the real, `node:fs`-backed caller.
 *
 * The returned path always uses forward slashes. `join` emits `\` on
 * Windows, which made this guard's own violation message quote
 * `apps\web\src\routes\x.tsx` beside a forward-slash manifest path,
 * as if the two lived in different trees (found at the P9-W2 merge gate;
 * CI runs on ubuntu, so only local runs ever saw it). `fileExists` is
 * still called with the platform-native candidate, which is what
 * `node:fs` was handed before this change.
 */
export function resolveRouteFile(routeTreeDir, importPath, fileExists) {
  const withoutExtension = importPath.replace(/\.js$/, "");
  const base = join(routeTreeDir, withoutExtension);
  for (const extension of ROUTE_FILE_EXTENSIONS) {
    const candidate = base + extension;
    if (fileExists(candidate)) {
      return candidate.split("\\").join("/");
    }
  }
  return null;
}

/**
 * Derives the real, ordered route list from `route-tree.ts` and every
 * route module it imports. `deps.readFile(path)` and
 * `deps.fileExists(path)` are the only filesystem seams — both take
 * paths relative to the repository root, matching `git ls-files`'
 * output, which is what every real caller (`run-guard-axe-route-
 * coverage.mjs`) already has on hand.
 *
 * Returns `{ routes, errors }` rather than throwing: a route this
 * function cannot resolve or read a `path:` literal from is reported as
 * an error entry (naming the export and, where known, the file it
 * could not resolve or parse) instead of crashing the whole guard — an
 * unreadable route is exactly the kind of drift this guard exists to
 * surface, not hide behind an exception.
 */
export function computeDeclaredRoutes(deps) {
  const routeTreeSource = deps.readFile(ROUTE_TREE_PATH);
  const imports = parseRouteTreeImports(routeTreeSource);
  const order = parseAddChildrenOrder(routeTreeSource);
  const routeTreeDir = dirname(ROUTE_TREE_PATH);

  const routes = [];
  const errors = [];

  for (const exportName of order) {
    const importPath = imports.get(exportName);
    if (!importPath) {
      errors.push(`"${exportName}" is listed in addChildren([...]) but has no import line`);
      continue;
    }
    const filePath = resolveRouteFile(routeTreeDir, importPath, deps.fileExists);
    if (!filePath) {
      errors.push(
        `"${exportName}" (imported from "${importPath}") does not resolve to a real file`,
      );
      continue;
    }
    const routeFileSource = deps.readFile(filePath);
    const routePath = extractRoutePath(routeFileSource);
    if (!routePath) {
      errors.push(
        `"${exportName}" (${filePath}) has no "path: \\"...\\"" literal this guard can find`,
      );
      continue;
    }
    routes.push({ exportName, filePath, routePath });
  }

  return { routes, errors };
}

/**
 * Scans a `ROUTE_COVERAGE` array literal's source text into individual
 * `{ ... }` object blocks by tracking brace depth — deliberately not a
 * single regex, since a `reason` string can itself contain `{`/`}` in
 * principle and a depth-aware scan is the only shape that stays correct
 * either way. Every entry in this repository's real manifest is a flat
 * object (no nested object literals), which is what this scanner
 * assumes; it is not a general JS parser.
 */
function splitTopLevelObjects(arrayBody) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < arrayBody.length; i += 1) {
    const ch = arrayBody[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        blocks.push(arrayBody.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return blocks;
}

/**
 * Parses `route-coverage-manifest.ts`'s `ROUTE_COVERAGE` array into
 * `{ routePath, swept, reason }` entries. `reason` may be split across
 * several `"..." + "..."` string-literal fragments (this repository's
 * own `oxfmt`-wrapped long strings do this); this joins every quoted
 * fragment between `reason:` and the entry's closing brace, so a
 * wrapped sentence is read as the one string it is meant to be.
 */
export function parseManifestEntries(manifestSource) {
  const match = manifestSource.match(/ROUTE_COVERAGE\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!match) {
    return [];
  }
  const blocks = splitTopLevelObjects(match[1]);
  return blocks.map((block) => {
    const routePathMatch = block.match(/routePath:\s*"([^"]+)"/);
    const sweptMatch = block.match(/swept:\s*(true|false)/);
    const reasonSection = block.match(/reason:\s*([\s\S]*?)(?:,\s*$|$)/);
    let reason;
    if (reasonSection) {
      const fragments = [...reasonSection[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
      reason = fragments.length > 0 ? fragments.join("") : undefined;
    }
    return {
      routePath: routePathMatch ? routePathMatch[1] : null,
      swept: sweptMatch ? sweptMatch[1] === "true" : null,
      reason,
    };
  });
}

/**
 * The full cross-check: real declared routes (from `route-tree.ts`) vs.
 * the curated manifest (`ROUTE_COVERAGE`), in both directions, plus the
 * "every exemption needs a reason" rule. Returns a list of human-
 * readable violation strings — empty means clean.
 */
export function findRouteCoverageViolations({ declaredRoutes, manifestEntries }) {
  const violations = [];

  const declaredPaths = new Set(declaredRoutes.map((r) => r.routePath));
  const manifestPaths = new Set(manifestEntries.map((e) => e.routePath));

  for (const route of declaredRoutes) {
    if (!manifestPaths.has(route.routePath)) {
      violations.push(
        `${route.routePath} (${route.exportName}, ${route.filePath}) is declared in ` +
          `route-tree.ts but has no entry in ${MANIFEST_PATH}'s ROUTE_COVERAGE. Add an entry ` +
          `marking it swept:true (with a real axe check in accessibility.spec.ts) or ` +
          `swept:false with a written reason.`,
      );
    }
  }

  for (const entry of manifestEntries) {
    if (entry.routePath && !declaredPaths.has(entry.routePath)) {
      violations.push(
        `${MANIFEST_PATH}'s ROUTE_COVERAGE names "${entry.routePath}", which no longer exists ` +
          `in route-tree.ts. Remove the stale entry (or its sweep test) so this manifest never ` +
          `claims to cover a route that does not exist.`,
      );
    }
    if (entry.swept === false && (!entry.reason || entry.reason.trim().length === 0)) {
      violations.push(
        `${MANIFEST_PATH}'s "${entry.routePath}" entry is swept:false with no reason. Every ` +
          `exemption must name why, in writing, in this file.`,
      );
    }
  }

  return violations;
}

export { ROUTE_TREE_PATH, MANIFEST_PATH };
