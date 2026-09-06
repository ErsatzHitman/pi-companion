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
 *
 * T207 — every flow file's `appId:` line is the variable `${APP_ID}`
 * (`apps/android/maestro/*.yaml`), never a hardcoded package, because a
 * literal `appId: sh.picompanion.debug` can never launch on a job that
 * installs the packaged (`sh.picompanion`) build — the defect
 * `scripts/ci/guard-app-id-package-pairing.mjs` now guards against.
 * Maestro resolves `${APP_ID}` from the `-e APP_ID=<value>` flag this
 * module adds to the `maestro test` argv — the documented mechanism for
 * exactly this "appId varies by target" case (docs.maestro.dev's
 * "Parameters and constants" page: "To run a single test suite against
 * different platforms where the App ID varies, structure your Flow to
 * use a variable: `appId: ${APP_ID}`" paired with "use the `-e` or
 * `--env` flag to inject the correct identifier for that specific run:
 * `maestro test -e APP_ID=com.example.android flow.yaml`"), confirmed
 * before this shipped rather than assumed.
 */
import { assertNotProductionDaemonPort } from "./production-daemon-port.js";
import type { IsolatedDaemonEndpoint } from "./daemon-endpoint.js";

/**
 * The package `maestro-e2e` needs and always got before `appId` was
 * parameterized: `sh.picompanion.debug`, the `development` EAS profile's
 * package (`apps/android/eas.json`'s `APP_VARIANT: "development"`,
 * resolved by `apps/android/app.config.ts`). A caller that never passes
 * an explicit `appId` — exactly what `maestro-e2e`'s workflow step does —
 * gets this value, which is what makes parameterizing every flow's
 * `appId` behaviorally invisible to that job. `packaged-app-smoke`
 * overrides it explicitly to `sh.picompanion`.
 */
export const DEFAULT_APP_ID = "sh.picompanion.debug";

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
    /** argv for `maestro <these>`, including the `-e APP_ID=<appId>` override. */
    argv: string[];
    /** Extra env vars the flow reads via `${DAEMON_HOST}` / `${DAEMON_PORT}`. */
    env: Readonly<Record<string, string>>;
  };
}

export function buildRunPlan(
  flowName: string,
  flowPath: string,
  endpoint: IsolatedDaemonEndpoint,
  appId: string = DEFAULT_APP_ID,
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
      argv: ["test", "-e", `APP_ID=${appId}`, flowPath],
      env: {
        DAEMON_HOST: emulatorHost ?? "",
        DAEMON_PORT: emulatorPort ?? "",
        DAEMON_ADDRESS: endpoint.emulatorAddress,
      },
    },
  };
}
