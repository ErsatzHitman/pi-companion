/**
 * T207 (folding in the P8-W10 merge gate's F4) — `run-flow.ts` used to
 * decide whether the isolated daemon started correctly by inspecting only
 * the spawned child's `error` event, which node's `child_process` emits
 * for a spawn-time failure (e.g. `ENOENT`) but never for a process that
 * spawned fine and then exited on its own — exactly what happens when
 * `packages/cli/bin/paseo`'s `import '../dist/index.js'` throws
 * `MODULE_NOT_FOUND` because nothing built `@picompanion/cli` first. That
 * left a dead daemon silently tolerated: Maestro would run against a
 * daemon that was never listening, and the harness reported whatever
 * Maestro happened to do about it, never "the daemon never started."
 *
 * These two functions are the decision `run-flow.ts` now makes, pulled out
 * pure and side-effect-free (mirrors `run-plan.ts`'s own reasoning for
 * staying spawn-free) so `daemon-exit-policy.test.ts` can prove both
 * directions without spawning a real process, an emulator, or Maestro.
 */

export interface DaemonBootCheckInput {
  /** Whether the child's `error` event fired (a spawn-time failure, e.g. ENOENT). */
  hadSpawnError: boolean;
  /**
   * The daemon child's exit code, if it had already exited by the time the
   * boot-delay check runs. `null` means it is still running, which is the
   * healthy case for a `--foreground` daemon.
   */
  exitCodeAtBootCheck: number | null;
}

/**
 * Whether the isolated daemon failed to come up cleanly, checked once
 * after `DAEMON_BOOT_DELAY_MS` has elapsed and before Maestro is ever
 * invoked. True for a spawn-time error (the pre-T207 check) OR a daemon
 * that already exited non-zero in that window (the gap T207 closes) — a
 * daemon that is still running (`exitCodeAtBootCheck: null`) or that
 * somehow already exited 0 is left alone; a `--foreground` daemon exiting
 * 0 unprompted this early is not a documented shape this harness produces,
 * so it is not asserted on here.
 */
export function daemonFailedToBoot(input: DaemonBootCheckInput): boolean {
  return (
    input.hadSpawnError || (input.exitCodeAtBootCheck !== null && input.exitCodeAtBootCheck !== 0)
  );
}

/**
 * Combines Maestro's own exit code with whatever the isolated daemon did
 * during (or by the end of) the run. A daemon that crashed non-zero partway
 * through — after the boot check passed, so `daemonFailedToBoot` never saw
 * it — must still fail the run even if Maestro itself happened to exit 0
 * (e.g. it finished its assertions just before the daemon died). A healthy
 * or still-running daemon (`exitCodeAtEnd: null` or `0`) never overrides a
 * genuine Maestro failure or success.
 */
export function combineRunExitCode(
  maestroExitCode: number,
  daemonExitCodeAtEnd: number | null,
): number {
  if (maestroExitCode !== 0) return maestroExitCode;
  if (daemonExitCodeAtEnd !== null && daemonExitCodeAtEnd !== 0) return 1;
  return 0;
}
