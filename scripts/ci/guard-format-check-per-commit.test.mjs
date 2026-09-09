// T137/T148/T150: unit tests for guard-format-check-per-commit.mjs's pure
// functions. No real `git` or oxfmt invocation here -- see the task's
// report for the manual proof against the real repository
// (`68f899f..d89058c`, the real `4a23d89`/`9b01176` P6-W10 case;
// `cedf76a..cd1106e` and `17a54a0..cedf76a`, the real P6-W13
// introduced-vs-inherited case; a clean range; and a synthetic four-commit
// `C1..C4` chain built with real git plumbing against the real repository,
// reproducing the P6-W14 merge gate's table exactly -- green->red fails,
// an unrelated edit to the already-red file is a NOTE, and a SECOND new
// break added to that same already-red file now fails too).
//
// T303: one section below IS a real-`git`-invoking exception to the
// paragraph above. The defect it covers (`tryLoadBlobAtCommit`'s bracketed-
// path parent-existence false positive) lives in `run-guard-format-check-
// per-commit.mjs` itself -- the CLI wrapper that shells out to `git` -- not
// in this file's pure module, because the existence check inherently has to
// ask a real `git` process a real question about a real, ambiguous path
// string; a synthetic fixture cannot reproduce a quirk of git's own
// argument-parsing fallback. That import is read-only (`git cat-file -e`,
// `git show`, `git log -1 --format=%H --`) against this repository's own,
// already-committed history -- never a write, never a mutation, and never
// the whole-history default `run-guard-format-check-per-commit.mjs` warns
// against elsewhere (see this task's report for why the `Owns:` line naming
// only this file's own module was corrected to include that CLI wrapper).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyFormatRedCommits,
  countDiffHunks,
  isBinaryNumstatRecord,
  parseNumstatRecords,
  pathWasWorsened,
  relativizeOxfmtListDifferentOutput,
} from "./guard-format-check-per-commit.mjs";
import { tryLoadBlobAtCommit } from "./run-guard-format-check-per-commit.mjs";

test("parseNumstatRecords parses NUL-terminated numstat records", () => {
  const raw =
    "139\t0\tapps/android/src/app-shell/session-route-daemon-clients.test.ts\0" +
    "6\t2\tapps/android/src/app/h/[serverId]/session/[agentId]/index.tsx\0";
  assert.deepEqual(parseNumstatRecords(raw), [
    {
      adds: "139",
      dels: "0",
      path: "apps/android/src/app-shell/session-route-daemon-clients.test.ts",
    },
    { adds: "6", dels: "2", path: "apps/android/src/app/h/[serverId]/session/[agentId]/index.tsx" },
  ]);
});

test("parseNumstatRecords ignores empty records (trailing NUL, blank output)", () => {
  assert.deepEqual(parseNumstatRecords(""), []);
  assert.deepEqual(parseNumstatRecords("\0\0"), []);
  assert.deepEqual(parseNumstatRecords("3\t1\tfoo.ts\0"), [
    { adds: "3", dels: "1", path: "foo.ts" },
  ]);
});

test("parseNumstatRecords keeps a path containing a literal tab out of the adds/dels split (path is everything after the second tab)", () => {
  const raw = "1\t1\tsome/odd\tpath.ts\0";
  assert.deepEqual(parseNumstatRecords(raw), [{ adds: "1", dels: "1", path: "some/odd\tpath.ts" }]);
});

test("isBinaryNumstatRecord is true only when both counts are the binary marker", () => {
  assert.equal(isBinaryNumstatRecord({ adds: "-", dels: "-" }), true);
  assert.equal(isBinaryNumstatRecord({ adds: "0", dels: "0" }), false);
  assert.equal(isBinaryNumstatRecord({ adds: "-", dels: "0" }), false);
  assert.equal(isBinaryNumstatRecord({ adds: "0", dels: "-" }), false);
});

test("relativizeOxfmtListDifferentOutput strips the temp root and normalizes separators", () => {
  const raw =
    "C:/Users/aksha/AppData/Local/Temp/t137test/apps/android/src/ui/theme/fonts.test.ts\n";
  const rel = relativizeOxfmtListDifferentOutput(
    raw,
    "C:\\Users\\aksha\\AppData\\Local\\Temp\\t137test",
  );
  assert.deepEqual(rel, ["apps/android/src/ui/theme/fonts.test.ts"]);
});

