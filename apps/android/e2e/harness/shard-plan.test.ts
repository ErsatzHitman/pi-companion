import { describe, expect, it } from "vitest";

import {
  listExitGateFlowNames,
  listShardNames,
  loadShardConfig,
  resolveShardFlows,
  validateShardConfig,
  type ShardConfig,
} from "./shard-plan.js";

const REAL_KNOWN_FLOWS = listExitGateFlowNames();

function baseConfig(): ShardConfig {
  // A minimal, self-consistent two-flow, two-shard config used as the
  // starting point for the mutation tests below — deliberately NOT the
  // real shards.json, so these tests exercise validateShardConfig's own
  // logic rather than re-describing the real file.
  return {
    description: "fixture",
    flows: ["alpha", "beta"],
    shards: [
      { name: "shard-1", flows: ["alpha"] },
      { name: "shard-2", flows: ["beta"] },
    ],
  };
}

describe("the real apps/android/maestro/shards.json", () => {
  it("loads and parses", () => {
    const config = loadShardConfig();
    expect(Array.isArray(config.flows)).toBe(true);
    expect(Array.isArray(config.shards)).toBe(true);
  });

  it("covers exactly the ten real §14.4 flows, with no validation issues", () => {
    const config = loadShardConfig();
    expect(REAL_KNOWN_FLOWS).toHaveLength(10);
    expect(validateShardConfig(config, REAL_KNOWN_FLOWS)).toEqual([]);
  });

  it("excludes smoke.yaml, T37D's own harness-proof flow, from the ten", () => {
    expect(REAL_KNOWN_FLOWS).not.toContain("smoke");
  });

  it("has more than one shard, so the run is actually sharded", () => {
    const config = loadShardConfig();
    expect(listShardNames(config).length).toBeGreaterThan(1);
  });

  it("resolves each real shard to a non-empty, in-order flow list", () => {
    const config = loadShardConfig();
    for (const name of listShardNames(config)) {
      const flows = resolveShardFlows(config, name);
      expect(flows.length).toBeGreaterThan(0);
    }
  });
});

describe("validateShardConfig — mutation proof", () => {
  const known = ["alpha", "beta"];

  it("passes a self-consistent config", () => {
    expect(validateShardConfig(baseConfig(), known)).toEqual([]);
  });

  it("MUTATION: a flow assigned to two shards is caught", () => {
    const config = baseConfig();
    config.shards[1]!.flows = ["alpha"]; // beta silently dropped, alpha duplicated
    const issues = validateShardConfig(config, known);
    expect(issues.some((issue) => issue.includes("more than one shard"))).toBe(true);
  });

  it("MUTATION: a flow missing from every shard is caught", () => {
    const config = baseConfig();
    config.shards = [{ name: "shard-1", flows: ["alpha"] }];
    const issues = validateShardConfig(config, known);
    expect(issues.some((issue) => issue.includes('"beta" is not assigned to any shard'))).toBe(
      true,
    );
  });

  it("MUTATION: an empty shard is caught", () => {
    const config = baseConfig();
    config.shards.push({ name: "shard-3", flows: [] });
    const issues = validateShardConfig(config, known);
    expect(issues.some((issue) => issue.includes('shard "shard-3" has no flows'))).toBe(true);
  });

  it("MUTATION: a shard naming an unknown flow is caught", () => {
    const config = baseConfig();
    config.shards[0]!.flows.push("gamma");
    const issues = validateShardConfig(config, known);
    expect(issues.some((issue) => issue.includes('shard "shard-1" names "gamma"'))).toBe(true);
  });

  it("MUTATION: a real flow missing from config.flows entirely is caught", () => {
    const config = baseConfig();
    config.flows = ["alpha"];
    config.shards = [{ name: "shard-1", flows: ["alpha"] }];
    const issues = validateShardConfig(config, known);
    expect(issues.some((issue) => issue.includes('flow "beta" is not listed'))).toBe(true);
  });

  it("MUTATION: a duplicate name inside config.flows is caught", () => {
    const config = baseConfig();
    config.flows = ["alpha", "alpha", "beta"];
    const issues = validateShardConfig(config, known);
    expect(issues.some((issue) => issue.includes("duplicate flow name"))).toBe(true);
  });

  it("MUTATION: two shards sharing a name are caught", () => {
    const config = baseConfig();
    config.shards[1]!.name = "shard-1";
    const issues = validateShardConfig(config, known);
    expect(issues.some((issue) => issue.includes('duplicate shard name "shard-1"'))).toBe(true);
  });
});

describe("resolveShardFlows", () => {
  it("throws with the available-shard list for an unknown shard name", () => {
    const config = baseConfig();
    expect(() => resolveShardFlows(config, "does-not-exist")).toThrow(/shard-1, shard-2/);
  });
});
