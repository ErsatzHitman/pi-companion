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
 *
 * T334 — `flowCwd`, when given, travels the same way as `-e FLOW_CWD=`:
 * the host-side working directory `flow-cwd.ts` minted for this run, which
 * a flow types into the "New session" form as `${FLOW_CWD}` (the daemon
 * refuses a `cwd` that does not exist on the host). Optional so every
 * caller that predates it builds a byte-identical plan.
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

/**
 * Milliseconds Maestro may spend waiting for its own Android driver to come
 * up on the device, as a string because it reaches Maestro through the
 * environment. Maestro's default is short enough that a cold CI emulator
 * misses it every time — see the note beside its use below.
 *
 * Two minutes rather than four, deliberately. Maestro retries driver
 * startup, so this is a per-ATTEMPT budget and the total is a multiple of
 * it: run 34413092055 spent 187s failing, which reads as three attempts on
 * roughly a 60s default. At four minutes a shard whose flows both fail
 * would need about 41 of its 45 allotted minutes, and a slow boot would
 * push it over — losing the whole cycle to a timeout kill AND the result.
 * Two minutes doubles the budget while keeping a failing shard near 29.
 */
const DEFAULT_DRIVER_STARTUP_TIMEOUT_MS = "120000";

export function buildRunPlan(
  flowName: string,
  flowPath: string,
  endpoint: IsolatedDaemonEndpoint,
  appId: string = DEFAULT_APP_ID,
  flowCwd?: string,
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
      // T321: `daemon stop`, not `stop`. Bare `stop` is the AGENT stop
      // command (packages/cli/src/commands/agent/stop.ts) and has no
      // `--home`, so every flow ended with `error: unknown option '--home'
      // (Did you mean --host?)` and left its daemon running. Two orphans per
      // shard then logged every 30s and held the CI job open until its
      // 45-minute timeout, long after the step itself had exited 1
      // (Maestro run 34413092055). The daemon-scoped command
      // (packages/cli/src/commands/daemon/index.ts) is the one that takes
      // `--home` and `--force`.
      stopArgv: ["daemon", "stop", "--home", endpoint.paseoHome, "--force"],
    },
    maestro: {
      // T328: every `${DAEMON_*}` a flow reads is passed as a `-e` flow
      // variable, the same way `APP_ID` always was. Maestro does not read
      // arbitrary shell environment variables into `${...}` substitution:
      // run 34442086730 — the first dispatch to reach the connect form —
      // typed `ws://undefined` into it in eight of ten flows, with the
      // very same values sitting in the child's environment below.
      // `env` keeps `MAESTRO_DRIVER_STARTUP_TIMEOUT`, which IS a real
      // environment variable the Maestro CLI itself reads (T321).
      argv: [
        "test",
        "-e",
        `APP_ID=${appId}`,
        "-e",
        `DAEMON_HOST=${emulatorHost ?? ""}`,
        "-e",
        `DAEMON_PORT=${emulatorPort ?? ""}`,
        "-e",
        `DAEMON_ADDRESS=${endpoint.emulatorAddress}`,
        // T334: the per-run working directory, as a flow variable for the
        // same reason as the DAEMON_* trio above.
        ...(flowCwd === undefined ? [] : ["-e", `FLOW_CWD=${flowCwd}`]),
        flowPath,
      ],
      env: {
        DAEMON_HOST: emulatorHost ?? "",
        DAEMON_PORT: emulatorPort ?? "",
        DAEMON_ADDRESS: endpoint.emulatorAddress,
        ...(flowCwd === undefined ? {} : { FLOW_CWD: flowCwd }),
        // T321: Maestro installs its own driver APK on the device and waits
        // for it to answer on a local port. Its default budget is far too
        // short for a cold CI emulator: every flow of Maestro run
        // 34413092055 died with
        // `Maestro Android driver did not start up in time on emulator
        // [ emulator-5554 ] (driver port 34555)` after the emulator itself
        // had taken 8 minutes to boot. Overridable, so a fast local device
        // is not forced to wait and a slower CI runner can be given more.
        MAESTRO_DRIVER_STARTUP_TIMEOUT:
          process.env["MAESTRO_DRIVER_STARTUP_TIMEOUT"] ?? DEFAULT_DRIVER_STARTUP_TIMEOUT_MS,
      },
    },
  };
}