test("relativizeOxfmtListDifferentOutput handles multiple lines and blank output", () => {
  assert.deepEqual(relativizeOxfmtListDifferentOutput("", "/tmp/x"), []);
  const raw = "/tmp/x/a.ts\n/tmp/x/nested/b.tsx\n";
  assert.deepEqual(relativizeOxfmtListDifferentOutput(raw, "/tmp/x"), ["a.ts", "nested/b.tsx"]);
});

test("relativizeOxfmtListDifferentOutput leaves a line untouched if it does not start with the root (defensive -- should not happen in practice)", () => {
  assert.deepEqual(relativizeOxfmtListDifferentOutput("/elsewhere/a.ts\n", "/tmp/x"), [
    "/elsewhere/a.ts",
  ]);
});

test("classifyFormatRedCommits: real P6-W10 shape -- a middle commit INTRODUCES the break, the tip is green, both must be visible per-commit", () => {
  // Synthetic reproduction of the exact 68f899f..d89058c defect: 4a23d89
  // (T130) leaves fonts.test.ts format-red for the first time (its parent,
  // eae739b, had it clean -- redAtParent: false); 9b01176 (T132) reformats
  // the same file back to green in passing, without saying so. A tip-only
  // check only ever evaluates the LAST state (d89058c's), which is green,
  // and would report nothing wrong with this range at all.
  const commits = [
    { sha: "9a5b926", message: "T133: ...", redPaths: [] },
    { sha: "eae739b", message: "T134: ...", redPaths: [] },
    {
      sha: "4a23d89",
      message: "T130: strip comments before matching source text in four raw-readFileSync tests",
      redPaths: [
        {
          path: "apps/android/src/ui/theme/fonts.test.ts",
          redAtParent: false,
          parentSha: "eae739b",
        },
      ],
    },
    {
      sha: "9b01176",
      message:
        "T132: wire queueModeClient/turnStatusClient into the Android production Composer mount",
      redPaths: [],
    },
    { sha: "f1e1b49", message: "T131: ...", redPaths: [] },
    { sha: "d89058c", message: "P6-W10: merge-gate fixes ...", redPaths: [] },
  ];

  const { introduced, inherited } = classifyFormatRedCommits(commits);

  assert.deepEqual(introduced, [
    {
      sha: "4a23d89",
      message: "T130: strip comments before matching source text in four raw-readFileSync tests",
      paths: ["apps/android/src/ui/theme/fonts.test.ts"],
    },
  ]);
  assert.deepEqual(inherited, []);
  // The tip commit is not flagged even though it is last in the list --
  // this is the assertion a tip-only `format:check` run could never make
  // wrong in the first place (it never looks at the middle commit at all).
  assert.ok(!introduced.some((v) => v.sha === "d89058c"));
});

