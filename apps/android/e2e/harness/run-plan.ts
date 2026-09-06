/**
 * T37D — turns a resolved flow path and an isolated daemon endpoint into
 * the exact command lines `run-flow.ts` spawns: `paseo start`/`paseo
 * stop` (`packages/cli`'s bin, `packages/cli/bin/paseo` — see that
 * package's `commands/daemon/start.ts` for the flag set this mirrors)
 * and `maestro test`.
 *
 * Pure and side-effect-free on purpose: building the plan never spawns a
 * process or opens a socket, so `run-plan.test.ts` can assert on the
 * exact argv/env this harness would run — including that it is
 * *impossible* to build a plan whose daemon targets port 6767 — without
 * a daemon, an emulator, or Maestro installed.
 */
import { assertNotProductionDaemonPort } from "./production-daemon-port.js";
import type { IsolatedDaemonEndpoint } from "./daemon-endpoint.js";

export interface RunPlan {
  flowName: string;
  flowPath: string;
  daemon: {
    home: string;
    listenAddress: string;
    /** argv for `paseo <these>`, run in the foreground so the caller owns the child process. */
    startArgv: string[];
    /** argv for `paseo <these>`, run once after the flow finishes (or fails). */
    stopArgv: string[];
  };
  maestro: {
    /** argv for `maestro <these>`. */
    argv: string[];
    /** Extra env vars the flow reads via `${DAEMON_HOST}` / `${DAEMON_PORT}`. */
    env: Readonly<Record<string, string>>;
  };
}

export function buildRunPlan(
  flowName: string,
  flowPath: string,
  endpoint: IsolatedDaemonEndpoint,
): RunPlan {
  // Re-checked here, not just trusted from the caller: this is the last
  // point before the port and home directory turn into a command line, so
  // it is the point that must refuse to build a plan at all rather than
  // build one that happens to be safe.
  assertNotProductionDaemonPort(endpoint.port, "resolved run-plan daemon port");

  const [emulatorHost, emulatorPort] = endpoint.emulatorAddress.split(":");

  return {
    flowName,
    flowPath,
    daemon: {
      home: endpoint.paseoHome,
      listenAddress: endpoint.listenAddress,
      startArgv: [
        "start",
        "--listen",
        endpoint.listenAddress,
        "--home",
        endpoint.paseoHome,
        "--foreground",
        "--no-relay",
        "--no-web-ui",
        "--no-mcp",
      ],
      stopArgv: ["stop", "--home", endpoint.paseoHome, "--force"],
    },
    maestro: {
      argv: ["test", flowPath],
      env: {
        DAEMON_HOST: emulatorHost ?? "",
        DAEMON_PORT: emulatorPort ?? "",
        DAEMON_ADDRESS: endpoint.emulatorAddress,
      },
    },
  };
}
