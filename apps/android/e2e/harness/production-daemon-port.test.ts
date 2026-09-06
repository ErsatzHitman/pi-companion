import { describe, expect, it } from "vitest";

import {
  PRODUCTION_DAEMON_PORT,
  assertNotProductionDaemonPort,
  isProductionDaemonPort,
} from "./production-daemon-port.js";

describe("production-daemon-port", () => {
  it("names 6767 as the production daemon port", () => {
    expect(PRODUCTION_DAEMON_PORT).toBe(6767);
  });

  it("isProductionDaemonPort is true only for 6767", () => {
    expect(isProductionDaemonPort(6767)).toBe(true);
    expect(isProductionDaemonPort(6768)).toBe(false);
    expect(isProductionDaemonPort(0)).toBe(false);
    expect(isProductionDaemonPort(65535)).toBe(false);
  });

  it("assertNotProductionDaemonPort throws on 6767, naming the port and the context", () => {
    expect(() => assertNotProductionDaemonPort(6767, "a fixture check")).toThrow(
      /6767.*a fixture check/s,
    );
  });

  it("assertNotProductionDaemonPort does not throw on a non-production port", () => {
    expect(() => assertNotProductionDaemonPort(54321, "a fixture check")).not.toThrow();
  });
});
