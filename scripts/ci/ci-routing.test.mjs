import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateFilters, isFullRun, matchesPattern, parseCiPathFilters } from "./ci-routing.mjs";

const repoRoot = new URL("../../", import.meta.url);
const ciPathsSource = readFileSync(new URL(".github/ci-paths.yml", repoRoot), "utf8");
const ciWorkflowSource = readFileSync(new URL(".github/workflows/ci.yml", repoRoot), "utf8");

test("parseCiPathFilters reads the real .github/ci-paths.yml", () => {
  const filters = parseCiPathFilters(ciPathsSource);

  // PIN (T181): this list must name every top-level filter key in
  // .github/ci-paths.yml, kept in sync by hand. If this assertion just
  // failed because you added or renamed a filter there, that file is not
  // enough on its own — add the same name here (alphabetically), in
  // scripts/ci/ci-routing.test.mjs. See T176/P6-W21 (442ada2): a filter
  // added to ci-paths.yml without this update went unnoticed until this
  // test's failure took down every job in ci.yml's `changes` step (line 60,
  // unconditional), which every downstream job depends on via
  // `needs.changes.outputs.*`.
  assert.deepEqual(
    Object.keys(filters).sort(),
    [
      "android",
      "backend",
      "ci",
      "docker",
      "frontend-core",
      "nix",
      "packaging",
      "protocol",
      "routing",
      "web",
      "workspace",
    ],
    "Filter names out of sync: .github/ci-paths.yml defines a filter that is " +
      "missing from (or renamed relative to) the pinned list above, in this " +
      "same file (scripts/ci/ci-routing.test.mjs). Add/rename it in the " +
      "array in this assertion to match ci-paths.yml, then re-run this test.",
  );
  assert.ok(filters.web.includes("apps/web/**"));
  assert.ok(filters.android.includes("apps/android/**"));
  assert.ok(filters.backend.includes("packages/server/**"));
  assert.ok(filters.protocol.includes("packages/protocol/**"));
  assert.ok(filters["frontend-core"].includes("packages/frontend-core/**"));
});

test("matchesPattern handles directory globs and exact files", () => {
  assert.equal(matchesPattern("packages/server/**", "packages/server/src/index.ts"), true);
  assert.equal(matchesPattern("packages/server/**", "packages/server"), true);
  assert.equal(matchesPattern("packages/server/**", "packages/server-utils/index.ts"), false);
  assert.equal(matchesPattern("package.json", "package.json"), true);
  assert.equal(matchesPattern("package.json", "packages/server/package.json"), false);
});

test("a web test-file change routes only to the web filter (T15 area), not android/backend", () => {
  const filters = parseCiPathFilters(ciPathsSource);
  const matched = evaluateFilters(filters, ["apps/web/src/routes/session.test.ts"]);

  assert.equal(matched.web, true);
  assert.equal(matched.android, false);
  assert.equal(matched.backend, false);
  assert.equal(matched["frontend-core"], false);
  assert.equal(matched.protocol, false);
});

test("an android test-file change routes only to the android filter, not web/backend", () => {
  const filters = parseCiPathFilters(ciPathsSource);
  const matched = evaluateFilters(filters, ["apps/android/src/screens/session.test.ts"]);

  assert.equal(matched.android, true);
  assert.equal(matched.web, false);
  assert.equal(matched.backend, false);
  assert.equal(matched["frontend-core"], false);
});

test("a backend (server) test-file change routes only to backend, not web/android/frontend-core", () => {
  const filters = parseCiPathFilters(ciPathsSource);
  const matched = evaluateFilters(filters, ["packages/server/src/server/websocket-server.test.ts"]);

  assert.equal(matched.backend, true);
  assert.equal(matched.web, false);
  assert.equal(matched.android, false);
  assert.equal(matched["frontend-core"], false);
  assert.equal(matched.protocol, false);
});

test("a frontend-core test-file change cascades to web and android (their shared dependency)", () => {
  const filters = parseCiPathFilters(ciPathsSource);
  const matched = evaluateFilters(filters, ["packages/frontend-core/src/timeline/reducer.test.ts"]);

  assert.equal(matched["frontend-core"], true);
  assert.equal(matched.web, true);
  assert.equal(matched.android, true);
  assert.equal(matched.backend, false);
  assert.equal(matched.protocol, false);
});

test("a protocol test-file change cascades to every consumer, not just protocol's own tests (shared-contract rule)", () => {
  const filters = parseCiPathFilters(ciPathsSource);
  const matched = evaluateFilters(filters, ["packages/protocol/src/messages.test.ts"]);

  assert.equal(matched.protocol, true);
  assert.equal(matched.backend, true);
  assert.equal(matched["frontend-core"], true);
  assert.equal(matched.web, true);
  assert.equal(matched.android, true);
});

test("an unrelated docs-only change routes nowhere (all area filters false)", () => {
  const filters = parseCiPathFilters(ciPathsSource);
  const matched = evaluateFilters(filters, ["docs/T02-provenance.md"]);

  for (const key of ["protocol", "backend", "frontend-core", "web", "android", "docker", "nix"]) {
    assert.equal(matched[key], false, `expected ${key} to be false for a docs-only change`);
  }
});

test("isFullRun forces every contract on push/main, merge_group, and dispatch, but not a scoped PR", () => {
  const filters = parseCiPathFilters(ciPathsSource);
  const scoped = evaluateFilters(filters, ["apps/web/src/index.ts"]);

  assert.equal(isFullRun(scoped, "push"), true);
  assert.equal(isFullRun(scoped, "merge_group"), true);
  assert.equal(isFullRun(scoped, "workflow_dispatch"), true);
  assert.equal(isFullRun(scoped, "pull_request"), false);
});

test("isFullRun is forced on a pull_request that edits routing/workspace/ci filter definitions", () => {
  const filters = parseCiPathFilters(ciPathsSource);
  const routingChange = evaluateFilters(filters, [".github/ci-paths.yml"]);
  const workspaceChange = evaluateFilters(filters, ["package.json"]);
  const ciChange = evaluateFilters(filters, [".github/workflows/ci.yml"]);

  assert.equal(isFullRun(routingChange, "pull_request"), true);
  assert.equal(isFullRun(workspaceChange, "pull_request"), true);
  assert.equal(isFullRun(ciChange, "pull_request"), true);
});

test("every named .github/ci-paths.yml filter (besides routing/workspace/ci) gates at least one CI job", () => {
  const filters = parseCiPathFilters(ciPathsSource);
  const gatedContracts = new Set(["routing", "workspace", "ci"]);
  for (const name of Object.keys(filters)) {
    if (gatedContracts.has(name)) continue;
    assert.ok(
      ciWorkflowSource.includes(`needs.changes.outputs.${name}`),
      `expected ci.yml to gate a job on the "${name}" filter`,
    );
  }
});
