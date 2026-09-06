import { describe, expect, it } from "vitest";

import { runBounded } from "./bounded-runner.js";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runBounded", () => {
  it("resolves with the real exit code of a process that finishes on its own", async () => {
    const result = await runBounded(process.execPath, ["-e", "process.exit(7)"], {
      timeoutMs: 10_000,
    });

    expect(result.code).toBe(7);
    expect(result.timedOut).toBe(false);
  });

  it("captures stdout through onOutput", async () => {
    const chunks: string[] = [];
    const result = await runBounded(
      process.execPath,
      ["-e", "process.stdout.write('hello-from-bounded-runner')"],
      {
        timeoutMs: 10_000,
        onOutput: (chunk, stream) => {
          if (stream === "stdout") chunks.push(chunk);
        },
      },
    );

    expect(result.code).toBe(0);
    expect(chunks.join("")).toContain("hello-from-bounded-runner");
  });

  it("kills a hung process tree once the wall-clock bound is exceeded, rather than waiting forever", async () => {
    // Writes its own pid to stdout, then loops forever — proves both that the
    // timeout actually fires (this test itself has vitest's 30s bound and
    // would fail it if runBounded silently waited) and that the specific
    // process is gone afterward, not just that runBounded gave up on it.
    const script = "process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);";
    let capturedPid = "";

    const result = await runBounded(process.execPath, ["-e", script], {
      timeoutMs: 200,
      onOutput: (chunk, stream) => {
        if (stream === "stdout") capturedPid += chunk;
      },
    });

    expect(result.timedOut).toBe(true);

    const pid = Number(capturedPid.trim());
    expect(Number.isInteger(pid)).toBe(true);

    // Give the graceful/force signal a moment to actually land.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(isPidAlive(pid)).toBe(false);
  });

  it("rejects when the command itself cannot be spawned", async () => {
    await expect(
      runBounded("picompanion-this-binary-does-not-exist", [], { timeoutMs: 5_000 }),
    ).rejects.toThrow();
  });
});
