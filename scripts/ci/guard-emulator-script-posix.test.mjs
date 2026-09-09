import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BASHISMS,
  extractEmulatorScriptBlocks,
  findEmulatorScriptViolations,
  selectWorkflowFiles,
  stripShellComments,
} from "./guard-emulator-script-posix.mjs";

const WORKFLOW = `jobs:
  a:
    steps:
      - name: An ordinary run step, which GitHub runs under bash
        run: |
          set -euo pipefail
          echo fine
      - name: Boot emulator
        uses: reactivecircus/android-emulator-runner@abc123 # v2.38.0
        with:
          api-level: 35
          script: |
            set -eu
            adb install -r app.apk
      - name: Another ordinary step
        run: set -euo pipefail
`;

test("only the emulator action's script is extracted, never a run: step", () => {
  // The distinction the whole guard rests on: `run:` defaults to bash on
  // Linux, so `set -euo pipefail` there is correct and must not be flagged.
  assert.deepEqual(extractEmulatorScriptBlocks(WORKFLOW), [
    "            set -eu\n            adb install -r app.apk",
  ]);
  assert.deepEqual(findEmulatorScriptViolations([{ path: "w.yml", content: WORKFLOW }]), []);
});

test("a bashism inside the emulator script is reported", () => {
  const content = WORKFLOW.replace("            set -eu\n", "            set -euo pipefail\n");
  const violations = findEmulatorScriptViolations([{ path: "w.yml", content }]);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].bashism, "pipefail");
  assert.equal(violations[0].path, "w.yml");
});

test("an inline (non-block) script is extracted too", () => {
  const content = `jobs:
  a:
    steps:
      - uses: reactivecircus/android-emulator-runner@abc123
        with:
          script: adb install -r app.apk && [[ -f x ]]
`;
  const violations = findEmulatorScriptViolations([{ path: "w.yml", content }]);
  assert.deepEqual(
    violations.map((violation) => violation.bashism),
    ["double-bracket-test"],
  );
});

test("each checked bashism is detected on its own", () => {
  const cases = [
    ["pipefail", "set -euo pipefail"],
    ["double-bracket-test", "if [[ -f x ]]; then echo y; fi"],
    ["process-substitution", "diff <(a) <(b)"],
    ["ampersand-redirect", "cmd &> out.txt"],
    ["declare-or-array", "items=(a b c)"],
    ["source-builtin", "source ./env.sh"],
  ];

  for (const [id, line] of cases) {
    const content = `jobs:
  a:
    steps:
      - uses: reactivecircus/android-emulator-runner@abc123
        with:
          script: |
            ${line}
`;
    const violations = findEmulatorScriptViolations([{ path: "w.yml", content }]);
    assert.ok(
      violations.some((violation) => violation.bashism === id),
      `${id} should be detected in: ${line}`,
    );
  }

  assert.equal(BASHISMS.length, cases.length, "every registered bashism needs a case above");
});

test("`local` is deliberately NOT a bashism — dash supports it", () => {
  const content = `jobs:
  a:
    steps:
      - uses: reactivecircus/android-emulator-runner@abc123
        with:
          script: |
            f() { local x=1; echo "$x"; }
`;
  assert.deepEqual(findEmulatorScriptViolations([{ path: "w.yml", content }]), []);
});

test("a COMMENT naming pipefail does not count as using it", () => {
  // Both real scripts now carry a comment that names `set -o pipefail`
  // precisely in order to warn about it. A guard matching raw text would
  // report its own warning as the defect.
  const content = `jobs:
  a:
    steps:
      - uses: reactivecircus/android-emulator-runner@abc123
        with:
          script: |
            # Never \`set -o pipefail\` here: dash rejects it.
            set -eu
`;
  assert.deepEqual(findEmulatorScriptViolations([{ path: "w.yml", content }]), []);
  assert.ok(!stripShellComments("# set -o pipefail\nset -eu").includes("pipefail"));
});

test("a script belonging to a different step is not attributed to the emulator step", () => {
  const content = `jobs:
  a:
    steps:
      - uses: reactivecircus/android-emulator-runner@abc123
        with:
          api-level: 35
      - uses: some/other-action@def456
        with:
          script: set -euo pipefail
`;
  assert.deepEqual(extractEmulatorScriptBlocks(content), []);
  assert.deepEqual(findEmulatorScriptViolations([{ path: "w.yml", content }]), []);
});

test("the real tree: both emulator scripts exist and neither uses a bashism", () => {
  const { workflows } = realTree();
  const scripts = workflows.flatMap((workflow) => extractEmulatorScriptBlocks(workflow.content));

  // Non-vacuity: a guard that silently checks nothing reports OK forever.
  assert.equal(scripts.length, 2, "maestro-e2e and packaged-app-smoke each have one");
  assert.deepEqual(findEmulatorScriptViolations(workflows), []);
});

test("MUTATION PROOF: restoring `set -euo pipefail` to the real workflow turns it red", () => {
  const path = ".github/workflows/android-maestro-e2e.yml";
  const real = readFileSync(path, "utf8");
  const mutated = real.replace("set -eu\n", "set -euo pipefail\n");
  assert.notEqual(mutated, real, "the mutation must actually change the file");

  const violations = findEmulatorScriptViolations([{ path, content: mutated }]);
  assert.ok(
    violations.some((violation) => violation.bashism === "pipefail"),
    "the exact line that killed every shard of run 34401219271 must be reported",
  );
});

function realTree() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  return {
    workflows: selectWorkflowFiles(tracked).map((path) => ({
      path,
      content: readFileSync(path, "utf8"),
    })),
  };
}
