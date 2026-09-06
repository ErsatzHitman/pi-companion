/**
 * T31A acceptance: "a guard fails the run if port 6767 is ever
 * targeted." Proving that means exercising the guard's predicate and
 * its violation bookkeeping directly (`createProductionPortGuard`) —
 * NOT by actually issuing a request at port 6767, which this whole
 * harness must never do (real production daemon; see plan.md §15.1
 * and this suite's other specs' shared rule).
 */
import { expect, test } from "@playwright/test";

import {
  PRODUCTION_DAEMON_PORT,
  createProductionPortGuard,
  targetsProductionDaemonPort,
} from "./fixtures/production-port-guard.js";

test.describe("production port guard", () => {
  test("flags an absolute URL that targets the production daemon port", () => {
    expect(
      targetsProductionDaemonPort(`http://127.0.0.1:${PRODUCTION_DAEMON_PORT}/api/health`),
    ).toBe(true);
    expect(targetsProductionDaemonPort(`ws://localhost:${PRODUCTION_DAEMON_PORT}/`)).toBe(true);
    // Any host, not just loopback — a relay-fronted URL is just as
    // dangerous a target as a direct one.
    expect(targetsProductionDaemonPort(`https://example.com:${PRODUCTION_DAEMON_PORT}/`)).toBe(
      true,
    );
  });

  test("does not flag the harness's own isolated ports or a bare origin", () => {
    expect(targetsProductionDaemonPort("http://127.0.0.1:54123/api/health")).toBe(false);
    expect(targetsProductionDaemonPort("http://127.0.0.1/api/health")).toBe(false);
    expect(targetsProductionDaemonPort("about:blank")).toBe(false);
    expect(targetsProductionDaemonPort("not a url")).toBe(false);
  });

  test("createProductionPortGuard collects violations and throws only when one occurred", () => {
    const clean = createProductionPortGuard();
    clean.observe("http://127.0.0.1:54123/api/health");
    expect(clean.violations).toEqual([]);
    expect(() => clean.assertClean()).not.toThrow();

    const dirty = createProductionPortGuard();
    dirty.observe(`http://127.0.0.1:${PRODUCTION_DAEMON_PORT}/api/health`);
    expect(dirty.violations).toEqual([`http://127.0.0.1:${PRODUCTION_DAEMON_PORT}/api/health`]);
    expect(() => dirty.assertClean()).toThrow(/6767/);
  });
});
