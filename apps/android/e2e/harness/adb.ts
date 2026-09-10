/**
 * T329 — the two ways this harness runs an external command, shared by
 * `run-shard.ts` and `prepare-device.ts` so neither carries its own copy.
 *
 * `runCommand` inherits stdio (the child's output lands in the job log)
 * and resolves to the exit code; `captureCommand` collects stdout+stderr
 * into a string and never rejects — a command that cannot even be spawned
 * resolves to a `<failed to run ...>` marker instead, because every caller
 * uses the text diagnostically (a device log, a UI dump) and a missing
 * `adb` should read as "no dump", not crash the shard.
 */
import { spawn } from "node:child_process";

import type { DeviceCommands } from "./device-prep.js";

export function runCommand(command: string, argv: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { stdio: "inherit", cwd, shell: false });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export function captureCommand(command: string, argv: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd, shell: false });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.once("error", (error) => resolve(`<failed to run ${command}: ${String(error)}>`));
    child.once("close", () => resolve(out));
  });
}

/** The real `adb`, in the shape `prepareDevice` consumes. */
export function adbDeviceCommands(cwd: string): DeviceCommands {
  return {
    run: (argv) => runCommand("adb", argv, cwd),
    capture: (argv) => captureCommand("adb", argv, cwd),
    log: (message) => console.log(message),
  };
}
