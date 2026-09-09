import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BASHISMS,
  extractEmulatorScriptBlocks,
  findEmulatorScriptViolations,
  isSelfContainedLine,
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
            adb install -r app.apk
      - name: Another ordinary step
        run: set -euo pipefail
`;

test("only the emulator action's script is extracted, never a run: step", () => {
  // The distinction the whole guard rests on: `run:` defaults to bash on
  // Linux, so `set -euo pipefail` there is correct and must not be flagged.
  assert.deepEqual(extractEmulatorScriptBlocks(WORKFLOW), ["            adb install -r app.apk"]);
  assert.deepEqual(findEmulatorScriptViolations([{ path: "w.yml", content: WORKFLOW }]), []);
});

test("a bashism inside the emulator script is reported", () => {
  const content = WORKFLOW.replace(
    "            adb install -r app.apk",
    "            set -euo pipefail\n            adb install -r app.apk",
  );
  const violations = findEmulatorScriptViolations([{ path: "w.yml", content }]);

  // Both rules fire on that one line: it is a bashism AND a no-op `set`.
  assert.deepEqual(violations.map((violation) => violation.bashism).sort(), [
    "pipefail",
    "useless-set",
  ]);
  assert.ok(violations.every((violation) => violation.path === "w.yml"));
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
            adb install -r app.apk
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
  const mutated = real.replace(
    "            adb install -r",
    "            set -euo pipefail\n            adb install -r",
  );
  assert.notEqual(mutated, real, "the mutation must actually change the file");

  const violations = findEmulatorScriptViolations([{ path, content: mutated }]);
  assert.ok(
    violations.some((violation) => violation.bashism === "pipefail"),
    "the exact line that killed every shard of run 34401219271 must be reported",
  );
});

test("MUTATION PROOF: restoring the inline shard loop to the real workflow turns it red", () => {
  // The T320 defect, not the T319 one: a multi-line command substitution
  // that `sh -c` sees as an unterminated quoted string on its own line.
  const path = ".github/workflows/android-maestro-e2e.yml";
  const real = readFileSync(path, "utf8");
  const mutated = real.replace(
    "          script: npx tsx apps/android/e2e/run-shard.ts",
    [
      "          script: |",
      '            flows="$(node -e "',
      "              console.log('x');",
      '            ")"',
      "          unused: npx tsx apps/android/e2e/run-shard.ts",
    ].join("\n"),
  );
  assert.notEqual(mutated, real, "the mutation must actually change the file");

  const violations = findEmulatorScriptViolations([{ path, content: mutated }]);
  assert.ok(
    violations.some((violation) => violation.bashism === "not-self-contained"),
    "the line that killed every shard of run 34407860092 must be reported",
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

test("T320: isSelfContainedLine accepts lines sh -c can run alone", () => {
  const ok = [
    'adb install -r "$RUNNER_TEMP/picompanion-debug.apk"',
    'npx tsx apps/android/e2e/run-shard.ts shard-1 "$RUNNER_TEMP/x.apk"',
    "APP_ID=sh.picompanion npx tsx apps/android/e2e/run-flow.ts smoke",
    'echo "it\'s fine"',
    'echo "a\\"b"',
    "x=$(echo hi)",
    "for f in a b; do echo $f; done",
  ];
  for (const line of ok) {
    assert.equal(isSelfContainedLine(line), true, `should be self-contained: ${line}`);
  }
});

test("T320: isSelfContainedLine rejects the exact line that failed run 34407860092", () => {
  // `flows="$(node -e "` opened a double quote, a command substitution, and
  // a second double quote, and closed none of them on its line.
  assert.equal(isSelfContainedLine('flows="$(node -e "'), false);
  assert.equal(isSelfContainedLine("x=$(echo hi"), false);
  assert.equal(isSelfContainedLine("cmd \\"), false, "a trailing continuation continues nowhere");
});

test("T320: `set -eu` in an emulator script is reported as the no-op it is", () => {
  const content = `jobs:
  a:
    steps:
      - uses: reactivecircus/android-emulator-runner@abc123
        with:
          script: |
            set -eu
            adb install -r app.apk
`;
  const violations = findEmulatorScriptViolations([{ path: "w.yml", content }]);
  assert.deepEqual(
    violations.map((violation) => violation.bashism),
    ["useless-set"],
  );
});

test("T320: a multi-line construct is reported, not silently accepted", () => {
  const content = `jobs:
  a:
    steps:
      - uses: reactivecircus/android-emulator-runner@abc123
        with:
          script: |
            flows="$(node -e "
              console.log('x');
            ")"
`;
  const violations = findEmulatorScriptViolations([{ path: "w.yml", content }]);
  assert.ok(
    violations.some((violation) => violation.bashism === "not-self-contained"),
    "the unterminated line must be reported",
  );
});

test("T320: the real tree's emulator scripts are all line-independent", () => {
  const { workflows } = realTree();
  for (const workflow of workflows) {
    for (const script of extractEmulatorScriptBlocks(workflow.content)) {
      for (const line of stripShellComments(script).split("\n")) {
        if (line.trim() === "") continue;
        assert.equal(isSelfContainedLine(line), true, `not self-contained: ${line}`);
      }
    }
  }
});
