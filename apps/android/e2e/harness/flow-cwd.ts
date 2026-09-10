/**
 * T334 — one fresh, host-side working directory per flow run, handed to
 * the flow as the `${FLOW_CWD}` variable (`run-plan.ts` adds it to the
 * `maestro test` argv as `-e FLOW_CWD=...`, the same way `${APP_ID}` and
 * `${DAEMON_ADDRESS}` reach a flow).
 *
 * Why a flow cannot just type a path: the daemon refuses to create an
 * agent whose `cwd` does not exist on the HOST (`packages/server/src/
 * server/agent/agent-manager.ts`: "Working directory does not exist"),
 * and the emulator has no view of the host's filesystem. Maestro run
 * 34462826449's `cold-start-restore` typed `/tmp/picompanion-cold-start-
 * restore` into the "New session" form -- a directory nothing had made
 * -- and got the create-error banner for it. Hardcoding one would also
 * break the flow-independence rule in `../../maestro/README.md`: two
 * flows (or two runs of one) would share state through it. `mkdtemp`
 * gives every run its own, the same way `daemon-endpoint.ts` gives every
 * run its own `PASEO_HOME`.
 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const FLOW_CWD_PREFIX = "picompanion-maestro-cwd-";

/** The flow-name fragment folded into the directory name: lowercase letters, digits and hyphens only. */
export function flowCwdSlug(flowName: string): string {
  const slug = flowName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "flow";
}

export async function createFlowCwd(
  flowName: string,
  tmpdir: string = os.tmpdir(),
): Promise<string> {
  return mkdtemp(path.join(tmpdir, `${FLOW_CWD_PREFIX}${flowCwdSlug(flowName)}-`));
}
