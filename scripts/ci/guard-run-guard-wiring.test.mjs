import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  ALLOWLISTED_UNWIRED_RUN_GUARDS,
  extractRunStepContents,
  findUnwiredRunGuardViolations,
  isRunnerWiredInWorkflow,
  isValidAllowlistReason,
} from "./guard-run-guard-wiring.mjs";

const CI_SCRIPTS_DIR = "scripts/ci/";
const WORKFLOWS_DIR = ".github/workflows/";

function readRealRunnerFilenames() {
  return readdirSync(CI_SCRIPTS_DIR)
    .filter((entry) => /^run-guard-.*\.mjs$/.test(entry))
    .sort();
}

function readRealWorkflows() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((entry) => /\.ya?ml$/.test(entry))
    .map((entry) => ({
      path: `${WORKFLOWS_DIR}${entry}`,
      content: readFileSync(`${WORKFLOWS_DIR}${entry}`, "utf8"),
    }));
}

// ---------------------------------------------------------------------------
// extractRunStepContents — inline and block-scalar shapes.
// ---------------------------------------------------------------------------

test("extractRunStepContents reads an inline run: value", () => {
  const workflow = `
jobs:
  example:
    steps:
      - name: Do it
        run: node scripts/ci/run-guard-foo.mjs
`;
  assert.deepEqual(extractRunStepContents(workflow), ["node scripts/ci/run-guard-foo.mjs"]);
});

test("extractRunStepContents reads a `- run:` combined list-item form", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: node scripts/ci/run-guard-foo.mjs
`;
  assert.deepEqual(extractRunStepContents(workflow), ["node scripts/ci/run-guard-foo.mjs"]);
});

test("extractRunStepContents reads a block-scalar run: value up to its own indentation", () => {
  const workflow = `
jobs:
  example:
    steps:
      - name: Do it
        run: |
          echo one
          node scripts/ci/run-guard-foo.mjs
      - name: Next step
        run: echo done
`;
  const contents = extractRunStepContents(workflow);
  assert.equal(contents.length, 2);
  assert.match(contents[0], /node scripts\/ci\/run-guard-foo\.mjs/);
  assert.equal(contents[1], "echo done");
});

test("extractRunStepContents keeps a blank line inside a block scalar without ending the block", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: |
          echo one

          node scripts/ci/run-guard-foo.mjs
`;
  const contents = extractRunStepContents(workflow);
  assert.equal(contents.length, 1);
  assert.match(contents[0], /run-guard-foo\.mjs/);
});

test("extractRunStepContents does not extend a block scalar past a dedented sibling step", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: |
          echo one
      - run: node scripts/ci/run-guard-foo.mjs
`;
  const contents = extractRunStepContents(workflow);
  assert.equal(contents.length, 2);
  assert.equal(contents[0].trim(), "echo one");
  assert.equal(contents[1], "node scripts/ci/run-guard-foo.mjs");
});

// ---------------------------------------------------------------------------
// isRunnerWiredInWorkflow — the trap: a comment must never count as wiring.
// ---------------------------------------------------------------------------

test("isRunnerWiredInWorkflow is true when a real run: step invokes the runner", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: node scripts/ci/run-guard-foo.mjs
`;
  assert.equal(isRunnerWiredInWorkflow("run-guard-foo.mjs", workflow), true);
});

test("TRAP: a job-header comment mentioning the runner's filename does NOT count as wiring it", () => {
  // This is the exact shape the P8-W11 gate found for
  // run-guard-app-id-package-pairing.mjs: a comment block, sitting above a
  // job definition, that names the runner in prose while no `run:` step
  // anywhere in the file invokes it.
  const workflow = `
jobs:
  # T207 shipped run-guard-foo.mjs and CI runs it via
  # \`node scripts/ci/run-guard-foo.mjs\` -- except nothing below actually does.
  unrelated-job:
    steps:
      - run: echo hi
`;
  assert.equal(isRunnerWiredInWorkflow("run-guard-foo.mjs", workflow), false);
});

