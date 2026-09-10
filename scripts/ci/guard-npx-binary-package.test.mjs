import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  collectLockfileBins,
  collectManifestNpxInvocations,
  collectWorkflowNpxInvocations,
  EXTERNAL_NPX_PACKAGES,
  extractNpxTargets,
  findNpxBinaryPackageViolations,
  isValidExternalNpxReason,
  selectManifestFiles,
  selectWorkflowFiles,
} from "./guard-npx-binary-package.mjs";

const LOCKED = new Set(["tsc", "vitest", "expo", "tsx", "playwright", "oxfmt"]);

/** @param {string} content */
const workflow = (content) => [{ path: ".github/workflows/w.yml", content }];

test("extractNpxTargets reads the resolved name past npx's own flags", () => {
  assert.deepEqual(extractNpxTargets("npx eas-cli build --platform android"), ["eas-cli"]);
  assert.deepEqual(extractNpxTargets("npx --yes lockfile-lint --path x"), ["lockfile-lint"]);
  assert.deepEqual(extractNpxTargets("npx -y --package=a tsc -p x"), ["tsc"]);
  assert.deepEqual(extractNpxTargets('out="$(npx eas-cli build)"'), ["eas-cli"]);
  assert.deepEqual(extractNpxTargets("a && npx tsx x.ts; npx vitest run"), ["tsx", "vitest"]);
});

test("extractNpxTargets does not match npx inside a longer word", () => {
  assert.deepEqual(extractNpxTargets("my-npx eas-cli"), []);
  assert.deepEqual(extractNpxTargets("npxfoo bar"), []);
});

test("a workflow COMMENT naming npx eas is not an invocation", () => {
  // The exact trap this guard sets for itself: both real `npx eas-cli` steps
  // in this repository sit under comment blocks that spell out `npx eas` to
  // explain the bug. A raw-text matcher would report the explanation.
  const invocations = collectWorkflowNpxInvocations(
    workflow(
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - run: |",
        "          # T310: `npx eas-cli`, never `npx eas`.",
        "          npx eas-cli build",
      ].join("\n"),
    ),
  );

  assert.deepEqual(
    invocations.map((invocation) => invocation.target),
    ["eas-cli"],
  );
});

test("a YAML comment OUTSIDE any run: step is not an invocation either", () => {
  assert.deepEqual(
    collectWorkflowNpxInvocations(
      workflow(["# npx eas build --platform android", "jobs: {}"].join("\n")),
    ),
    [],
  );
});

test("the T310 shape is reported as a binary, with the package to write instead", () => {
  const violations = findNpxBinaryPackageViolations({
    invocations: [{ target: "eas", source: ".github/workflows/w.yml" }, ...allRegistered()],
    lockfileBins: LOCKED,
  });

  const binaryViolation = violations.find((violation) => violation.kind === "binary-not-package");
  assert.ok(binaryViolation, "expected a binary-not-package violation");
  assert.equal(binaryViolation.target, "eas");
  assert.equal(binaryViolation.suggestion, "eas-cli");
});

test("an unknown name is reported as unresolvable, not silently allowed", () => {
  const violations = findNpxBinaryPackageViolations({
    invocations: [{ target: "some-tool", source: "package.json scripts.x" }, ...allRegistered()],
    lockfileBins: LOCKED,
  });

  assert.deepEqual(
    violations.map((violation) => [violation.kind, violation.target]),
    [["unresolvable", "some-tool"]],
  );
});

test("a locked binary and a registered package both pass", () => {
  assert.deepEqual(
    findNpxBinaryPackageViolations({
      invocations: [{ target: "tsc", source: "w" }, ...allRegistered()],
      lockfileBins: LOCKED,
    }),
    [],
  );
});

test("a registered package nothing invokes is a stale entry", () => {
  // The T211 lesson from guard-run-guard-wiring.mjs: the registry is walked
  // over its OWN keys, so an entry the invocation loop never reaches is still
  // checked rather than sitting here unfalsifiable forever.
  const violations = findNpxBinaryPackageViolations({
    invocations: [{ target: "tsc", source: "w" }],
    lockfileBins: LOCKED,
    external: { "some-cli": { binary: "some", reason: "x".repeat(40) } },
  });

  assert.deepEqual(
    violations.map((violation) => [violation.kind, violation.target]),
    [["stale-uninvoked", "some-cli"]],
  );
});

