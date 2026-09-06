/**
 * T101 — wall-clock-bounded child process execution for the server
 * e2e/integration sandbox runner.
 *
 * The e2e/integration lanes spawn real daemon and terminal processes; a hang
 * in any of them must never become an unbounded wait for whoever invokes the
 * lane (a human, or a future CI job). `runBounded` starts a command, and if
 * it has not exited on its own by `timeoutMs`, kills the *entire* process
 * tree (not just the immediate child) using this repository's existing
 * `terminateWithTreeKill` helper (`src/utils/tree-kill.ts`, already used by
 * `bootstrap.ts` and the agent providers) and reports `timedOut: true` rather
 * than leaving the caller to guess from a bare non-zero exit code.
 */
import { spawn } from "node:child_process";

import { terminateWithTreeKill } from "../../src/utils/tree-kill.js";

export interface BoundedRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

export interface BoundedRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Hard wall-clock bound in milliseconds. Exceeding it kills the process tree. */
  timeoutMs: number;
  /** Set true only for commands that require shell resolution (e.g. `npm` on Windows). */
  shell?: boolean;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

const GRACEFUL_TIMEOUT_MS = 5_000;
const FORCE_TIMEOUT_MS = 5_000;

export async function runBounded(
  command: string,
  args: string[],
  options: BoundedRunOptions,
): Promise<BoundedRunResult> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell ?? false,
    });

    let timedOut = false;
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      void terminateWithTreeKill(child, {
        gracefulTimeoutMs: GRACEFUL_TIMEOUT_MS,
        forceTimeoutMs: FORCE_TIMEOUT_MS,
      });
    }, options.timeoutMs);
    timeoutHandle.unref();

    child.stdout?.on("data", (chunk: Buffer) => options.onOutput?.(chunk.toString(), "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => options.onOutput?.(chunk.toString(), "stderr"));

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve({ code, signal, timedOut, durationMs: Date.now() - start });
    });
  });
}
