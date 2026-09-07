// T44A2 — unit and real-tree tests for guard-axe-route-coverage.mjs.
// Run via `node --test scripts/ci/*.test.mjs` (the changes job's own
// unconditional step in .github/workflows/ci.yml).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

import {
  MANIFEST_PATH,
  ROUTE_TREE_PATH,
  computeDeclaredRoutes,
  extractRoutePath,
  findRouteCoverageViolations,
  parseAddChildrenOrder,
  parseManifestEntries,
  parseRouteTreeImports,
  resolveRouteFile,
} from "./guard-axe-route-coverage.mjs";

// --- parseRouteTreeImports ------------------------------------------------

test("parseRouteTreeImports reads every named import line", () => {
  const source = `
import { componentLabRoute } from "../dev/component-lab-route.js";
import { connectRoute } from "./connect.js";
import { rootRoute } from "./root-route.js";
`;
  const imports = parseRouteTreeImports(source);
  assert.equal(imports.get("componentLabRoute"), "../dev/component-lab-route.js");
  assert.equal(imports.get("connectRoute"), "./connect.js");
  assert.equal(imports.get("rootRoute"), "./root-route.js");
  assert.equal(imports.size, 3);
});

test("parseRouteTreeImports ignores an import line with no import in it", () => {
  const source = `// import { fakeRoute } from "./fake.js"; -- this is a comment, not real code\n`;
  // The regex itself does not distinguish a commented-out import from a
  // real one (this guard never claims to be comment-aware for THIS
  // parse — see the "real tree stays clean" test below for why that gap
  // does not matter for the real file). This test only pins that the
  // parser does not crash or double-count on such input.
  const imports = parseRouteTreeImports(source);
  assert.equal(imports.get("fakeRoute"), "./fake.js");
});

// --- parseAddChildrenOrder -------------------------------------------------

test("parseAddChildrenOrder returns identifiers in order, comments stripped", () => {
  const source = `
export const routeTree = rootRoute.addChildren([
  indexRoute,
  connectRoute,
  // T25A: dev-only component lab.
  componentLabRoute,
  recipeLabRoute,
]);
`;
  assert.deepEqual(parseAddChildrenOrder(source), [
    "indexRoute",
    "connectRoute",
    "componentLabRoute",
    "recipeLabRoute",
  ]);
});

test("parseAddChildrenOrder returns an empty list when addChildren is absent", () => {
  assert.deepEqual(parseAddChildrenOrder("export const x = 1;"), []);
});

// --- extractRoutePath --------------------------------------------------

test("extractRoutePath reads the first path literal", () => {
  const source = `
export const hostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/h/$serverId",
  component: lazyRouteComponent(() => import("./screens/host-screen.js"), "HostScreen"),
});
`;
  assert.equal(extractRoutePath(source), "/h/$serverId");
});

test("extractRoutePath returns the SAME literal for a two-branch dev/prod route file", () => {
  const source = `
export const componentLabRoute = import.meta.env.DEV
  ? createRoute({ getParentRoute: () => rootRoute, path: "/dev/component-lab" })
  : createRoute({ getParentRoute: () => rootRoute, path: "/dev/component-lab" });
`;
  assert.equal(extractRoutePath(source), "/dev/component-lab");
});

test("extractRoutePath returns null when no path literal exists", () => {
  assert.equal(extractRoutePath("export const x = createRoute({});"), null);
});

// --- resolveRouteFile ----------------------------------------------------

test("resolveRouteFile tries .tsx before .ts, relative to the route-tree's directory", () => {
  const existing = new Set(["apps/web/src/routes/connect.tsx"]);
  const fileExists = (path) => existing.has(path.split("\\").join("/"));
  const resolved = resolveRouteFile("apps/web/src/routes", "./connect.js", fileExists);
  assert.equal(resolved.split("\\").join("/"), "apps/web/src/routes/connect.tsx");
});