test("a registered package the lockfile now ships is a stale entry", () => {
  const violations = findNpxBinaryPackageViolations({
    invocations: [{ target: "vitest", source: "w" }],
    lockfileBins: LOCKED,
    external: { vitest: { binary: "vitest", reason: "x".repeat(40) } },
  });

  assert.deepEqual(
    violations.map((violation) => [violation.kind, violation.target]),
    [["stale-locally-installed", "vitest"]],
  );
});

test("a placeholder reason does not buy an exemption", () => {
  const violations = findNpxBinaryPackageViolations({
    invocations: [{ target: "some-cli", source: "w" }],
    lockfileBins: LOCKED,
    external: { "some-cli": { binary: "some", reason: "TODO" } },
  });

  assert.deepEqual(
    violations.map((violation) => violation.kind),
    ["placeholder-reason"],
  );
  assert.equal(isValidExternalNpxReason("TODO"), false);
  assert.equal(isValidExternalNpxReason("x".repeat(40)), true);
});

test("collectLockfileBins reads the real lockfile's own bin maps", () => {
  const bins = collectLockfileBins(JSON.parse(readFileSync("package-lock.json", "utf8")));

  assert.ok(bins.has("tsc"), "typescript ships the tsc binary");
  assert.ok(bins.has("vitest"));
  // The whole point: `eas` is NOT installable from this lockfile, which is
  // why `npx eas` could never have resolved locally.
  assert.equal(bins.has("eas"), false);
  assert.equal(bins.has("eas-cli"), false);
});

test("selectors pick workflows and manifests, and nothing else", () => {
  const paths = [
    ".github/workflows/ci.yml",
    ".github/workflows/android-maestro-e2e.yml",
    ".github/dependabot.yml",
    "package.json",
    "apps/android/package.json",
    "apps/android/app.json",
    "docs/ci.yml",
  ];

  assert.deepEqual(selectWorkflowFiles(paths), [
    ".github/workflows/ci.yml",
    ".github/workflows/android-maestro-e2e.yml",
  ]);
  assert.deepEqual(selectManifestFiles(paths), ["package.json", "apps/android/package.json"]);
});

test("the real tree: every npx invocation resolves, and there are some to check", () => {
  const { invocations, lockfileBins } = realTree();

  assert.ok(invocations.length > 0, "expected real npx invocations to check");
  assert.ok(
    invocations.some((invocation) => invocation.target === "eas-cli"),
    "the EAS invocation this guard exists for must be among what it scans",
  );
  assert.deepEqual(findNpxBinaryPackageViolations({ invocations, lockfileBins }), []);
});

test("MUTATION PROOF: rewriting the real eas-cli step to `npx eas` turns the real tree red", () => {
  // T330: android-maestro-e2e.yml no longer runs eas-cli at all (both of its
  // APKs are assembled on the runner), so the proof anchors on the release
  // workflow, which still does.
  const path = ".github/workflows/android-apk-release.yml";
  const real = readFileSync(path, "utf8");
  const mutated = real.replace("npx eas-cli build", "npx eas build");
  assert.notEqual(mutated, real, "the mutation must actually change the file");

  const { lockfileBins } = realTree();
  const violations = findNpxBinaryPackageViolations({
    invocations: collectWorkflowNpxInvocations([{ path, content: mutated }]),
    lockfileBins,
    external: EXTERNAL_NPX_PACKAGES,
  });

  assert.ok(
    violations.some(
      (violation) => violation.kind === "binary-not-package" && violation.suggestion === "eas-cli",
    ),
    "the mutated workflow must be reported as a binary/package confusion",
  );
});

/** Every registered package, so a fixture exercising one violation does not
 * also trip the stale-entry walk for the others. */
function allRegistered() {
  return Object.keys(EXTERNAL_NPX_PACKAGES).map((target) => ({ target, source: "fixture" }));
}

function realTree() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const read = (paths) => paths.map((path) => ({ path, content: readFileSync(path, "utf8") }));
  return {
    invocations: [
      ...collectWorkflowNpxInvocations(read(selectWorkflowFiles(tracked))),
      ...collectManifestNpxInvocations(read(selectManifestFiles(tracked))),
    ],
    lockfileBins: collectLockfileBins(JSON.parse(readFileSync("package-lock.json", "utf8"))),
  };
}
