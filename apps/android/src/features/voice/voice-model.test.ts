import { composer as coreComposer } from "@picompanion/frontend-core";
import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryStructuredStorage,
  createSystemClock,
} from "../composer/in-memory-outbox-runtime";
import { describePermissionRecovery, type PermissionState } from "../composer/permission-recovery";
import { createVoiceCaptureController, IDLE_VOICE_STATE } from "./voice-model";
import type { VoiceCaptureOutcome, VoiceCapturePort } from "./voice-capture-port";

/**
 * A scripted `VoiceCapturePort` fake, in the same spirit as this
 * repository's other injected-port tests
 * (`../notifications/push-registration-model.test.ts`'s fake
 * registrar): every call is recorded so a test can assert *which*
 * methods actually ran, not just the final outcome ("registration is
 * not receipt").
 */
function createFakePort(options?: {
  permission?: PermissionState;
  stopResult?: VoiceCaptureOutcome;
}): VoiceCapturePort & {
  calls: { start: number; stop: number; cancel: number; requestPermission: number };
} {
  const calls = { start: 0, stop: 0, cancel: 0, requestPermission: 0 };
  let permission = options?.permission ?? "granted";
  let stopResult: VoiceCaptureOutcome = options?.stopResult ?? {
    kind: "transcript",
    text: "add a comment to the login handler",
  };
  return {
    calls,
    async getPermissionStatus() {
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
      calls.cancel += 1;
    },
    // test-only helpers, not part of VoiceCapturePort
    __setPermission(next: PermissionState) {
      permission = next;
    },
    __setStopResult(next: VoiceCaptureOutcome) {
      stopResult = next;
    },
  } as VoiceCapturePort & {
    calls: typeof calls;
    __setPermission: (s: PermissionState) => void;
    __setStopResult: (r: VoiceCaptureOutcome) => void;
  };
}

function makeOutbox() {
  const storage = createInMemoryStructuredStorage();
  const clock = createSystemClock();
  return new coreComposer.OutboxController(storage, clock);
}

function makeController(opts?: {
  port?: ReturnType<typeof createFakePort>;
  submitPrompt?: (text: string) => Promise<void>;
  outbox?: coreComposer.OutboxController;
  sessionId?: string;
}) {
  const port = opts?.port ?? createFakePort();
  const outbox = opts?.outbox ?? makeOutbox();
  const submitPrompt = opts?.submitPrompt ?? vi.fn(async () => undefined);
  const controller = createVoiceCaptureController({
    port,
    outbox,
    sessionId: opts?.sessionId ?? "agent-1",
    submitPrompt,
  });
  return { controller, port, outbox, submitPrompt };
}

