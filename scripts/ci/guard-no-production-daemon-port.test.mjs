import assert from "node:assert/strict";
import test from "node:test";
import { findProductionDaemonPortViolations } from "./guard-no-production-daemon-port.mjs";

test("passes on a clean maestro directory", () => {
  const files = [
    { path: "apps/android/maestro/smoke.yaml", content: "appId: sh.picompanion.debug\n---\n[]\n" },
    { path: "apps/android/maestro/README.md", content: "Never target port 6767.\n" },
  ];

  assert.deepEqual(findProductionDaemonPortViolations(files), []);
});

test("fails when a flow file names the production port directly", () => {
  const files = [
    {
      path: "apps/android/maestro/broken.yaml",
      content: "env:\n  DAEMON_ADDRESS: 127.0.0.1:6767\n---\n[]\n",
    },
  ];

  assert.deepEqual(findProductionDaemonPortViolations(files), ["apps/android/maestro/broken.yaml"]);
});

test("fails even when the reference is only inside a YAML comment", () => {
  const files = [
    {
      path: "apps/android/maestro/broken.yaml",
      content: "# must never use 6767\nappId: sh.picompanion.debug\n---\n[]\n",
    },
  ];

  assert.deepEqual(findProductionDaemonPortViolations(files), ["apps/android/maestro/broken.yaml"]);
});

test("does not flag README.md even though it explains the rule using the number", () => {
  const files = [
    {
      path: "apps/android/maestro/README.md",
      content: "This harness refuses to ever target port 6767.\n",
    },
  ];

  assert.deepEqual(findProductionDaemonPortViolations(files), []);
});

test("does not flag files outside apps/android/maestro/, even ones naming 6767", () => {
  const files = [
    { path: "apps/android/e2e/harness/production-daemon-port.ts", content: "6767" },
    { path: "plan.md", content: "port 6767" },
  ];

  assert.deepEqual(findProductionDaemonPortViolations(files), []);
});

test("flags every violating file, not just the first", () => {
  const files = [
    { path: "apps/android/maestro/a.yaml", content: "6767" },
    { path: "apps/android/maestro/b.yaml", content: "clean" },
    { path: "apps/android/maestro/c.yaml", content: "6767" },
  ];

  assert.deepEqual(findProductionDaemonPortViolations(files), [
    "apps/android/maestro/a.yaml",
    "apps/android/maestro/c.yaml",
  ]);
});