test("classifyFormatRedCommits: real P6-W13 shape -- an inherited break is a NOTE, not an offender, until a commit actually reintroduces it", () => {
  // Synthetic reproduction of the exact cedf76a..cd1106e defect this task
  // (T148) exists to fix, using the real shas and the real per-commit
  // red/clean states measured against the real repository (see this
  // task's report): cedf76a introduces the break (its parent 7fb0c26 was
  // clean); 16d73eb and 20062c3 each carry it forward untouched-by-them
  // (each one's own parent was ALSO red); e5c48a2 repairs it; 33232cc
  // REintroduces it (its parent e5c48a2 was clean -- this is the
  // must-still-be-named case, proving this is a real green->red check and
  // not merely "skip the first offender in a chain"); f577236 repairs it
  // again; cd1106e is untouched.
  const commits = [
    {
      sha: "cedf76a",
      message: "docs: record the P6-W12 outcome and file the two items its gate found",
      redPaths: [{ path: "docs/issues-from-plan.md", redAtParent: false, parentSha: "7fb0c26" }],
    },
    {
      sha: "16d73eb",
      message: "T146: render T143's carried compaction fields on web, delete the false copy",
      redPaths: [{ path: "docs/issues-from-plan.md", redAtParent: true, parentSha: "cedf76a" }],
    },
    {
      sha: "20062c3",
      message: "T99: fail the Pi-mirror contract test loudly on CI, close get_entries' since drift",
      redPaths: [{ path: "docs/issues-from-plan.md", redAtParent: true, parentSha: "16d73eb" }],
    },
    { sha: "e5c48a2", message: "T147: ...", redPaths: [] },
    {
      sha: "33232cc",
      message: "fix: revert accidental docs/issues-from-plan.md hunk from e5c48a2",
      redPaths: [{ path: "docs/issues-from-plan.md", redAtParent: false, parentSha: "e5c48a2" }],
    },
    { sha: "f577236", message: "fix: re-apply the correct oxfmt formatting ...", redPaths: [] },
    { sha: "cd1106e", message: "T100: ...", redPaths: [] },
  ];

  const { introduced, inherited } = classifyFormatRedCommits(commits);

  // This is the entire point of the task: 20062c3 (an unrelated edit to an
  // already-red file) must NOT be an offender, and 33232cc (which put the
  // break back after e5c48a2 cleared it) STILL must be.
  assert.deepEqual(introduced, [
    {
      sha: "cedf76a",
      message: "docs: record the P6-W12 outcome and file the two items its gate found",
      paths: ["docs/issues-from-plan.md"],
    },
    {
      sha: "33232cc",
      message: "fix: revert accidental docs/issues-from-plan.md hunk from e5c48a2",
      paths: ["docs/issues-from-plan.md"],
    },
  ]);
  assert.ok(!introduced.some((v) => v.sha === "20062c3"));

  assert.deepEqual(inherited, [
    {
      sha: "16d73eb",
      message: "T146: render T143's carried compaction fields on web, delete the false copy",
      path: "docs/issues-from-plan.md",
      parentSha: "cedf76a",
    },
    {
      sha: "20062c3",
      message: "T99: fail the Pi-mirror contract test loudly on CI, close get_entries' since drift",
      path: "docs/issues-from-plan.md",
      parentSha: "16d73eb",
    },
  ]);
});

// P9-T merge gate: pin the design intent the runner's failure advice used to
// contradict. That advice offered "or land a follow-up commit that reformats
// the named files and says so in its message" as an alternative remedy. No
// such mechanism has ever existed here -- `classifyFormatRedCommits` reads
// only each commit and its own parent, never any later commit and never any
// commit message -- and T137's acceptance criterion is explicitly the
// opposite: "A committed check fails when any commit in a range is
// format-red, even if the tip is green", against `4a23d89`, an incident where
// a later commit in the same range DID repair the file. Without this test the
// runner's prose was the only statement of the behaviour, and it was wrong;
// with it, re-adding the hatch fails a test instead of quietly weakening the
// guard.
test("classifyFormatRedCommits: a later commit that reformats the named path, and says so, does NOT clear the commit that introduced the break", () => {
  const commits = [
    {
      sha: "RED",
      message: "T300: a revoked device can no longer silently re-register",
      redPaths: [
        {
          path: "packages/server/src/server/devices/revoked-device-store.test.ts",
          redAtParent: false,
          parentSha: "BASE",
        },
      ],
    },
    {
      sha: "FOLLOWUP",
      message: "T300: fix oxfmt formatting on the two new test files",
      redPaths: [],
    },
  ];

  const { introduced, inherited } = classifyFormatRedCommits(commits);

  assert.deepEqual(introduced, [
    {
      sha: "RED",
      message: "T300: a revoked device can no longer silently re-register",
      paths: ["packages/server/src/server/devices/revoked-device-store.test.ts"],
    },
  ]);
  assert.deepEqual(inherited, []);
});

test("classifyFormatRedCommits: a path added by a root commit (no parent at all) is introduced, never inherited", () => {
  const commits = [
    {
      sha: "root1",
      message: "root commit",
      redPaths: [{ path: "new-file.ts", redAtParent: false, parentSha: null }],
    },
  ];
  const { introduced, inherited } = classifyFormatRedCommits(commits);
  assert.deepEqual(introduced, [{ sha: "root1", message: "root commit", paths: ["new-file.ts"] }]);
  assert.deepEqual(inherited, []);
});

test("classifyFormatRedCommits: one commit mixing an introduced path and an inherited path reports both, correctly split", () => {
  const commits = [
    {
      sha: "mixed1",
      message: "touches two files",
      redPaths: [
        { path: "already-red.ts", redAtParent: true, parentSha: "p1" },
        { path: "newly-red.ts", redAtParent: false, parentSha: "p1" },
      ],
    },
  ];
  const { introduced, inherited } = classifyFormatRedCommits(commits);
  assert.deepEqual(introduced, [
    { sha: "mixed1", message: "touches two files", paths: ["newly-red.ts"] },
  ]);
  assert.deepEqual(inherited, [
    { sha: "mixed1", message: "touches two files", path: "already-red.ts", parentSha: "p1" },
  ]);
});