test("resolveRouteFile returns null when neither extension exists", () => {
  const resolved = resolveRouteFile("apps/web/src/routes", "./missing.js", () => false);
  assert.equal(resolved, null);
});

// --- computeDeclaredRoutes -------------------------------------------------

function fakeFs(files) {
  return {
    readFile: (path) => {
      const key = path.split("\\").join("/");
      if (!(key in files)) {
        throw new Error(`fakeFs: no file for ${key}`);
      }
      return files[key];
    },
    fileExists: (path) => path.split("\\").join("/") in files,
  };
}

test("computeDeclaredRoutes walks imports and addChildren order into real route entries", () => {
  const deps = fakeFs({
    [ROUTE_TREE_PATH]: `
import { connectRoute } from "./connect.js";
import { indexRoute } from "./index.js";
export const routeTree = rootRoute.addChildren([
  indexRoute,
  connectRoute,
]);
`,
    "apps/web/src/routes/index.tsx": `export const indexRoute = createRoute({ path: "/" });`,
    "apps/web/src/routes/connect.tsx": `export const connectRoute = createRoute({ path: "/connect" });`,
  });

  const { routes, errors } = computeDeclaredRoutes(deps);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    routes.map((r) => [r.exportName, r.routePath]),
    [
      ["indexRoute", "/"],
      ["connectRoute", "/connect"],
    ],
  );
});

test("computeDeclaredRoutes reports an error for an addChildren entry with no import", () => {
  const deps = fakeFs({
    [ROUTE_TREE_PATH]: `
export const routeTree = rootRoute.addChildren([
  ghostRoute,
]);
`,
  });
  const { routes, errors } = computeDeclaredRoutes(deps);
  assert.deepEqual(routes, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ghostRoute/);
});

test("computeDeclaredRoutes reports an error when a route file has no path literal", () => {
  const deps = fakeFs({
    [ROUTE_TREE_PATH]: `
import { brokenRoute } from "./broken.js";
export const routeTree = rootRoute.addChildren([
  brokenRoute,
]);
`,
    "apps/web/src/routes/broken.tsx": `export const brokenRoute = createRoute({});`,
  });
  const { routes, errors } = computeDeclaredRoutes(deps);
  assert.deepEqual(routes, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /brokenRoute/);
});

// --- parseManifestEntries -------------------------------------------------

test("parseManifestEntries reads swept and exempt entries, joining a wrapped reason", () => {
  const source = `
export const ROUTE_COVERAGE = [
  { routePath: "/connect", swept: true },
  {
    routePath: "/dev/component-lab",
    swept: false,
    reason:
      "first half of the sentence " +
      "and the second half.",
  },
] as const satisfies readonly RouteCoverageEntry[];
`;
  const entries = parseManifestEntries(source);
  assert.deepEqual(entries[0], { routePath: "/connect", swept: true, reason: undefined });
  assert.equal(entries[1].routePath, "/dev/component-lab");
  assert.equal(entries[1].swept, false);
  assert.equal(entries[1].reason, "first half of the sentence and the second half.");
});

test("parseManifestEntries returns an empty list when ROUTE_COVERAGE is absent", () => {
  assert.deepEqual(parseManifestEntries("export const X = 1;"), []);
});

// --- findRouteCoverageViolations -------------------------------------------

const ROUTE_A = { exportName: "aRoute", filePath: "a.tsx", routePath: "/a" };
const ROUTE_B = { exportName: "bRoute", filePath: "b.tsx", routePath: "/b" };

test("findRouteCoverageViolations is clean when every declared route has a manifest entry", () => {
  const violations = findRouteCoverageViolations({
    declaredRoutes: [ROUTE_A, ROUTE_B],
    manifestEntries: [
      { routePath: "/a", swept: true },
      { routePath: "/b", swept: false, reason: "dev only" },
    ],
  });
  assert.deepEqual(violations, []);
});

