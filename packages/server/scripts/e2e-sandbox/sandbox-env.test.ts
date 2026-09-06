import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEV_DAEMON_PORT,
  PRODUCTION_DAEMON_PORT,
  allocateSandboxPort,
  assertNotForbiddenPort,
  buildSandboxEnv,
  createIsolatedPaseoHomeRoot,
  isForbiddenPort,
} from "./sandbox-env.js";

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe("isForbiddenPort / assertNotForbiddenPort", () => {
  it("flags the production daemon port", () => {
    expect(isForbiddenPort(PRODUCTION_DAEMON_PORT)).toBe(true);
    expect(() => assertNotForbiddenPort(PRODUCTION_DAEMON_PORT, "test")).toThrow(/6767/);
  });

  it("flags the dev daemon port", () => {
    expect(isForbiddenPort(DEV_DAEMON_PORT)).toBe(true);
    expect(() => assertNotForbiddenPort(DEV_DAEMON_PORT, "test")).toThrow(/6768/);
  });

  it("does not flag an arbitrary ephemeral port", () => {
    expect(isForbiddenPort(54321)).toBe(false);
    expect(() => assertNotForbiddenPort(54321, "test")).not.toThrow();
  });

  it("names the caller-supplied context in the thrown message", () => {
    expect(() =>
      assertNotForbiddenPort(PRODUCTION_DAEMON_PORT, "buildSandboxEnv allocated port"),
    ).toThrow(/buildSandboxEnv allocated port/);
  });
});

describe("allocateSandboxPort", () => {
  it("returns a real, bindable port that is neither forbidden port", async () => {
    const port = await allocateSandboxPort();
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(PRODUCTION_DAEMON_PORT);
    expect(port).not.toBe(DEV_DAEMON_PORT);
  });

  it("two allocations do not have to collide, and neither ever lands on a forbidden port", async () => {
    const ports = await Promise.all([
      allocateSandboxPort(),
      allocateSandboxPort(),
      allocateSandboxPort(),
    ]);
    for (const port of ports) {
      expect(port).not.toBe(PRODUCTION_DAEMON_PORT);
      expect(port).not.toBe(DEV_DAEMON_PORT);
    }
  });
});

describe("createIsolatedPaseoHomeRoot", () => {
  it("creates a real, fresh directory under the OS temp dir", async () => {
    const root = await createIsolatedPaseoHomeRoot();
    createdRoots.push(root);

    expect(existsSync(root)).toBe(true);
    expect(root).toContain("picompanion-server-e2e-sandbox-");
  });

  it("two calls never return the same directory", async () => {
    const [first, second] = await Promise.all([
      createIsolatedPaseoHomeRoot(),
      createIsolatedPaseoHomeRoot(),
    ]);
    createdRoots.push(first, second);

    expect(first).not.toBe(second);
  });
});

describe("buildSandboxEnv", () => {
  it("resolves a port distinct from both forbidden ports and an isolated PASEO_HOME", async () => {
    const result = await buildSandboxEnv({});
    createdRoots.push(result.paseoHomeRoot);

    expect(result.port).not.toBe(PRODUCTION_DAEMON_PORT);
    expect(result.port).not.toBe(DEV_DAEMON_PORT);
    expect(result.env.PASEO_HOME).toBe(result.paseoHome);
    expect(result.paseoHome.endsWith(".paseo")).toBe(true);
    expect(path.dirname(result.paseoHome)).toBe(result.paseoHomeRoot);
    expect(result.env.PICOMPANION_E2E_SANDBOX).toBe("1");
    expect(result.env.PICOMPANION_E2E_SANDBOX_PORT).toBe(String(result.port));
  });

  it("strips an ambient PORT env var set to the production daemon port", async () => {
    const result = await buildSandboxEnv({ PORT: "6767" });
    createdRoots.push(result.paseoHomeRoot);

    expect(result.env.PORT).toBeUndefined();
  });

  it("strips an ambient PASEO_PORT env var set to the dev daemon port", async () => {
    const result = await buildSandboxEnv({ PASEO_PORT: "6768" });
    createdRoots.push(result.paseoHomeRoot);

    expect(result.env.PASEO_PORT).toBeUndefined();
  });

  it("leaves an ambient port env var alone when it does not name a forbidden port", async () => {
    const result = await buildSandboxEnv({ DAEMON_PORT: "9999" });
    createdRoots.push(result.paseoHomeRoot);

    expect(result.env.DAEMON_PORT).toBe("9999");
  });

  it("always overwrites PASEO_HOME even when the base environment already sets one", async () => {
    const result = await buildSandboxEnv({ PASEO_HOME: "/home/someone/.paseo" });
    createdRoots.push(result.paseoHomeRoot);

    expect(result.env.PASEO_HOME).not.toBe("/home/someone/.paseo");
    expect(result.env.PASEO_HOME).toBe(result.paseoHome);
  });
});