test("classifyFormatRedCommits returns empty for a range with no format-red commit", () => {
  const commits = [
    { sha: "aaa1111", message: "A: clean", redPaths: [] },
    { sha: "bbb2222", message: "B: also clean", redPaths: [] },
  ];
  assert.deepEqual(classifyFormatRedCommits(commits), { introduced: [], inherited: [] });
});

test("classifyFormatRedCommits flags every INTRODUCING commit, and every introduced file within one commit, when more than one exists", () => {
  const commits = [
    {
      sha: "c1",
      message: "first bad commit",
      redPaths: [
        { path: "a.ts", redAtParent: false, parentSha: "p" },
        { path: "b.ts", redAtParent: false, parentSha: "p" },
      ],
    },
    { sha: "c2", message: "clean commit in between", redPaths: [] },
    {
      sha: "c3",
      message: "second bad commit",
      redPaths: [{ path: "c.tsx", redAtParent: false, parentSha: "c2" }],
    },
  ];
  assert.deepEqual(classifyFormatRedCommits(commits), {
    introduced: [
      { sha: "c1", message: "first bad commit", paths: ["a.ts", "b.ts"] },
      { sha: "c3", message: "second bad commit", paths: ["c.tsx"] },
    ],
    inherited: [],
  });
});

test("classifyFormatRedCommits on an empty commit list returns no violations and no notes", () => {
  assert.deepEqual(classifyFormatRedCommits([]), { introduced: [], inherited: [] });
});

test("countDiffHunks counts '@@ ' hunk-header lines, not content lines that merely contain the substring", () => {
  assert.equal(countDiffHunks(""), 0);
  const oneHunk = "--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-foo\n+bar\n-baz\n+qux\n";
  assert.equal(countDiffHunks(oneHunk), 1);
  const twoHunks = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-foo\n+bar\n@@ -10 +10 @@\n-baz\n+qux\n";
  assert.equal(countDiffHunks(twoHunks), 2);
  // A content line that happens to start with "+@@ " (an addition whose own
  // text begins with that substring) must NOT be mistaken for a hunk
  // header -- a real hunk header is never prefixed with "+"/"-"/" ".
  const withMisleadingContentLine =
    "--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n-foo\n+@@ this is just text\n";
  assert.equal(countDiffHunks(withMisleadingContentLine), 1);
});

test("pathWasWorsened: false when either hunk count is missing (T148's original callers/fixtures)", () => {
  assert.equal(pathWasWorsened({ path: "x.ts", redAtParent: true, parentSha: "p" }), false);
  assert.equal(
    pathWasWorsened({
      path: "x.ts",
      redAtParent: true,
      parentSha: "p",
      redHunkCountAtCommit: 2,
    }),
    false,
  );
  assert.equal(
    pathWasWorsened({
      path: "x.ts",
      redAtParent: true,
      parentSha: "p",
      redHunkCountAtParent: 1,
    }),
    false,
  );
});

test("pathWasWorsened: false when the hunk count is unchanged or lower, true only when it rises", () => {
  const same = {
    path: "x.ts",
    redAtParent: true,
    parentSha: "p",
    redHunkCountAtCommit: 1,
    redHunkCountAtParent: 1,
  };
  const lower = {
    path: "x.ts",
    redAtParent: true,
    parentSha: "p",
    redHunkCountAtCommit: 0,
    redHunkCountAtParent: 1,
  };
  const higher = {
    path: "x.ts",
    redAtParent: true,
    parentSha: "p",
    redHunkCountAtCommit: 2,
    redHunkCountAtParent: 1,
  };
  assert.equal(pathWasWorsened(same), false);
  assert.equal(pathWasWorsened(lower), false);
  assert.equal(pathWasWorsened(higher), true);
});