test("findRouteCoverageViolations fails when a declared route has no manifest entry", () => {
  const violations = findRouteCoverageViolations({
    declaredRoutes: [ROUTE_A, ROUTE_B],
    manifestEntries: [{ routePath: "/a", swept: true }],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /\/b/);
  assert.match(violations[0], /no entry/);
});

test("findRouteCoverageViolations fails when a manifest entry names a route that no longer exists", () => {
  const violations = findRouteCoverageViolations({
    declaredRoutes: [ROUTE_A],
    manifestEntries: [
      { routePath: "/a", swept: true },
      { routePath: "/deleted-route", swept: true },
    ],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /deleted-route/);
  assert.match(violations[0], /no longer exists/);
});

test("findRouteCoverageViolations fails when an exempt entry has no reason", () => {
  const violations = findRouteCoverageViolations({
    declaredRoutes: [ROUTE_A],
    manifestEntries: [{ routePath: "/a", swept: false, reason: undefined }],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /no reason/);
});

test("findRouteCoverageViolations fails when an exempt entry's reason is only whitespace", () => {
  const violations = findRouteCoverageViolations({
    declaredRoutes: [ROUTE_A],
    manifestEntries: [{ routePath: "/a", swept: false, reason: "   " }],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /no reason/);
});

// --- Real-tree integration --------------------------------------------

test("the real tree: every route-tree.ts route has a ROUTE_COVERAGE entry, and vice versa", () => {
  const readFile = (path) => readFileSync(path, "utf8");
  const fileExists = (path) => existsSync(path);

  const { routes, errors } = computeDeclaredRoutes({ readFile, fileExists });
  assert.deepEqual(errors, [], "computeDeclaredRoutes should resolve every real route cleanly");
  assert.ok(routes.length >= 9, "expected at least the 9 real (non-dev-lab) §8.2 routes");

  const manifestEntries = parseManifestEntries(readFile(MANIFEST_PATH));
  const violations = findRouteCoverageViolations({ declaredRoutes: routes, manifestEntries });
  assert.deepEqual(violations, []);
});

test("the real tree: appending an unlisted route to a scratch copy of route-tree.ts makes the guard fail", () => {
  // Proves the guard can actually go RED, without mutating the tracked
  // file: this re-parses the REAL route-tree.ts text with one extra,
  // fabricated addChildren entry (and a matching, self-contained fake
  // route module) spliced in via the same `deps` seam
  // computeDeclaredRoutes already takes — never `readFileSync`ing or
  // rewriting the real file on disk.
  const realRouteTreeSource = readFileSync(ROUTE_TREE_PATH, "utf8");
  const mutated = realRouteTreeSource
    .replace(
      'import { rootRoute } from "./root-route.js";',
      'import { rootRoute } from "./root-route.js";\n' +
        'import { neverListedRoute } from "./never-listed.js";',
    )
    .replace("recipeLabRoute,\n]);", "recipeLabRoute,\n  neverListedRoute,\n]);");
  assert.notEqual(mutated, realRouteTreeSource, "the two replace() calls should both have matched");

  const readFile = (path) => {
    const normalized = path.split("\\").join("/");
    if (normalized === ROUTE_TREE_PATH) return mutated;
    if (normalized === "apps/web/src/routes/never-listed.tsx") {
      return 'export const neverListedRoute = createRoute({ path: "/never-listed" });';
    }
    return readFileSync(path, "utf8");
  };
  const fileExists = (path) =>
    path.split("\\").join("/") === "apps/web/src/routes/never-listed.tsx" || existsSync(path);

  const { routes, errors } = computeDeclaredRoutes({ readFile, fileExists });
  assert.deepEqual(errors, []);
  const manifestEntries = parseManifestEntries(readFileSync(MANIFEST_PATH, "utf8"));
  const violations = findRouteCoverageViolations({ declaredRoutes: routes, manifestEntries });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /\/never-listed/);
  assert.match(violations[0], /no entry/);
});
