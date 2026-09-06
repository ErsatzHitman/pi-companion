import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFlowRegistry } from "./flow-registry.js";

let fixtureDir: string;

beforeEach(async () => {
  fixtureDir = await mkdtemp(path.join(os.tmpdir(), "picompanion-flow-registry-fixture-"));
  await writeFile(path.join(fixtureDir, "smoke.yaml"), "appId: sh.picompanion.debug\n---\n[]\n");
  await writeFile(path.join(fixtureDir, "pairing.yaml"), "appId: sh.picompanion.debug\n---\n[]\n");
  await writeFile(path.join(fixtureDir, "config.yaml"), "# reserved, not a flow\n");
  await writeFile(path.join(fixtureDir, "README.md"), "# not a flow\n");
});

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("createFlowRegistry", () => {
  it("lists .yaml flow files, excluding the reserved config.yaml and non-yaml files", () => {
    const registry = createFlowRegistry(fixtureDir);
    expect(registry.listFlowNames()).toEqual(["pairing", "smoke"]);
  });

  it("resolves a known flow name to its path", () => {
    const registry = createFlowRegistry(fixtureDir);
    expect(registry.resolveFlowPath("smoke")).toBe(path.join(fixtureDir, "smoke.yaml"));
  });

  it("throws with the available-flow list for an unknown flow name", () => {
    const registry = createFlowRegistry(fixtureDir);
    expect(() => registry.resolveFlowPath("does-not-exist")).toThrow(/pairing, smoke/);
  });

  it("throws for the reserved config name instead of resolving it as a flow", () => {
    const registry = createFlowRegistry(fixtureDir);
    expect(() => registry.resolveFlowPath("config")).toThrow(/No flow named "config"/);
  });

  it("rejects a name shaped like a path-traversal attempt before touching the filesystem", () => {
    const registry = createFlowRegistry(fixtureDir);
    expect(() => registry.resolveFlowPath("../../etc/passwd")).toThrow(/Invalid flow name/);
    expect(() => registry.resolveFlowPath("Smoke")).toThrow(/Invalid flow name/);
  });

  it("returns an empty list rather than throwing when the directory does not exist", () => {
    const registry = createFlowRegistry(path.join(fixtureDir, "does-not-exist"));
    expect(registry.listFlowNames()).toEqual([]);
  });
});
