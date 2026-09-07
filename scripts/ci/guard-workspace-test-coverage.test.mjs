import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { extractRunStepContents } from "./guard-run-guard-wiring.mjs";
import {
  ALLOWLISTED_UNTESTED_WORKSPACES,
  findWorkspaceTestCoverageViolations,
  isWorkspaceTestedInWorkflow,
  resolveWorkspacePackages,
} from "./guard-workspace-test-coverage.mjs";

function readRealWorkspaces() {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  return resolveWorkspacePackages({
    workspaceGlobs: manifest.workspaces,
    listDir: (dir) => readdirSync(dir),
    readPackageName: (packageJsonPath) => {
      try {
        const m = JSON.parse(readFileSync(packageJsonPath, "utf8"));
        return typeof m.name === "string" ? m.name : null;
      } catch {
        return null;
      }
    },
  });
}

function readRealWorkflows() {
  const dir = ".github/workflows/";
  return readdirSync(dir)
    .filter((entry) => /\.ya?ml$/.test(entry))
    .map((entry) => ({ path: `${dir}${entry}`, content: readFileSync(`${dir}${entry}`, "utf8") }));
}

// ---------------------------------------------------------------------------
// resolveWorkspacePackages
// ---------------------------------------------------------------------------

test("resolveWorkspacePackages expands a `<dir>/*` glob against a directory listing", () => {
  const packages = resolveWorkspacePackages({
    workspaceGlobs: ["packages/*", "apps/*"],
    listDir: (dir) => {
      if (dir === "packages") return ["foo", "bar", "not-a-package"];
      if (dir === "apps") return ["web"];
      throw new Error(`unexpected dir: ${dir}`);
    },
    readPackageName: (path) => {
      if (path === "packages/foo/package.json") return "@scope/foo";
      if (path === "packages/bar/package.json") return "@scope/bar";
      if (path === "apps/web/package.json") return "@scope/web";
      return null; // "not-a-package" has no package.json / no name
    },
  });
  assert.deepEqual(packages, [
    { name: "@scope/web", dir: "apps/web" },
    { name: "@scope/bar", dir: "packages/bar" },
    { name: "@scope/foo", dir: "packages/foo" },
  ]);
});

test("resolveWorkspacePackages ignores a glob shape it does not understand", () => {
  const packages = resolveWorkspacePackages({
    workspaceGlobs: ["packages/single-package"], // no trailing /*
    listDir: () => {
      throw new Error("listDir should not be called for a non-glob entry");
    },
    readPackageName: () => "@scope/should-not-appear",
  });
  assert.deepEqual(packages, []);
});

test("resolveWorkspacePackages tolerates a glob parent directory that does not exist", () => {
  const packages = resolveWorkspacePackages({
    workspaceGlobs: ["missing/*"],
    listDir: () => {
      throw new Error("ENOENT");
    },
    readPackageName: () => "@scope/x",
  });
  assert.deepEqual(packages, []);
});

// ---------------------------------------------------------------------------
// isWorkspaceTestedInWorkflow
// ---------------------------------------------------------------------------

test("isWorkspaceTestedInWorkflow matches a real `test` invocation", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: npm run test --workspace=@picompanion/relay
`;
  assert.equal(
    isWorkspaceTestedInWorkflow("@picompanion/relay", workflow, extractRunStepContents),
    true,
  );
});

test("isWorkspaceTestedInWorkflow matches a `test:unit` (or other test:*) script", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: npm run test:unit --workspace=@picompanion/cli
`;
  assert.equal(
    isWorkspaceTestedInWorkflow("@picompanion/cli", workflow, extractRunStepContents),
    true,
  );
});

test("isWorkspaceTestedInWorkflow matches inside a multi-line block-scalar run: step", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: |
          npm ci
          npm run test --workspace=@picompanion/relay
`;
  assert.equal(
    isWorkspaceTestedInWorkflow("@picompanion/relay", workflow, extractRunStepContents),
    true,
  );
});

test("isWorkspaceTestedInWorkflow does not match a different workspace's test invocation", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: npm run test --workspace=@picompanion/relay
`;
  assert.equal(
    isWorkspaceTestedInWorkflow("@picompanion/cli", workflow, extractRunStepContents),
    false,
  );
});