test("classifyFormatRedCommits: a commit that WORSENS an already-red file (raises its hunk count) is an offender, not merely a NOTE", () => {
  const commits = [
    {
      sha: "w1",
      message: "adds a second, independent break to an already-red file",
      redPaths: [
        {
          path: "already-red.ts",
          redAtParent: true,
          parentSha: "p1",
          redHunkCountAtCommit: 2,
          redHunkCountAtParent: 1,
        },
      ],
    },
  ];
  const { introduced, inherited } = classifyFormatRedCommits(commits);
  assert.deepEqual(introduced, [
    {
      sha: "w1",
      message: "adds a second, independent break to an already-red file",
      paths: ["already-red.ts"],
    },
  ]);
  assert.deepEqual(inherited, []);
});

test("classifyFormatRedCommits: an already-red path whose hunk count does not rise stays a NOTE (T148 behaviour preserved)", () => {
  const commits = [
    {
      sha: "u1",
      message: "unrelated edit elsewhere in an already-red file",
      redPaths: [
        {
          path: "already-red.ts",
          redAtParent: true,
          parentSha: "p1",
          redHunkCountAtCommit: 1,
          redHunkCountAtParent: 1,
        },
      ],
    },
  ];
  const { introduced, inherited } = classifyFormatRedCommits(commits);
  assert.deepEqual(introduced, []);
  assert.deepEqual(inherited, [
    {
      sha: "u1",
      message: "unrelated edit elsewhere in an already-red file",
      path: "already-red.ts",
      parentSha: "p1",
    },
  ]);
});

test("classifyFormatRedCommits: real P6-W14 merge-gate four-commit chain (C1..C4) -- green->red fails, an unrelated edit to the red file is a NOTE, and a second new break added to it now fails too", () => {
  // Synthetic reproduction of the exact chain the P6-W14 merge gate built
  // with git plumbing and this task rebuilt for real against the live
  // repository (see this task's report for the real shas and the real
  // measured hunk counts -- 0 at C1, 1 at C2 and C3, 2 at C4 -- which match
  // exactly what is hardcoded here): C1 is green; C2 introduces a format
  // break (redAtParent: false, since C1 was clean); C3 edits an unrelated
  // part of the file and leaves the SAME single violation in place (hunk
  // count 1 -> 1, still just a NOTE -- this is T148's fix, unchanged by
  // T150); C4 adds a second, independent violation (hunk count 1 -> 2 --
  // this is the T150 fix: without it, C4 would ALSO be reported as a mere
  // NOTE, which is the exact P6-W14 gap this task closes).
  const commits = [
    {
      sha: "C2",
      message: "T150 fixture C2: introduce a format break",
      redPaths: [{ path: "t150-scratch/fixture.ts", redAtParent: false, parentSha: "C1" }],
    },
    {
      sha: "C3",
      message: "T150 fixture C3: unrelated edit to the already-red file",
      redPaths: [
        {
          path: "t150-scratch/fixture.ts",
          redAtParent: true,
          parentSha: "C2",
          redHunkCountAtCommit: 1,
          redHunkCountAtParent: 1,
        },
      ],
    },
    {
      sha: "C4",
      message: "T150 fixture C4: add a second, new break to the already-red file",
      redPaths: [
        {
          path: "t150-scratch/fixture.ts",
          redAtParent: true,
          parentSha: "C3",
          redHunkCountAtCommit: 2,
          redHunkCountAtParent: 1,
        },
      ],
    },
  ];

  const { introduced, inherited } = classifyFormatRedCommits(commits);

  assert.deepEqual(introduced, [
    {
      sha: "C2",
      message: "T150 fixture C2: introduce a format break",
      paths: ["t150-scratch/fixture.ts"],
    },
    {
      sha: "C4",
      message: "T150 fixture C4: add a second, new break to the already-red file",
      paths: ["t150-scratch/fixture.ts"],
    },
  ]);
  assert.ok(!introduced.some((v) => v.sha === "C3"));
  assert.deepEqual(inherited, [
    {
      sha: "C3",
      message: "T150 fixture C3: unrelated edit to the already-red file",
      path: "t150-scratch/fixture.ts",
      parentSha: "C2",
    },
  ]);
});

