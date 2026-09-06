/**
 * T37D — the one fact every Maestro flow and every piece of this harness
 * must agree on: port `6767` is the owner's real, running production
 * daemon (plan.md §15.1). A flow that reached it would act on real
 * sessions on the owner's machine.
 *
 * This constant and the two functions below are the single place that
 * knows the number `6767`. `daemon-endpoint.ts` calls
 * `assertNotProductionDaemonPort` on every port it hands back before
 * returning it, `run-plan.ts` calls it again on the resolved endpoint
 * before turning it into a daemon-start command line, and
 * `scripts/ci/guard-no-production-daemon-port.mjs` enforces the same
 * number can never appear inside `apps/android/maestro/*.yaml` at all —
 * three independent checks against one shared constant, so a future edit
 * to any one of them can't quietly drift the "forbidden port" definition
 * out of sync with the others.
 */

export const PRODUCTION_DAEMON_PORT = 6767;

export function isProductionDaemonPort(port: number): boolean {
  return port === PRODUCTION_DAEMON_PORT;
}

/**
 * Throws when `port` is the production daemon's port. `context` is folded
 * into the error message so a thrown refusal always says *where* it was
 * caught (e.g. "allocated ephemeral daemon port", "resolved run-plan
 * daemon port") rather than just repeating the number.
 */
export function assertNotProductionDaemonPort(port: number, context: string): void {
  if (isProductionDaemonPort(port)) {
    throw new Error(
      `Refusing to target the production daemon port ${PRODUCTION_DAEMON_PORT} (${context}). ` +
        "Maestro flows must run against an isolated daemon with its own home directory — see apps/android/maestro/README.md.",
    );
  }
}
