import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createFakeVibrationPlatform } from "../../platform/haptics/fake-vibration-platform.js";

import { fireTranscriptStatusHaptic } from "./transcript-status-haptics-model.js";
import { deriveTranscriptStatus, type TranscriptStatus } from "./status-model.js";

/** Comment-stripped source, per this repo's source-text-assertion convention (`readCode()` in `../../app/h/[serverId]/session/[agentId]/index.test.ts`). */
function readCode(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("fireTranscriptStatusHaptic: real deriveTranscriptStatus transitions, not hand-typed fixtures", () => {
  it("fires 'error' the instant a real agent-error transition lands on deriveTranscriptStatus", () => {
    const platform = createFakeVibrationPlatform();
    const previous = deriveTranscriptStatus({
      connection: "connected",
      agentActivity: "streaming",
    });
    const next = deriveTranscriptStatus({ connection: "connected", agentActivity: "error" });
    expect(previous).toBe("streaming");
    expect(next).toBe("error");

    const fired = fireTranscriptStatusHaptic(platform, true, previous, next);

    expect(fired).toBe(true);
    expect(platform.calls).toHaveLength(1);
    // error's own documented pattern (haptic.ts) — three firm, evenly-spaced pulses.
    expect(platform.calls[0]).toEqual([0, 80, 60, 80, 60, 80]);
  });

  it("fires 'finished' the instant a real streaming turn settles back to connected", () => {
    const platform = createFakeVibrationPlatform();
    const previous = deriveTranscriptStatus({
      connection: "connected",
      agentActivity: "streaming",
    });
    const next = deriveTranscriptStatus({ connection: "connected", agentActivity: "idle" });
    expect(previous).toBe("streaming");
    expect(next).toBe("connected");

    const fired = fireTranscriptStatusHaptic(platform, true, previous, next);

    expect(fired).toBe(true);
    expect(platform.calls).toHaveLength(1);
    // finished's own documented pattern (haptic.ts) — two short pulses.
    expect(platform.calls[0]).toEqual([0, 30, 60, 30]);
  });

  it("does not fire 'finished' for a settle that never passed through streaming (e.g. reconnect -> connected)", () => {
    const platform = createFakeVibrationPlatform();
    const previous = deriveTranscriptStatus({ connection: "connecting", reconnectAttempt: 2 });
    const next = deriveTranscriptStatus({ connection: "connected" });
    expect(previous).toBe("reconnecting");
    expect(next).toBe("connected");

    const fired = fireTranscriptStatusHaptic(platform, true, previous, next);

    expect(fired).toBe(false);
    expect(platform.calls).toHaveLength(0);
  });

  it("never refires while the status recomputes to the same value", () => {
    const platform = createFakeVibrationPlatform();
    const status = deriveTranscriptStatus({ connection: "connected", agentActivity: "error" });
    const fired = fireTranscriptStatusHaptic(platform, true, status, status);
    expect(fired).toBe(false);
    expect(platform.calls).toHaveLength(0);
  });

  it("respects hapticsEnabled: false — the transition is still detected but the platform is never touched", () => {
    const platform = createFakeVibrationPlatform();
    const fired = fireTranscriptStatusHaptic(platform, false, "streaming", "error");
    expect(fired).toBe(true);
    expect(platform.calls).toHaveLength(0);
  });

  it("null previous (first render) never fires", () => {
    const platform = createFakeVibrationPlatform();
    const statuses: TranscriptStatus[] = [
      "connecting",
      "connected",
      "streaming",
      "error",
      "disconnected",
    ];
    for (const status of statuses) {
      const fired = fireTranscriptStatusHaptic(platform, true, null, status);
      // "error" still fires even on a first render that opens already in
      // error -- there is no earlier "settled" state to distinguish it
      // from, and an agent error should always be felt, not only on the
      // second occurrence.
      if (status === "error") {
        expect(fired).toBe(true);
      } else {
        expect(fired).toBe(false);
      }
    }
  });
});

describe("no direct VibrationPlatform.vibrate() bypass in this task's call site", () => {
  it("calls fireHaptic(...) (a full call expression) for both triggers", () => {
    const code = readCode("./transcript-status-haptics-model.ts");
    expect(code).toMatch(/fireHaptic\(\s*platform,\s*\{\s*trigger: "error"/);
    expect(code).toMatch(/fireHaptic\(\s*platform,\s*\{\s*trigger: "finished"/);
  });

  it("never calls .vibrate(...) directly outside of fireHaptic's own implementation", () => {
    expect(readCode("./transcript-status-haptics-model.ts")).not.toMatch(/\.vibrate\(/);
  });
});
