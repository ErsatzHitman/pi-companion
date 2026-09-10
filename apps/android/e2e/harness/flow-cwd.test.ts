import { readFileSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FLOW_CWD_PREFIX, createFlowCwd, flowCwdSlug } from "./flow-cwd.js";
import { createFlowRegistry } from "./flow-registry.js";
import { parseMaestroSteps } from "../flows/maestro-yaml.js";

describe("flowCwdSlug", () => {
  it("keeps a flow name's lowercase letters, digits and hyphens and folds everything else", () => {
    expect(flowCwdSlug("cold-start-restore")).toBe("cold-start-restore");
    expect(flowCwdSlug("Notification Approval!")).toBe("notification-approval");
    expect(flowCwdSlug("../../etc")).toBe("etc");
    expect(flowCwdSlug("")).toBe("flow");
  });
});

describe("createFlowCwd", () => {
  const created: string[] = [];
  afterEach(async () => {
    for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("creates a real, empty directory under the temp root named after the flow, distinct per call", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flow-cwd-test-"));
    created.push(root);

    const first = await createFlowCwd("cold-start-restore", root);
    const second = await createFlowCwd("cold-start-restore", root);

    expect(first).not.toBe(second);
    for (const dir of [first, second]) {
      expect(path.dirname(dir)).toBe(root);
      expect(path.basename(dir).startsWith(`${FLOW_CWD_PREFIX}cold-start-restore-`)).toBe(true);
      expect((await stat(dir)).isDirectory()).toBe(true);
    }
  });

  it("defaults to os.tmpdir()", async () => {
    const dir = await createFlowCwd("smoke");
    created.push(dir);
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
  });
});

describe("no flow types a hardcoded working directory", () => {
  // Run 34462826449: `cold-start-restore` typed `/tmp/picompanion-cold-
  // start-restore` -- a host path nothing had created -- and the daemon
  // refused the session. Every `inputText` that is a path must be the
  // `${FLOW_CWD}` this harness mints per run.
  it("every inputText step that looks like a path is exactly ${FLOW_CWD}", () => {
    const registry = createFlowRegistry();
    const offenders: string[] = [];
    for (const name of registry.listFlowNames()) {
      const yaml = readFileSync(registry.resolveFlowPath(name), "utf8");
      for (const step of parseMaestroSteps(yaml)) {
        if (step.kind !== "inputText" || step.value === undefined) continue;
        const looksLikePath = /^(?:\/|[A-Za-z]:\\|~)/.test(step.value);
        if (looksLikePath && step.value !== "${FLOW_CWD}") {
          offenders.push(`${name}.yaml:${step.line} inputText ${step.value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