test("TRAP: a shell comment quoting the runner's filename INSIDE a real run: block does NOT count as wiring it", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: |
          # mentions scripts/ci/run-guard-foo.mjs but never invokes it
          echo hi
`;
  assert.equal(isRunnerWiredInWorkflow("run-guard-foo.mjs", workflow), false);
});

test("a real invocation elsewhere in the SAME block-scalar step as an unrelated comment is still found", () => {
  const workflow = `
jobs:
  example:
    steps:
      - run: |
          # this step does two things
          echo starting
          node scripts/ci/run-guard-foo.mjs
`;
  assert.equal(isRunnerWiredInWorkflow("run-guard-foo.mjs", workflow), true);
});

// ---------------------------------------------------------------------------
// isValidAllowlistReason
// ---------------------------------------------------------------------------

test("isValidAllowlistReason rejects empty, missing, and placeholder reasons", () => {
  assert.equal(isValidAllowlistReason(undefined), false);
  assert.equal(isValidAllowlistReason(null), false);
  assert.equal(isValidAllowlistReason(""), false);
  assert.equal(isValidAllowlistReason("TODO"), false);
  assert.equal(isValidAllowlistReason("   "), false);
});

test("isValidAllowlistReason accepts a real, recorded reason", () => {
  assert.equal(
    isValidAllowlistReason(
      "local-only by design: actions/checkout hands every CI job a pristine tree",
    ),
    true,
  );
});

// ---------------------------------------------------------------------------
// findUnwiredRunGuardViolations — fixture-level pass/fail cases.
// ---------------------------------------------------------------------------

test("findUnwiredRunGuardViolations: passes when every runner is wired", () => {
  const violations = findUnwiredRunGuardViolations({
    runnerFilenames: ["run-guard-foo.mjs", "run-guard-bar.mjs"],
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content: `
jobs:
  a:
    steps:
      - run: node scripts/ci/run-guard-foo.mjs
  b:
    steps:
      - run: node scripts/ci/run-guard-bar.mjs
`,
      },
    ],
    // Explicit empty allowlist: this fixture's runnerFilenames deliberately
    // don't include the two real ALLOWLISTED_UNWIRED_RUN_GUARDS keys, and
    // (T211) the default (real) allowlist is now ALSO checked for staleness
    // against whatever runnerFilenames this call passes — so leaving the
    // default in place here would spuriously report both real entries as
    // stale-missing-runner. Tests about the allowlist itself pass their own.
    allowlist: {},
  });
  assert.deepEqual(violations, []);
});

test("findUnwiredRunGuardViolations: passes when a runner is wired in a DIFFERENT workflow file", () => {
  const violations = findUnwiredRunGuardViolations({
    runnerFilenames: ["run-guard-foo.mjs"],
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content: "jobs:\n  a:\n    steps:\n      - run: echo hi\n",
      },
      {
        path: ".github/workflows/other.yml",
        content: "jobs:\n  b:\n    steps:\n      - run: node scripts/ci/run-guard-foo.mjs\n",
      },
    ],
    allowlist: {}, // see the comment in the previous test for why this is explicit
  });
  assert.deepEqual(violations, []);
});

test("findUnwiredRunGuardViolations: FAILS and names the runner when nothing runs it", () => {
  const violations = findUnwiredRunGuardViolations({
    runnerFilenames: ["run-guard-foo.mjs"],
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content: "jobs:\n  a:\n    steps:\n      - run: echo hi\n",
      },
    ],
    allowlist: {}, // see the comment two tests up for why this is explicit
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "unwired");
  assert.equal(violations[0].runner, "run-guard-foo.mjs");
  assert.equal(violations[0].allowlistReason, null);
});

test("findUnwiredRunGuardViolations: FAILS when the only mention is a comment (the P8-W11 shape)", () => {
  const violations = findUnwiredRunGuardViolations({
    runnerFilenames: ["run-guard-app-id-package-pairing.mjs"],
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content: `
jobs:
  # CI runs it via \`node scripts/ci/run-guard-app-id-package-pairing.mjs\`
  unrelated:
    steps:
      - run: echo hi
`,
      },
    ],
    allowlist: {}, // see the comment several tests up for why this is explicit
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "unwired");
  assert.equal(violations[0].runner, "run-guard-app-id-package-pairing.mjs");
});

test("findUnwiredRunGuardViolations: kind is 'unwired' for a too-short allowlist reason on a real, unwired runner", () => {
  const violations = findUnwiredRunGuardViolations({
    runnerFilenames: ["run-guard-foo.mjs"],
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content: "jobs:\n  a:\n    steps:\n      - run: echo hi\n",
      },
    ],
    allowlist: { "run-guard-foo.mjs": "todo" },
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "unwired");
});

test("findUnwiredRunGuardViolations: an unwired runner with a VALID allowlist entry is not a violation", () => {
  const violations = findUnwiredRunGuardViolations({
    runnerFilenames: ["run-guard-foo.mjs"],
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content: "jobs:\n  a:\n    steps:\n      - run: echo hi\n",
      },
    ],
    allowlist: {
      "run-guard-foo.mjs":
        "genuinely unwired on purpose, for a real and specific reason recorded here",
    },
  });
  assert.deepEqual(violations, []);
});

test("findUnwiredRunGuardViolations: an unwired runner with an INVALID (too-short) allowlist reason IS a violation", () => {
  const violations = findUnwiredRunGuardViolations({
    runnerFilenames: ["run-guard-foo.mjs"],
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content: "jobs:\n  a:\n    steps:\n      - run: echo hi\n",
      },
    ],
    allowlist: { "run-guard-foo.mjs": "todo" },
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].runner, "run-guard-foo.mjs");
  assert.equal(violations[0].allowlistReason, "todo");
});

test("findUnwiredRunGuardViolations: an allowlist entry cannot rescue a runner that a workflow ALREADY wires (allowlist is for unwired runners only)", () => {
  const violations = findUnwiredRunGuardViolations({
    runnerFilenames: ["run-guard-foo.mjs"],
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        content: "jobs:\n  a:\n    steps:\n      - run: node scripts/ci/run-guard-foo.mjs\n",
      },
    ],
    allowlist: {},
  });
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// The allowlist itself: both real entries carry a valid, non-placeholder
// reason.
// ---------------------------------------------------------------------------

test("both real allowlist entries carry a valid, recorded reason", () => {
  for (const [runner, reason] of Object.entries(ALLOWLISTED_UNWIRED_RUN_GUARDS)) {
    assert.equal(
      isValidAllowlistReason(reason),
      true,
      `${runner}'s allowlist reason is too short/missing`,
    );
  }
});

