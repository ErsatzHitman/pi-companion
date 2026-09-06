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
  });
  assert.equal(violations.length, 1);
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
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].runner, "run-guard-app-id-package-pairing.mjs");
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
  assert.equal(violations[0].runner, "run-guard-app-id-package-pairing.mjs");
  assert.equal(violations[0].allowlistReason, null);
});
