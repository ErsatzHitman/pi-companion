import assert from "node:assert/strict";
import test from "node:test";
import {
  findDirtyWorkingTreeEntries,
  isWorkingTreeClean,
  parsePorcelainLine,
} from "./guard-clean-working-tree.mjs";

test("an empty porcelain output is clean", () => {
  assert.deepEqual(findDirtyWorkingTreeEntries(""), []);
  assert.equal(isWorkingTreeClean(""), true);
});

test("porcelain output that is only a trailing newline is clean", () => {
  assert.deepEqual(findDirtyWorkingTreeEntries("\n"), []);
  assert.equal(isWorkingTreeClean("\n"), true);
});

test("flags a single modified tracked file, naming it", () => {
  const output = " M apps/android/src/app-shell/core.ts\n";

  const entries = findDirtyWorkingTreeEntries(output);

  assert.deepEqual(entries, [
    {
      status: " M",
      path: "apps/android/src/app-shell/core.ts",
      raw: " M apps/android/src/app-shell/core.ts",
    },
  ]);
  assert.equal(isWorkingTreeClean(output), false);
});

test("flags a staged-but-uncommitted file", () => {
  const output = "M  apps/android/src/app-shell/core.ts\n";

  const entries = findDirtyWorkingTreeEntries(output);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "M ");
  assert.equal(entries[0].path, "apps/android/src/app-shell/core.ts");
});

test("flags an untracked file", () => {
  const output = "?? apps/android/src/features/connect/new-file.ts\n";

  const entries = findDirtyWorkingTreeEntries(output);

  assert.deepEqual(entries, [
    {
      status: "??",
      path: "apps/android/src/features/connect/new-file.ts",
      raw: "?? apps/android/src/features/connect/new-file.ts",
    },
  ]);
});

test("resolves a rename to its NEW path, not the old one", () => {
  const output = "R  old/path.ts -> new/path.ts\n";

  const entries = findDirtyWorkingTreeEntries(output);

  assert.equal(entries[0].path, "new/path.ts");
});

test("flags every dirty file, not just the first, and preserves order", () => {
  const output = [
    " M packages/server/src/server/agent/providers/pi/rpc-types.ts",
    "?? packages/server/src/server/agent/providers/pi/rpc-types.pi-mirror.contract.test.ts",
    " M apps/android/src/ui/primitives/Chip.tsx",
  ].join("\n");

  const entries = findDirtyWorkingTreeEntries(output);

  assert.deepEqual(
    entries.map((e) => e.path),
    [
      "packages/server/src/server/agent/providers/pi/rpc-types.ts",
      "packages/server/src/server/agent/providers/pi/rpc-types.pi-mirror.contract.test.ts",
      "apps/android/src/ui/primitives/Chip.tsx",
    ],
  );
});

test("strips a trailing \\r (Windows git / CRLF-configured checkouts)", () => {
  const output = " M apps/android/src/app-shell/core.ts\r\n";

  const entries = findDirtyWorkingTreeEntries(output);

  assert.equal(entries[0].raw.endsWith("\r"), false);
  assert.equal(entries[0].path, "apps/android/src/app-shell/core.ts");
});

test("parsePorcelainLine handles a plain modified entry", () => {
  assert.deepEqual(parsePorcelainLine(" M a/b.ts"), {
    status: " M",
    path: "a/b.ts",
    raw: " M a/b.ts",
  });
});

// --- The real P5-W22/P5-W23 incidents this guard exists to have caught ---

test("does NOT flag anything by itself on a clean tree with no synthetic dirt (sanity check mirroring a real clean `git status --porcelain`)", () => {
  // A verifier who has just committed everything sees exactly this: no
  // output at all.
  assert.equal(isWorkingTreeClean(""), true);
});

test(
  "flags the real P5-W23 case: f4446ff with ae7c09d's two-file fix re-applied but " +
    "UNCOMMITTED — the exact tree state whose 2141-passed report concealed that `main` " +
    "was red at f4446ff",
  () => {
    // Captured by hand from a real reproduction (T93's own report has the
    // exact commands): `git worktree add --detach <scratch> f4446ff`, then
    // `git diff f4446ff ae7c09d -- \
    //   apps/android/e2e/flows/files-and-terminal.contract.test.ts \
    //   apps/android/maestro/files-and-terminal.yaml | git apply` (no
    // commit), then `git status --porcelain --untracked-files=all` inside
    // that worktree. This is byte-identical to that real output.
    const realF4446ffWithOrphanedAe7c09dFixPorcelain =
      " M apps/android/e2e/flows/files-and-terminal.contract.test.ts\n" +
      " M apps/android/maestro/files-and-terminal.yaml\n";

    const entries = findDirtyWorkingTreeEntries(realF4446ffWithOrphanedAe7c09dFixPorcelain);

    assert.equal(isWorkingTreeClean(realF4446ffWithOrphanedAe7c09dFixPorcelain), false);
    assert.deepEqual(
      entries.map((e) => e.path),
      [
        "apps/android/e2e/flows/files-and-terminal.contract.test.ts",
        "apps/android/maestro/files-and-terminal.yaml",
      ],
    );
    // The exact two files the P5-W23 merge-gate commit (ae7c09d) later
    // committed on top of f4446ff to make main actually green — proving
    // this guard would have failed the wave BEFORE any test ever ran,
    // rather than letting a `2141 passed` report stand in for `main`'s
    // real (red) state.
    assert.equal(entries.length, 2);
  },
);

test(
  "does not flag f4446ff itself once ae7c09d's fix is properly committed on top " +
    "(true negative: a clean tree after the real fix lands is not reported dirty)",
  () => {
    // Once `ae7c09d` is committed (as it now is, on `main`), the working
    // tree that results from checking it out fresh is clean — `git status
    // --porcelain` on an unmodified checkout of a commit is always empty by
    // definition. This is the state the guard must NOT fail on.
    assert.equal(isWorkingTreeClean(""), true);
  },
);

// --- What this guard deliberately does not see ---
//
// `.gitignore`-covered scratch output (node_modules/, dist/, .tmp/,
// *.log, *.tsbuildinfo, test-results/, playwright-report/, blob-report/,
// apps/android/.expo/, apps/android/android/, apps/android/ios/,
// .metro-health-check*, .pi/) never reaches this function at all: `git
// status --porcelain` (without `--ignored`, which run-guard-clean-
// working-tree.mjs never passes) does not print ignored paths, so there is
// nothing here to unit-test against ignored-path INPUT — the exclusion is
// enforced by never generating that input, not by a filter in this module.
// The CLI's own header comment records exactly which patterns that is and
// why; a change to .gitignore's scratch patterns needs no change here.
test("a real .gitignore-excluded scratch file never appears in porcelain input, so an empty scan is clean even though scratch output exists on disk", () => {
  // Nothing to assert against `findDirtyWorkingTreeEntries` for an ignored
  // path — by construction it is never in the string this function
  // receives. This test documents that fact rather than asserting new
  // behavior of this module.
  assert.equal(isWorkingTreeClean(""), true);
});