test("isWorkspaceTestedInWorkflow does not match a build/typecheck invocation of the same workspace", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: npm run build --workspace=@picompanion/relay
      - run: npm run typecheck --workspace=@picompanion/relay
`;
  assert.equal(
    isWorkspaceTestedInWorkflow("@picompanion/relay", workflow, extractRunStepContents),
    false,
  );
});

test("isWorkspaceTestedInWorkflow — a comment quoting the invocation does not count (five-class catalogue #1)", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: |
          # e.g. npm run test --workspace=@picompanion/relay
          echo "not actually testing anything"
`;
  assert.equal(
    isWorkspaceTestedInWorkflow("@picompanion/relay", workflow, extractRunStepContents),
    false,
  );
});

test("isWorkspaceTestedInWorkflow does not partial-match a workspace name that is a prefix of another", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: npm run test --workspace=@picompanion/relay-extended
`;
  assert.equal(
    isWorkspaceTestedInWorkflow("@picompanion/relay", workflow, extractRunStepContents),
    false,
  );
});

// ---------------------------------------------------------------------------
// findWorkspaceTestCoverageViolations
// ---------------------------------------------------------------------------

test("findWorkspaceTestCoverageViolations reports an untested workspace with no allowlist entry", () => {
  const violations = findWorkspaceTestCoverageViolations({
    workspaces: [
      { name: "@scope/tested", dir: "packages/tested" },
      { name: "@scope/untested", dir: "packages/untested" },
    ],
    workflows: [
      { path: ".github/workflows/ci.yml", content: "run: npm run test --workspace=@scope/tested" },
    ],
    extractRunStepContents,
    allowlist: {},
  });
  assert.deepEqual(violations, [
    { kind: "untested", workspace: "@scope/untested", allowlistReason: null },
  ]);
});

test("findWorkspaceTestCoverageViolations accepts a workspace with a valid allowlist reason", () => {
  const violations = findWorkspaceTestCoverageViolations({
    workspaces: [{ name: "@scope/untested", dir: "packages/untested" }],
    workflows: [{ path: ".github/workflows/ci.yml", content: "run: echo hi" }],
    extractRunStepContents,
    allowlist: { "@scope/untested": "a real, sufficiently long reason for this entry" },
  });
  assert.deepEqual(violations, []);
});

test("findWorkspaceTestCoverageViolations rejects a too-short allowlist reason", () => {
  const violations = findWorkspaceTestCoverageViolations({
    workspaces: [{ name: "@scope/untested", dir: "packages/untested" }],
    workflows: [{ path: ".github/workflows/ci.yml", content: "run: echo hi" }],
    extractRunStepContents,
    allowlist: { "@scope/untested": "too short" },
  });
  assert.deepEqual(violations, [
    { kind: "untested", workspace: "@scope/untested", allowlistReason: "too short" },
  ]);
});

test("findWorkspaceTestCoverageViolations reports stale-missing-workspace for a renamed/removed package", () => {
  const violations = findWorkspaceTestCoverageViolations({
    workspaces: [{ name: "@scope/real", dir: "packages/real" }],
    workflows: [
      { path: ".github/workflows/ci.yml", content: "run: npm run test --workspace=@scope/real" },
    ],
    extractRunStepContents,
    allowlist: { "@scope/gone": "a real, sufficiently long reason for this entry" },
  });
  assert.deepEqual(violations, [
    {
      kind: "stale-missing-workspace",
      workspace: "@scope/gone",
      allowlistReason: "a real, sufficiently long reason for this entry",
    },
  ]);
});

test("findWorkspaceTestCoverageViolations reports stale-tested when a workflow now genuinely tests an allowlisted workspace", () => {
  const violations = findWorkspaceTestCoverageViolations({
    workspaces: [{ name: "@scope/now-tested", dir: "packages/now-tested" }],
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content: "run: npm run test --workspace=@scope/now-tested",
      },
    ],
    extractRunStepContents,
    allowlist: { "@scope/now-tested": "a real, sufficiently long reason for this entry" },
  });
  assert.deepEqual(violations, [
    {
      kind: "stale-tested",
      workspace: "@scope/now-tested",
      allowlistReason: "a real, sufficiently long reason for this entry",
    },
  ]);
});

test("findWorkspaceTestCoverageViolations: a stale-missing-workspace entry is still reported even though the main loop never visits it", () => {
  // Proves the T211/T213-shaped independent walk: the main loop only ever
  // iterates REAL workspaces, so a stale key naming a workspace that does
  // not exist would never be visited by it — the stale check must walk the
  // allowlist's own keys directly.
  const violations = findWorkspaceTestCoverageViolations({
    workspaces: [],
    workflows: [{ path: ".github/workflows/ci.yml", content: "run: echo hi" }],
    extractRunStepContents,
    allowlist: { "@scope/never-existed": "a real, sufficiently long reason for this entry" },
  });
  assert.deepEqual(violations, [
    {
      kind: "stale-missing-workspace",
      workspace: "@scope/never-existed",
      allowlistReason: "a real, sufficiently long reason for this entry",
    },
  ]);
});

// ---------------------------------------------------------------------------
// Real-tree assertions
// ---------------------------------------------------------------------------

test("the real tree has zero workspace-test-coverage violations today", () => {
  const workspaces = readRealWorkspaces();
  const workflows = readRealWorkflows();
  assert.ok(workspaces.length > 0, "expected to resolve at least one real workspace");
  assert.ok(workflows.length > 0, "expected to find at least one real workflow file");

  const violations = findWorkspaceTestCoverageViolations({
    workspaces,
    workflows,
    extractRunStepContents,
  });
  assert.deepEqual(
    violations,
    [],
    `expected zero violations against the real tree, got: ${JSON.stringify(violations, null, 2)}`,
  );
});

test("every ALLOWLISTED_UNTESTED_WORKSPACES entry names a real workspace and a real, non-placeholder reason", () => {
  const workspaceNames = new Set(readRealWorkspaces().map((w) => w.name));
  for (const [workspace, reason] of Object.entries(ALLOWLISTED_UNTESTED_WORKSPACES)) {
    assert.ok(
      workspaceNames.has(workspace),
      `allowlist entry "${workspace}" does not name a real workspace`,
    );
    assert.ok(
      typeof reason === "string" && reason.trim().length >= 20,
      `allowlist entry "${workspace}" has too short a reason: "${reason}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// Proving the guard actually fires — the acceptance criterion's own demand.
// This mutates the REAL data read from disk (in memory only; nothing is
// written to disk here) to prove both violation classes are reachable
// against the real tree, not just synthetic fixtures above.
// ---------------------------------------------------------------------------

test("firing proof: removing @picompanion/relay's real wiring reintroduces an `untested` violation", () => {
  const workspaces = readRealWorkspaces();
  const workflows = readRealWorkflows().map((w) => ({
    ...w,
    // Simulate "the relay-tests job never existed" by scrubbing every
    // real occurrence of a relay test invocation, leaving everything else
    // (including the relay *name* in comments/build steps) untouched.
    content: w.content.replace(
      /npm run test(?::\S+)? (?:--workspace[= ]|-w[= ])@picompanion\/relay(?=\s|$)/g,
      "echo scrubbed-for-test",
    ),
  }));
  const violations = findWorkspaceTestCoverageViolations({
    workspaces,
    workflows,
    extractRunStepContents,
  });
  assert.ok(
    violations.some((v) => v.kind === "untested" && v.workspace === "@picompanion/relay"),
    `expected an "untested" violation for @picompanion/relay once its real wiring is scrubbed, got: ${JSON.stringify(violations)}`,
  );
});

test("firing proof: a stale allowlist entry naming an already-tested real workspace fires stale-tested", () => {
  const workspaces = readRealWorkspaces();
  const workflows = readRealWorkflows();
  const violations = findWorkspaceTestCoverageViolations({
    workspaces,
    workflows,
    extractRunStepContents,
    // Merge onto the REAL allowlist (rather than replacing it) so this only
    // exercises the one entry under test, not a fresh accidental "everything
    // else is untested" result from dropping the real bridge/expo-two-way-
    // audio entries.
    allowlist: {
      ...ALLOWLISTED_UNTESTED_WORKSPACES,
      "@picompanion/relay": "pretend this was still allowlisted after relay-tests was wired",
    },
  });
  assert.deepEqual(violations, [
    {
      kind: "stale-tested",
      workspace: "@picompanion/relay",
      allowlistReason: "pretend this was still allowlisted after relay-tests was wired",
    },
  ]);
});
