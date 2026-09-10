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
    expect(plan.daemon.stopArgv).toEqual([
      "daemon",
      "stop",
      "--home",
      SAFE_ENDPOINT.paseoHome,
      "--force",
    ]);
  });

  it("T321: the stop argv targets the DAEMON, not an agent — bare `stop` has no --home", () => {
    // This assertion pinned the defect rather than the behaviour until
    // T321: it expected `["stop", ...]`, which is
    // packages/cli/src/commands/agent/stop.ts and rejects `--home` with
    // `error: unknown option '--home' (Did you mean --host?)`. Every flow
    // therefore left its isolated daemon running, and two orphans per shard
    // held Maestro run 34413092055's jobs open until their 45-minute
    // timeout. A green unit test could never have caught it, because the
    // test asserted the wrong argv too — only a real run could.
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);

    expect(plan.daemon.stopArgv[0]).toBe("daemon");
    expect(plan.daemon.stopArgv).toContain("--home");
    expect(plan.daemon.stopArgv).toContain(SAFE_ENDPOINT.paseoHome);
  });

  it("T321: maestro is given a driver-startup budget a cold CI emulator can meet", () => {
    // Maestro installs its own driver APK and waits for it to answer on a
    // local port. Its default budget is short enough that every flow of run
    // 34413092055 died with `Maestro Android driver did not start up in
    // time on emulator [ emulator-5554 ]`, after the emulator itself had
    // taken 8 minutes to boot.
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);

    const budget = Number(plan.maestro.env["MAESTRO_DRIVER_STARTUP_TIMEOUT"]);
    expect(Number.isFinite(budget)).toBe(true);
    expect(budget).toBeGreaterThanOrEqual(120_000);
  });

  it("builds a maestro argv naming the resolved flow path and the default appId override", () => {
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);
    expect(plan.maestro.argv).toEqual([
      "test",
      "-e",
      `APP_ID=${DEFAULT_APP_ID}`,
      "-e",
      "DAEMON_HOST=10.0.2.2",
      "-e",
      "DAEMON_PORT=54321",
      "-e",
      "DAEMON_ADDRESS=10.0.2.2:54321",
      "/repo/apps/android/maestro/smoke.yaml",
    ]);
  });

  it("T328: every DAEMON_* value a flow reads is a -e flow variable, not only a child env var", () => {
    // Maestro substitutes `${DAEMON_ADDRESS}` from `-e` flow variables; it
    // does not read arbitrary shell environment variables. Run 34442086730
    // typed `ws://undefined` into the connect form in eight of ten flows
    // with these exact values present in the child's environment.
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);
    const flowVariables = plan.maestro.argv
      .map((arg, index) => (plan.maestro.argv[index - 1] === "-e" ? arg : null))
      .filter((arg): arg is string => arg !== null);
    expect(flowVariables).toEqual(
      expect.arrayContaining([
        "DAEMON_HOST=10.0.2.2",
        "DAEMON_PORT=54321",
        "DAEMON_ADDRESS=10.0.2.2:54321",
      ]),
    );
    // And every one of them agrees with the env copy the harness also sets.
    for (const name of ["DAEMON_HOST", "DAEMON_PORT", "DAEMON_ADDRESS"] as const) {
      expect(flowVariables).toContain(`${name}=${plan.maestro.env[name]}`);
    }
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
      "-e",
      "DAEMON_HOST=10.0.2.2",
      "-e",
      "DAEMON_PORT=54321",
      "-e",
      "DAEMON_ADDRESS=10.0.2.2:54321",
      "/repo/apps/android/maestro/smoke.yaml",
    ]);
  });

  it("passes the emulator-reachable address to the flow as env vars", () => {
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);
    // The three address vars are asserted exactly; T321's driver-startup
    // budget is asserted separately above, because it is a Maestro tuning
    // knob rather than something a flow reads.
    expect({
      DAEMON_HOST: plan.maestro.env["DAEMON_HOST"],
      DAEMON_PORT: plan.maestro.env["DAEMON_PORT"],
      DAEMON_ADDRESS: plan.maestro.env["DAEMON_ADDRESS"],
    }).toEqual({
      DAEMON_HOST: "10.0.2.2",
      DAEMON_PORT: "54321",
      DAEMON_ADDRESS: "10.0.2.2:54321",
    });
    expect(Object.keys(plan.maestro.env).sort()).toEqual([
      "DAEMON_ADDRESS",
      "DAEMON_HOST",
      "DAEMON_PORT",
      "MAESTRO_DRIVER_STARTUP_TIMEOUT",
    ]);
  });

  it("T334: a flowCwd becomes the -e FLOW_CWD flow variable (and env copy), placed before the flow path", () => {
    // Run 34462826449: `cold-start-restore` typed a host path nothing had
    // created into the "New session" form and the daemon refused the
    // session. The harness now mints the directory and hands it to the
    // flow as `${FLOW_CWD}`, through `-e` like every other variable a
    // flow reads (T328).
    const plan = buildRunPlan(
      "cold-start-restore",
      "/repo/apps/android/maestro/cold-start-restore.yaml",
      SAFE_ENDPOINT,
      undefined,
      "/tmp/picompanion-maestro-cwd-cold-start-restore-XYZ",
    );
    expect(plan.maestro.argv).toEqual([
      "test",
      "-e",
      `APP_ID=${DEFAULT_APP_ID}`,
      "-e",
      "DAEMON_HOST=10.0.2.2",
      "-e",
      "DAEMON_PORT=54321",
      "-e",
      "DAEMON_ADDRESS=10.0.2.2:54321",
      "-e",
      "FLOW_CWD=/tmp/picompanion-maestro-cwd-cold-start-restore-XYZ",
      "/repo/apps/android/maestro/cold-start-restore.yaml",
    ]);
    expect(plan.maestro.env["FLOW_CWD"]).toBe(
      "/tmp/picompanion-maestro-cwd-cold-start-restore-XYZ",
    );
  });

  it("T334: without a flowCwd the plan is unchanged -- no FLOW_CWD flag, no FLOW_CWD env", () => {
    const plan = buildRunPlan("smoke", "/repo/apps/android/maestro/smoke.yaml", SAFE_ENDPOINT);
    expect(plan.maestro.argv.some((arg) => arg.startsWith("FLOW_CWD="))).toBe(false);
    expect("FLOW_CWD" in plan.maestro.env).toBe(false);
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
