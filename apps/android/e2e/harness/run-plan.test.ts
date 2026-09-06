import { describe, expect, it } from "vitest";

import { DEFAULT_APP_ID, buildRunPlan } from "./run-plan.js";
import type { IsolatedDaemonEndpoint } from "./daemon-endpoint.js";

const SAFE_ENDPOINT: IsolatedDaemonEndpoint = {
  port: 54321,
  paseoHome: "/tmp/picompanion-maestro-home-abc123/.paseo",
  listenAddress: "127.0.0.1:54321",
  emulatorAddress: "10.0.2.2:54321",
};

describe("buildRunPlan", () => {
  it("builds a daemon start argv that binds the isolated listen address and disables relay/web-ui/mcp", () => {
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);

    expect(plan.daemon.startArgv).toEqual([
      "start",
      "--listen",
      "127.0.0.1:54321",
      "--home",
      SAFE_ENDPOINT.paseoHome,
      "--foreground",
      "--no-relay",
      "--no-web-ui",
      "--no-mcp",
    ]);
    expect(plan.daemon.stopArgv).toEqual(["stop", "--home", SAFE_ENDPOINT.paseoHome, "--force"]);
  });

  it("builds a maestro argv naming the resolved flow path and the default appId override", () => {
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);
    expect(plan.maestro.argv).toEqual([
      "test",
      "-e",
      `APP_ID=${DEFAULT_APP_ID}`,
      "/repo/apps/android/maestro/smoke.yaml",
    ]);
  });

  it("defaults the appId override to sh.picompanion.debug — the package maestro-e2e needs, and needed before appId was parameterized (T207)", () => {
    expect(DEFAULT_APP_ID).toBe("sh.picompanion.debug");
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);
    expect(plan.maestro.argv).toContain("APP_ID=sh.picompanion.debug");
  });

  it("passes an explicit appId through as the -e APP_ID override, for packaged-app-smoke's sh.picompanion", () => {
    const plan = buildRunPlan(
      "smoke",
      "/repo/apps/android/maestro/smoke.yaml",
      SAFE_ENDPOINT,
      "sh.picompanion",
    );
    expect(plan.maestro.argv).toEqual([
      "test",
      "-e",
      "APP_ID=sh.picompanion",
      "/repo/apps/android/maestro/smoke.yaml",
    ]);
  });

  it("passes the emulator-reachable address to the flow as env vars", () => {
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);
    expect(plan.maestro.env).toEqual({
      DAEMON_HOST: "10.0.2.2",
      DAEMON_PORT: "54321",
      DAEMON_ADDRESS: "10.0.2.2:54321",
    });
  });

  it("refuses to build a plan whose endpoint names the production port", () => {
    const productionEndpoint: IsolatedDaemonEndpoint = {
      ...SAFE_ENDPOINT,
      port: 6767,
      listenAddress: "127.0.0.1:6767",
      emulatorAddress: "10.0.2.2:6767",
    };

    expect(() =>
      buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", productionEndpoint),
    ).toThrow(/6767/);
  });

  it("does not throw for a non-production endpoint (the refusal is specific to 6767, not a false positive)", () => {
    expect(() =>
      buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT),
    ).not.toThrow();
  });
});
