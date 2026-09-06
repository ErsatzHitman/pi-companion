import { describe, expect, it } from "vitest";

import { combineRunExitCode, daemonFailedToBoot } from "./daemon-exit-policy.js";

describe("daemonFailedToBoot", () => {
  it("fails on a spawn-time error, the pre-T207 behavior", () => {
    expect(daemonFailedToBoot({ hadSpawnError: true, exitCodeAtBootCheck: null })).toBe(true);
  });

  it("fails when the daemon already exited non-zero by the boot check (the MODULE_NOT_FOUND case F4 closes)", () => {
    expect(daemonFailedToBoot({ hadSpawnError: false, exitCodeAtBootCheck: 1 })).toBe(true);
  });

  it("does not fail while the daemon is still running (the healthy case)", () => {
    expect(daemonFailedToBoot({ hadSpawnError: false, exitCodeAtBootCheck: null })).toBe(false);
  });

  it("does not fail on neither signal present", () => {
    expect(daemonFailedToBoot({ hadSpawnError: false, exitCodeAtBootCheck: 0 })).toBe(false);
  });
});

describe("combineRunExitCode", () => {
  it("passes through a genuine Maestro failure regardless of the daemon", () => {
    expect(combineRunExitCode(1, null)).toBe(1);
    expect(combineRunExitCode(1, 0)).toBe(1);
  });

  it("fails the run when the daemon crashed non-zero during the run even though Maestro exited 0", () => {
    expect(combineRunExitCode(0, 1)).toBe(1);
  });

  it("succeeds when Maestro exited 0 and the daemon never crashed (still running, or exited 0)", () => {
    expect(combineRunExitCode(0, null)).toBe(0);
    expect(combineRunExitCode(0, 0)).toBe(0);
  });
});
