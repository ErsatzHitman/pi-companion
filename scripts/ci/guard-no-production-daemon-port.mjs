// T37D: CI guard — no file under `apps/android/maestro/` (Maestro flow or
// workspace config) may name the production daemon port `6767`, in any
// form, including a comment. Port 6767 is the owner's real, running
// production daemon (plan.md §15.1); a flow that reached it would act on
// real sessions on the owner's machine. See
// `apps/android/maestro/README.md`'s "Isolation" section for the other two
// (in-code) checks this one backs up, and
// `apps/android/e2e/harness/production-daemon-port.ts` for the shared
// constant they all point back to.
//
// `README.md` is excluded on purpose — it has to explain the rule in
// prose, so it is the one file in this directory allowed to write the
// number `6767`.
//
// Pure, dependency-free check function only. `run-guard-no-production-
// daemon-port.mjs` is the CLI entry point CI actually runs; this module
// stays import-safe so `guard-no-production-daemon-port.test.mjs` can seed
// fixtures without touching the real working tree.

const MAESTRO_PREFIX = "apps/android/maestro/";
const PRODUCTION_DAEMON_PORT = "6767";
const EXCLUDED_BASENAME = "README.md";

/**
 * @param {{ path: string, content: string }[]} files repo-relative paths
 *   (forward slashes) paired with their file content
 * @returns {string[]} paths under apps/android/maestro/ (excluding
 *   README.md) whose content names the production daemon port
 */
export function findProductionDaemonPortViolations(files) {
  return files
    .filter(({ path }) => path.startsWith(MAESTRO_PREFIX))
    .filter(({ path }) => !path.endsWith(`/${EXCLUDED_BASENAME}`) && path !== EXCLUDED_BASENAME)
    .filter(({ content }) => content.includes(PRODUCTION_DAEMON_PORT))
    .map(({ path }) => path);
}
