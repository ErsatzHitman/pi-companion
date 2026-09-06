import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { LANES, parseCliArgs, planLaneRun, resolveLane } from "./run-e2e-lane.js";
import { DEV_DAEMON_PORT, PRODUCTION_DAEMON_PORT } from "./sandbox-env.js";

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe("resolveLane", () => {
  it("resolves the e2e lane to test:e2e", () => {
    expect(resolveLane("e2e")?.npmScript).toBe("test:e2e");
  });

  it("resolves the integration lane to test:integration", () => {
    expect(resolveLane("integration")?.npmScript).toBe("test:integration");
  });

  it("returns undefined for an unknown lane name", () => {
    expect(resolveLane("bogus")).toBeUndefined();
    expect(resolveLane(undefined)).toBeUndefined();
  });

  it("no lane's timeout equals either forbidden port number (a copy/paste guard, not a real constraint)", () => {
    for (const lane of Object.values(LANES)) {
      expect(lane.timeoutMs).not.toBe(PRODUCTION_DAEMON_PORT);
      expect(lane.timeoutMs).not.toBe(DEV_DAEMON_PORT);
    }
  });
});

describe("parseCliArgs", () => {
  it("parses a lane name with no flags", () => {
    expect(parseCliArgs(["e2e"])).toEqual({ laneName: "e2e", dryRun: false });
  });

  it("parses --dry-run", () => {
    expect(parseCliArgs(["integration", "--dry-run"])).toEqual({
      laneName: "integration",
      dryRun: true,
    });
  });

  it("treats a missing lane name as undefined rather than throwing", () => {
    expect(parseCliArgs([])).toEqual({ laneName: undefined, dryRun: false });
  });
});

describe("planLaneRun", () => {
  it("resolves a real, isolated sandbox environment for a known lane", async () => {
    const plan = await planLaneRun("e2e");
    createdRoots.push(plan.sandbox.paseoHomeRoot);

    expect(plan.lane.npmScript).toBe("test:e2e");
    expect(plan.sandbox.port).not.toBe(PRODUCTION_DAEMON_PORT);
    expect(plan.sandbox.port).not.toBe(DEV_DAEMON_PORT);
    expect(plan.sandbox.env.PASEO_HOME).toBe(plan.sandbox.paseoHome);
  });

  it("rejects an unknown lane before allocating any sandbox resources", async () => {
    await expect(planLaneRun("bogus")).rejects.toThrow(/Unknown or missing lane/);
  });

  it("rejects a missing lane before allocating any sandbox resources", async () => {
    await expect(planLaneRun(undefined)).rejects.toThrow(/Unknown or missing lane/);
  });
});
