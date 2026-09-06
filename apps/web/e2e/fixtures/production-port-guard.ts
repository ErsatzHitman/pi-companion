/**
 * The T31A "port 6767 guard": a pure predicate over a request URL,
 * plus the `Request`-shaped structural type it needs, so it can be
 * unit-asserted (`../production-port-guard.spec.ts`) without ever
 * issuing a real request at the production daemon — this harness must
 * NEVER touch port 6767, so proving the guard works cannot itself
 * dial that port. `test.ts` wires this predicate into every browser
 * context's `request` event as an auto-fixture.
 */
import { PRODUCTION_DAEMON_PORT } from "./ports.js";

export { PRODUCTION_DAEMON_PORT };

/** True when `url` explicitly targets the production daemon port, on any host. */
export function targetsProductionDaemonPort(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not an absolute URL (e.g. "about:blank", a data: URI) — never the
    // production daemon.
    return false;
  }
  if (!parsed.port) {
    return false;
  }
  return Number(parsed.port) === PRODUCTION_DAEMON_PORT;
}

export interface ProductionPortGuard {
  /** Records one observed request URL; call from a `request` event handler. */
  observe: (url: string) => void;
  /** URLs observed so far that targeted the production daemon port. */
  violations: readonly string[];
  /** Throws if any observed URL targeted the production daemon port. */
  assertClean: () => void;
}

/** Stateful guard used by `test.ts`'s auto-fixture across one test's requests. */
export function createProductionPortGuard(): ProductionPortGuard {
  const violations: string[] = [];
  return {
    observe(url: string): void {
      if (targetsProductionDaemonPort(url)) {
        violations.push(url);
      }
    },
    violations,
    assertClean(): void {
      if (violations.length > 0) {
        throw new Error(
          `Production daemon port ${PRODUCTION_DAEMON_PORT} was targeted during this test: ${violations.join(", ")}`,
        );
      }
    },
  };
}
