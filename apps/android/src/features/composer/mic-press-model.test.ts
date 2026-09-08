import { describe, expect, it } from "vitest";

import type { PermissionState } from "./permission-recovery";
import { runMicPress } from "./mic-press-model";
import { createVoiceCaptureController } from "../voice/voice-model";
import type { VoiceCaptureOutcome, VoiceCapturePort } from "../voice/voice-capture-port";

/**
 * T83: proves `runMicPress` — the function `Composer.tsx`'s
 * `handleMicPress` now delegates to entirely — resolves microphone
 * permission EXACTLY ONCE per press, against the real, production
 * `createVoiceCaptureController` (`../voice/voice-model.ts`), not a
 * further fake standing in for it. This is the counting fake T83's
 * brief asks for: every `VoiceCapturePort` call `resolvePermission`
 * could reach is counted, so "one resolution" is a fact about calls
 * actually made, not about a registration existing.
 *
 * See `mic-press-model.ts`'s header for the exact bug this replaces:
 * before this task, `Composer.tsx` resolved permission a SECOND time
 * itself (`resolvePermission(resolvedMicPermission)`, a separate port)
 * before ever reaching this controller. That call site is gone; this
 * file cannot see `Composer.tsx`'s source directly (the RN-in-vitest
 * limitation — see this module's header), so
 * `attachment-wiring.test.ts` and `composer-voice-wiring.test.ts` carry
 * the source-text half of this proof (mutation-checked there per their
 * own headers). This file carries the behavioural half: were a second
 * call reintroduced ANYWHERE in the path this function drives, the
 * counting fake below would catch it.
 */

function createCountingPort(options?: {
  permission?: PermissionState;
  stopResult?: VoiceCaptureOutcome;
}): VoiceCapturePort & {
  calls: { getPermissionStatus: number; requestPermission: number; start: number; stop: number };
} {
  const calls = { getPermissionStatus: 0, requestPermission: 0, start: 0, stop: 0 };
  const permission = options?.permission ?? "granted";
  const stopResult: VoiceCaptureOutcome = options?.stopResult ?? {
    kind: "transcript",
    text: "add tests for the login handler",
  };
  return {
    calls,
    async getPermissionStatus() {
      calls.getPermissionStatus += 1;
      return permission;
    },
    async requestPermission() {
      calls.requestPermission += 1;
      return permission;
    },
    async start() {
      calls.start += 1;
    },
    async stop() {
      calls.stop += 1;
      return stopResult;
    },
    async cancel() {
      // not exercised by this file — requestStop is what a mic press uses to end a recording.
    },
  };
}

function makeController(port: ReturnType<typeof createCountingPort>) {
  return createVoiceCaptureController({ port });
}

describe("runMicPress resolves microphone permission exactly once per press (T83)", () => {
  it("a start press (granted permission) reads the port's permission exactly once, never twice", async () => {
    const port = createCountingPort({ permission: "granted" });
    const controller = makeController(port);

    const result = await runMicPress(controller);

    expect(port.calls.getPermissionStatus).toBe(1);
    expect(port.calls.requestPermission).toBe(0);
    expect(result.voiceState.status).toBe("recording");
    expect(result.micPermissionState).toBeNull();
  });

  it("a start press (undetermined -> prompts once) still totals exactly one resolution, not two", async () => {
    const port = createCountingPort({ permission: "undetermined" });
    const controller = makeController(port);

    await runMicPress(controller);

    // resolvePermission reads once, and — because the read came back
    // undetermined — prompts once. That is ONE resolution (one logical
    // "ask the OS" round trip), never a second, independent one from a
    // different port object, which is exactly what the pre-T83 bug did.
    expect(port.calls.getPermissionStatus).toBe(1);
    expect(port.calls.requestPermission).toBe(1);
  });

  it("a denied start press surfaces the denial and never calls port.start()", async () => {
    const port = createCountingPort({ permission: "denied" });
    const controller = makeController(port);

    const result = await runMicPress(controller);

    expect(port.calls.getPermissionStatus).toBe(1);
    expect(port.calls.start).toBe(0);
    expect(result.micPermissionState).toBe("denied");
    expect(result.voiceState.status).toBe("idle");
  });

  it("an unavailable port (this build's only production VoiceCapturePort) still renders through micPermissionState — the honest 'unavailable' path", async () => {
    const port = createCountingPort({ permission: "unavailable" });
    const controller = makeController(port);

    const result = await runMicPress(controller);

    expect(port.calls.getPermissionStatus).toBe(1);
    expect(result.micPermissionState).toBe("unavailable");
    expect(result.voiceOutcome).toBeNull();
  });

  it("a stop press (already recording) never touches permission at all — zero calls, not a second resolution", async () => {
    const port = createCountingPort({ permission: "granted" });
    const controller = makeController(port);

    await runMicPress(controller); // start
    expect(port.calls.getPermissionStatus).toBe(1);

    const result = await runMicPress(controller); // stop
    expect(port.calls.getPermissionStatus).toBe(1); // unchanged by the stop press
    expect(port.calls.stop).toBe(1);
    // T277: a finished transcript is a draft now, not a send — see
    // voice-model.ts's own header for the behaviour change.
    expect(result.voiceOutcome?.outcome).toBe("drafted");
    expect(result.micPermissionState).toBeNull();
  });
});

/**
 * MUTATION (documented per this repo's CLAUDE.md "a fix that no test
 * can fail is not a fix"): a second, independent permission read was
 * reintroduced ahead of `runMicPress` in a scratch copy of this
 * function — `await port.getPermissionStatus(); const result = await
 * runMicPress(controller);` — and the first assertion above
 * (`expect(port.calls.getPermissionStatus).toBe(1)`) was confirmed to
 * fail (`2 !== 1`) against that mutation before it was discarded. See
 * this task's final report for the exact diff and the real `vitest`
 * output for both the passing and failing runs.
 */