// T303: real-git reproduction of the bracketed-path parent-existence false
// positive, against this repository's own committed history. Resolved at
// runtime (never a hardcoded sha for the ADD commit itself) via `git log`,
// per CLAUDE.md's "never quote a stale sha" caution -- the path
// `apps/android/src/app/h/[serverId]/devices.tsx` (T42A1) is the exact file
// the P9-S gate's own reproduction used.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
function realGit(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

const BRACKETED_PATH = "apps/android/src/app/h/[serverId]/devices.tsx";

// `--diff-filter=A` is load-bearing, not decoration. CORRECTED at the P9-T
// merge gate: this resolved the ADD commit with a bare
// `git log -1 --format=%H -- <path>`, which returns the MOST RECENT commit
// touching the path, not the one that added it. That happened to coincide
// while T42A1 (`ad4f3b8`) was the only commit to have touched the file, and
// stopped coinciding inside the very next wave: T301 edited this route's doc
// comment, became the most-recent toucher, and its parent genuinely contains
// the file -- so `tryLoadBlobAtCommit` correctly returned real content and
// the `assert.equal(result, null)` below failed on a clean, committed tree.
// The test was order-dependent on nothing but "has anyone touched this file
// since", which is not a property any test should depend on.
// Resolved LAZILY, inside a memo the tests call, never at module scope.
// CORRECTED at the P9-T gate's CI read: these two shas WERE resolved at module
// scope, so on the `changes` job's then-shallow checkout the `git rev-parse
// <sha>^` below threw during module load and the runner reported it as
// "A resource generated asynchronous activity after the test ended ...
// uncaughtException", with the whole FILE marked `not ok` and no indication
// which fixture was at fault. A failure inside a memo is attributed to the
// test that asked for it.
let fixtureShas = null;
function bracketedPathShas() {
  if (fixtureShas) return fixtureShas;

  // A shallow checkout has exactly one commit, so `--diff-filter=A` resolves
  // THAT commit as the add commit for every path and its parent does not
  // exist. Assert it rather than skip: a skip here would make this fixture a
  // check that cannot fail on CI, which is the shape CLAUDE.md warns about in
  // three separate sections. `.github/workflows/ci.yml`'s `changes` job takes
  // `fetch-depth: 0` for exactly this reason.
  assert.equal(
    realGit(["rev-parse", "--is-shallow-repository"]),
    "false",
    "this fixture needs real history: the checkout is shallow, so the commit that " +
      "added the bracketed path cannot be resolved. Give the job `fetch-depth: 0`.",
  );

  const addedAt = realGit(["log", "--diff-filter=A", "-1", "--format=%H", "--", BRACKETED_PATH]);
  assert.notEqual(addedAt, "", `no add commit found for ${BRACKETED_PATH}`);

  const absentAt = realGit(["rev-parse", `${addedAt}^`]);
  fixtureShas = { addedAt, absentAt };
  return fixtureShas;
}

// Fixture precondition, asserted through a DIFFERENT git mechanism than the
// function under test (`git cat-file -e`, not `git show`'s pathspec parsing),
// so a future history shift fails here with a legible message instead of
// surfacing as an opaque content mismatch inside the first test below.
test("fixture: the bracketed path is genuinely absent at the resolved parent commit", () => {
  const { addedAt, absentAt } = bracketedPathShas();
  let existsAtParent = true;
  try {
    realGit(["cat-file", "-e", `${absentAt}:${BRACKETED_PATH}`]);
  } catch {
    existsAtParent = false;
  }
  assert.equal(
    existsAtParent,
    false,
    `expected ${BRACKETED_PATH} to be absent at ${absentAt} ` +
      `(parent of its add commit ${addedAt})`,
  );
});

test("tryLoadBlobAtCommit: a bracketed Expo Router path absent at a commit is reported absent (null), not the git argument-parsing fallback's commit dump", () => {
  const result = tryLoadBlobAtCommit(bracketedPathShas().absentAt, BRACKETED_PATH);
  assert.equal(result, null);
});

test("tryLoadBlobAtCommit: a plain (unbracketed) absent path is still reported absent (null) -- sanity check that the fix does not regress the ordinary case", () => {
  const result = tryLoadBlobAtCommit(
    bracketedPathShas().absentAt,
    "apps/android/src/app/h/nonexistent-plain-file-t303.tsx",
  );
  assert.equal(result, null);
});

test("tryLoadBlobAtCommit: a bracketed path that genuinely exists at a commit returns its real blob content, not null", () => {
  const result = tryLoadBlobAtCommit(bracketedPathShas().addedAt, BRACKETED_PATH);
  assert.equal(typeof result, "string");
  assert.ok(
    result.includes("DevicesScreen"),
    "expected the real devices.tsx content, got: " + result.slice(0, 200),
  );
});