test("the allowlist names exactly the two runners documented in T209's brief", () => {
  assert.deepEqual(Object.keys(ALLOWLISTED_UNWIRED_RUN_GUARDS).sort(), [
    "run-guard-clean-working-tree.mjs",
    "run-guard-server-test-typecheck-ceiling.mjs",
  ]);
});

// ---------------------------------------------------------------------------
// Real-tree proof.
// ---------------------------------------------------------------------------

test("the real tree today: every scripts/ci/run-guard-*.mjs is wired or allowlisted", () => {
  const runnerFilenames = readRealRunnerFilenames();
  const workflows = readRealWorkflows();
  assert.ok(runnerFilenames.length > 10, "expected to find the real run-guard-*.mjs runners");
  assert.ok(workflows.length > 0, "expected to find real workflow files");

  const violations = findUnwiredRunGuardViolations({ runnerFilenames, workflows });
  assert.deepEqual(violations, []);
});

test("this guard's own runner is itself wired into a real workflow (the guard proves itself)", () => {
  const workflows = readRealWorkflows();
  assert.equal(
    workflows.some((workflow) =>
      isRunnerWiredInWorkflow("run-guard-run-guard-wiring.mjs", workflow.content),
    ),
    true,
  );
});

test("MUTATION PROOF: deleting the real guard-app-id-package-pairing job from ci.yml turns this guard red and names that runner", () => {
  const runnerFilenames = readRealRunnerFilenames();
  const workflows = readRealWorkflows();

  const mutatedWorkflows = workflows.map((workflow) => {
    if (!workflow.path.endsWith("ci.yml")) return workflow;
    // Remove exactly the job block this task's brief names, from its own
    // header comment start through to (but not including) the next
    // top-level job key -- the same "delete the job, not just the run
    // line" mutation CLAUDE.md's brief prescribes.
    const jobStart = workflow.content.indexOf("  guard-app-id-package-pairing:");
    assert.ok(jobStart > -1, "expected to find the real guard-app-id-package-pairing job");
    const nextJobMatch = workflow.content.slice(jobStart).match(/\n {2}[a-zA-Z][a-zA-Z0-9_-]*:\n/);
    assert.ok(nextJobMatch, "expected another job to follow guard-app-id-package-pairing");
    const jobEnd = jobStart + nextJobMatch.index + 1;
    return {
      ...workflow,
      content: workflow.content.slice(0, jobStart) + workflow.content.slice(jobEnd),
    };
  });

  assert.notEqual(
    mutatedWorkflows.find((w) => w.path.endsWith("ci.yml")).content,
    workflows.find((w) => w.path.endsWith("ci.yml")).content,
    "the mutation must actually change ci.yml's content",
  );

  const violations = findUnwiredRunGuardViolations({
    runnerFilenames,
    workflows: mutatedWorkflows,
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "unwired");
  assert.equal(violations[0].runner, "run-guard-app-id-package-pairing.mjs");
  assert.equal(violations[0].allowlistReason, null);
});

// ---------------------------------------------------------------------------
// T211: a stale ALLOWLISTED_UNWIRED_RUN_GUARDS entry must be a hard failure,
// proven against the REAL allowlist and the real tree — not a fixture
// allowlist that proves nothing about scripts/ci/guard-run-guard-wiring.mjs's
// own shipped ALLOWLISTED_UNWIRED_RUN_GUARDS.
// ---------------------------------------------------------------------------

test("T211 MUTATION PROOF: a real allowlist entry naming a runner that does not exist on disk is a stale-missing-runner violation", () => {
  const runnerFilenames = readRealRunnerFilenames();
  const workflows = readRealWorkflows();

  const mutatedAllowlist = {
    ...ALLOWLISTED_UNWIRED_RUN_GUARDS,
    "run-guard-does-not-exist.mjs":
      "a perfectly valid, long-enough reason string that would pass isValidAllowlistReason " +
      "on its own -- the violation must come from the runner not existing, not from a short reason",
  };
  assert.ok(
    !runnerFilenames.includes("run-guard-does-not-exist.mjs"),
    "the fixture key must genuinely not exist on disk for this proof to mean anything",
  );

  const violations = findUnwiredRunGuardViolations({
    runnerFilenames,
    workflows,
    allowlist: mutatedAllowlist,
  });

  const stale = violations.filter((v) => v.runner === "run-guard-does-not-exist.mjs");
  assert.equal(stale.length, 1);
  assert.equal(stale[0].kind, "stale-missing-runner");
  // The real two allowlist entries must still be reported clean alongside
  // this fabricated one -- this is not "flag everything once the allowlist
  // has any problem", it is "flag the one entry that is actually stale".
  assert.equal(
    violations.some((v) => v.runner === "run-guard-clean-working-tree.mjs"),
    false,
  );
  assert.equal(
    violations.some((v) => v.runner === "run-guard-server-test-typecheck-ceiling.mjs"),
    false,
  );
});

test("T211 MUTATION PROOF: a real allowlist entry naming a runner a workflow now really wires is a stale-wired violation", () => {
  const runnerFilenames = readRealRunnerFilenames();
  const workflows = readRealWorkflows();

  // Pick a runner this repository's ci.yml genuinely, currently invokes
  // (verified by hand against .github/workflows/ci.yml before writing this
  // test), and pretend it is allowlisted as unwired-on-purpose. A real
  // allowlist entry naming an actually-wired runner is exactly the "entry
  // outlived its reason" shape T211 exists to catch.
  const nowWiredRunner = "run-guard-no-legacy-app-tree.mjs";
  assert.ok(
    runnerFilenames.includes(nowWiredRunner),
    "expected to find the real runner this proof allowlists",
  );
  assert.ok(
    workflows.some((workflow) => isRunnerWiredInWorkflow(nowWiredRunner, workflow.content)),
    "expected this runner to already be genuinely wired in the real tree",
  );

  const mutatedAllowlist = {
    ...ALLOWLISTED_UNWIRED_RUN_GUARDS,
    [nowWiredRunner]:
      "pretending, for this test only, that this already-wired runner was allowlisted as " +
      "unwired-on-purpose -- the entry has outlived its reason and must be reported as stale",
  };

  const violations = findUnwiredRunGuardViolations({
    runnerFilenames,
    workflows,
    allowlist: mutatedAllowlist,
  });

  const stale = violations.filter((v) => v.runner === nowWiredRunner);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].kind, "stale-wired");
  // The runner itself must never ALSO be reported as "unwired" merely
  // because it is (falsely, for this test) allowlisted -- it is wired, so
  // the main loop's `if (isWired(runner)) continue;` must still skip it.
  assert.equal(
    violations.some((v) => v.runner === nowWiredRunner && v.kind === "unwired"),
    false,
  );
});