describe("voice entry produces a prompt through the outbox", () => {
  it("enqueues kind:'prompt' with the transcribed text, then marks it sending -> sent around submitPrompt", async () => {
    const submitPrompt = vi.fn(async () => undefined);
    const { controller, outbox } = makeController({ submitPrompt });

    expect(await controller.requestStart()).toEqual({ outcome: "started" });
    const stop = await controller.requestStop();

    expect(stop.outcome).toBe("queued");
    if (stop.outcome !== "queued") throw new Error("unreachable");
    expect(stop.text).toBe("add a comment to the login handler");
    expect(submitPrompt).toHaveBeenCalledWith("add a comment to the login handler");

    // The real OutboxController: `markSent` deletes the entry once
    // acknowledged (its own documented terminal behaviour), so a
    // "sent" entry is gone from `loadAll` by design — proving the
    // sent-and-cleared lifecycle actually ran, not a mock recording a
    // call that did nothing.
    const remaining = await outbox.loadAll("agent-1");
    expect(remaining).toHaveLength(0);
  });

  it("enqueues before calling submitPrompt — the entry exists durably even if the send is still in flight", async () => {
    const outbox = makeOutbox();
    let sawEntryDuringSend = false;
    const submitPrompt = vi.fn(async () => {
      const entries = await outbox.loadAll("agent-1");
      sawEntryDuringSend = entries.length === 1 && entries[0].status === "sending";
    });
    const { controller } = makeController({ outbox, submitPrompt });

    await controller.requestStart();
    await controller.requestStop();

    expect(sawEntryDuringSend).toBe(true);
  });

  it("scopes the entry to the given sessionId, not a shared/global key", async () => {
    const { controller, outbox } = makeController({ sessionId: "agent-42" });
    await controller.requestStart();
    const stop = await controller.requestStop();
    expect(stop.outcome).toBe("queued");

    // Already deleted (sent) under the right session; a *different*
    // session's queue was never touched.
    const otherSession = await outbox.loadAll("some-other-agent");
    expect(otherSession).toHaveLength(0);
  });

  it("a failed submitPrompt (e.g. connection dropped while sending) moves the entry to awaiting-confirmation, not deleted", async () => {
    const outbox = makeOutbox();
    const submitPrompt = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const { controller } = makeController({ outbox, submitPrompt });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop.outcome).toBe("send-failed");
    if (stop.outcome !== "send-failed") throw new Error("unreachable");
    expect(stop.text).toBe("add a comment to the login handler");

    const entries = await outbox.loadAll("agent-1");
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("awaiting-confirmation");
    expect(entries[0].payload).toMatchObject({ source: "voice", text: stop.text });
  });

  it("an empty (silent) transcript is a no-op — never enqueued", async () => {
    const port = createFakePort({ stopResult: { kind: "transcript", text: "   " } });
    const { controller, outbox } = makeController({ port });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop).toEqual({ outcome: "empty-transcript" });
    expect(await outbox.loadAll("agent-1")).toHaveLength(0);
  });

  it("a raw-audio port outcome is never persisted (no live daemon socket, and raw audio must never sit in plain storage)", async () => {
    const port = createFakePort({
      stopResult: { kind: "audio", audioBase64: "AAAA", format: "audio/pcm;rate=16000" },
    });
    const { controller, outbox } = makeController({ port });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop).toEqual({ outcome: "raw-audio-unsupported" });
    expect(await outbox.loadAll("agent-1")).toHaveLength(0);
  });

  it("annotates (never blocks) a secret-shaped transcript, matching share-intent-model's looksSecretShaped precedent", async () => {
    const port = createFakePort({
      stopResult: { kind: "transcript", text: "the api key is sk-LIVEKEY1234567890ABCDEF" },
    });
    const { controller } = makeController({ port });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop.outcome).toBe("queued");
    if (stop.outcome !== "queued") throw new Error("unreachable");
    expect(stop.looksSecretShaped).toBe(true);
    // Never blocked: the user's own voice content is still sent.
  });

  it("logs nothing, even for a secret-shaped transcript", async () => {
    const port = createFakePort({
      stopResult: { kind: "transcript", text: "sk-LIVEKEY1234567890ABCDEF" },
    });
    const { controller } = makeController({ port });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await controller.requestStart();
      await controller.requestStop();
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("a denied microphone permission explains recovery via T33B7's own affordance", () => {
  it("requestStart short-circuits to permission-denied without ever starting the port", async () => {
    const port = createFakePort({ permission: "denied" });
    const { controller, outbox } = makeController({ port });

    const start = await controller.requestStart();
    expect(start).toEqual({ outcome: "permission-denied", state: "denied" });
    expect(port.calls.start).toBe(0);
    expect(controller.getState()).toEqual(IDLE_VOICE_STATE);
    expect(await outbox.loadAll("agent-1")).toHaveLength(0);
  });

  it("the returned PermissionState round-trips into composer's describePermissionRecovery('microphone', state) unchanged — the exact affordance T33B7 built, not a second one", async () => {
    const port = createFakePort({ permission: "denied" });
    const { controller } = makeController({ port });
    const start = await controller.requestStart();
    if (start.outcome !== "permission-denied") throw new Error("unreachable");

    const copy = describePermissionRecovery("microphone", start.state);
    expect(copy.action).toBe("request");
    expect(copy.actionLabel).not.toHaveLength(0);
    expect(copy.message.toLowerCase()).toContain("microphone");
  });

  it("denied-permanently never offers 're-request' — the same rule composer's own module enforces for every kind", async () => {
    const port = createFakePort({ permission: "denied-permanently" });
    const { controller } = makeController({ port });
    const start = await controller.requestStart();
    if (start.outcome !== "permission-denied") throw new Error("unreachable");

    const copy = describePermissionRecovery("microphone", start.state);
    expect(copy.action).toBe("open-settings");
    expect(copy.action).not.toBe("request");
  });

  it("granted permission actually starts the port (permission gate isn't a no-op)", async () => {
    const port = createFakePort({ permission: "granted" });
    const { controller } = makeController({ port });
    await controller.requestStart();
    expect(port.calls.start).toBe(1);
    expect(controller.getState().status).toBe("recording");
  });
});

describe("recording-in-progress scenarios", () => {
  it("a second start while one is already running is a no-op — the running capture is untouched", async () => {
    const port = createFakePort();
    const { controller } = makeController({ port });

    await controller.requestStart();
    expect(port.calls.start).toBe(1);

    const secondStart = await controller.requestStart();
    expect(secondStart).toEqual({ outcome: "already-recording" });
    expect(port.calls.start).toBe(1); // not called again
    expect(controller.getState().status).toBe("recording");
  });

  it("the user cancelling discards the capture — port.cancel() runs and nothing is ever enqueued", async () => {
    const port = createFakePort();
    const { controller, outbox } = makeController({ port });

    await controller.requestStart();
    const cancelled = await controller.requestCancel();

    expect(cancelled).toEqual({ outcome: "cancelled", reason: "user" });
    expect(port.calls.cancel).toBe(1);
    expect(port.calls.stop).toBe(0);
    expect(controller.getState()).toEqual(IDLE_VOICE_STATE);
    expect(await outbox.loadAll("agent-1")).toHaveLength(0);

    // A cancelled recording is not merely "unsent" — a subsequent stop
    // has nothing left to stop.
    const stopAfterCancel = await controller.requestStop();
    expect(stopAfterCancel).toEqual({ outcome: "not-recording" });
    expect(port.calls.stop).toBe(0);
  });

  it("cancelling when nothing is recording is a harmless no-op", async () => {
    const { controller, port } = makeController();
    const result = await controller.requestCancel();
    expect(result).toEqual({ outcome: "not-recording" });
    expect(port.calls.cancel).toBe(0);
  });

  it("the app backgrounding mid-recording cancels and discards, same as an explicit user cancel", async () => {
    const port = createFakePort();
    const { controller, outbox } = makeController({ port });

    await controller.requestStart();
    const result = await controller.handleAppBackgrounded();

    expect(result).toEqual({ outcome: "cancelled", reason: "backgrounded" });
    expect(port.calls.cancel).toBe(1);
    expect(controller.getState()).toEqual(IDLE_VOICE_STATE);
    expect(await outbox.loadAll("agent-1")).toHaveLength(0);
  });

  it("backgrounding while idle is a no-op, not a spurious cancel", async () => {
    const { controller, port } = makeController();
    const result = await controller.handleAppBackgrounded();
    expect(result).toEqual({ outcome: "not-recording" });
    expect(port.calls.cancel).toBe(0);
  });

  it("a dropped connection mid-recording leaves the recording untouched — capture is local, not socket-bound this wave", async () => {
    const port = createFakePort();
    const { controller } = makeController({ port });

    await controller.requestStart();
    const beforeState = controller.getState();
    const returned = controller.handleConnectionLost();

    expect(returned).toEqual(beforeState);
    expect(controller.getState().status).toBe("recording");
    expect(port.calls.cancel).toBe(0);
    expect(port.calls.stop).toBe(0);

    // The transcript can still be produced and durably queued afterward.
    const stop = await controller.requestStop();
    expect(stop.outcome).toBe("queued");
  });
});
