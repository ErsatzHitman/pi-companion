import { describe, expect, it, vi } from "vitest";

import { describePermissionRecovery, type PermissionState } from "../composer/permission-recovery";
import {
  applyTranscriptToDraft,
  cleanTranscript,
  createVoiceCaptureController,
  IDLE_VOICE_STATE,
  type VoiceTranscriptionClient,
} from "./voice-model";
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

function makeController(opts?: {
  port?: ReturnType<typeof createFakePort>;
  transcribe?: VoiceTranscriptionClient;
  language?: string;
}) {
  const port = opts?.port ?? createFakePort();
  const controller = createVoiceCaptureController({
    port,
    ...(opts?.transcribe ? { transcribe: opts.transcribe } : {}),
    ...(opts?.language ? { language: opts.language } : {}),
  });
  return { controller, port };
}

describe("cleanTranscript (T277 — deterministic cleanup)", () => {
  it("trims and collapses doubled/irregular whitespace", () => {
    expect(cleanTranscript("  add   a   comment  \n\n to the login handler  ")).toBe(
      "add a comment to the login handler",
    );
  });

  it("drops a single leading filler token", () => {
    expect(cleanTranscript("um, add a comment to the login handler")).toBe(
      "add a comment to the login handler",
    );
    expect(cleanTranscript("uh add tests")).toBe("add tests");
  });

  it("never drops a filler word that appears mid-sentence, only a leading one", () => {
    expect(cleanTranscript("please um add a comment")).toBe("please um add a comment");
  });

  it("a transcript that is ONLY a filler word collapses to empty", () => {
    expect(cleanTranscript("um")).toBe("");
    expect(cleanTranscript("  um  ")).toBe("");
  });

  it("whitespace-only input collapses to empty", () => {
    expect(cleanTranscript("   \n\t  ")).toBe("");
  });

  it("leaves ordinary text with no leading filler untouched (besides whitespace collapse)", () => {
    expect(cleanTranscript("commit the fix")).toBe("commit the fix");
  });

  // T286: the doc above used to say "ONE leading filler token ... if the transcript
  // starts with one" while the regex only ever admitted exactly one trailing
  // punctuation character, so a Whisper-family ellipsis or dash after the filler left
  // the transcript unchanged. Each admitted form below is pinned as its OWN case, per
  // T286's brief, so a partial regression (e.g. dashes fixed but not ellipses) is
  // visible rather than hidden behind one combined assertion.
  describe("T286: widened trailing-punctuation forms after a leading filler", () => {
    it("a three-dot ellipsis after the filler is dropped with it", () => {
      expect(cleanTranscript("Um... hello there")).toBe("hello there");
    });

    it("a unicode ellipsis character after the filler is dropped with it", () => {
      expect(cleanTranscript("Um… hello there")).toBe("hello there");
    });

    it("an em dash directly after the filler, with no separating space, is dropped with it", () => {
      expect(cleanTranscript("Um—hello")).toBe("hello");
    });

    it("a hyphen directly after the filler, with no separating space, is dropped with it", () => {
      expect(cleanTranscript("Um-hello")).toBe("hello");
    });

    it("still drops a single trailing comma (the form that already worked)", () => {
      expect(cleanTranscript("Um, hello there")).toBe("hello there");
    });

    it("still drops the filler when no trailing punctuation follows at all (the other form that already worked)", () => {
      expect(cleanTranscript("Uh hello")).toBe("hello");
    });

    it("a filler-only transcript followed by an ellipsis still collapses to empty", () => {
      expect(cleanTranscript("Um...")).toBe("");
    });

    it("still never drops a mid-sentence filler even when it is followed by an ellipsis", () => {
      expect(cleanTranscript("please um... add a comment")).toBe("please um... add a comment");
    });
  });
});

describe("applyTranscriptToDraft (T277 — the append decision)", () => {
  it("an empty current draft becomes exactly the transcript", () => {
    expect(applyTranscriptToDraft("", "add a comment")).toBe("add a comment");
  });

  it("appends with a separating space when the draft does not already end in whitespace", () => {
    expect(applyTranscriptToDraft("fix the bug", "and add a test")).toBe(
      "fix the bug and add a test",
    );
  });

  it("does not double a space when the draft already ends in whitespace", () => {
    expect(applyTranscriptToDraft("fix the bug ", "and add a test")).toBe(
      "fix the bug and add a test",
    );
  });

  it("an empty transcript never touches the existing draft — the decision most likely to be made by accident", () => {
    expect(applyTranscriptToDraft("do not lose this", "")).toBe("do not lose this");
  });
});

describe("voice entry lands as an editable draft, never a send (T277)", () => {
  it("requestStop resolves 'drafted' with the cleaned transcript — no outbox, no submit", async () => {
    const { controller } = makeController();

    expect(await controller.requestStart()).toEqual({ outcome: "started" });
    const stop = await controller.requestStop();

    expect(stop).toEqual({
      outcome: "drafted",
      text: "add a comment to the login handler",
      looksSecretShaped: false,
    });
  });

  it("cleanup runs on the transcript before it is offered as a draft", async () => {
    const port = createFakePort({
      stopResult: { kind: "transcript", text: "  um,  add   tests  " },
    });
    const { controller } = makeController({ port });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop).toEqual({ outcome: "drafted", text: "add tests", looksSecretShaped: false });
  });

  it("an empty (silent) transcript is a no-op — never offered as a draft", async () => {
    const port = createFakePort({ stopResult: { kind: "transcript", text: "   " } });
    const { controller } = makeController({ port });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop).toEqual({ outcome: "empty-transcript" });
  });

  it("a transcript that is only a filler word also resolves empty-transcript", async () => {
    const port = createFakePort({ stopResult: { kind: "transcript", text: "um" } });
    const { controller } = makeController({ port });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop).toEqual({ outcome: "empty-transcript" });
  });

  it("annotates (never blocks) a secret-shaped transcript, matching share-intent-model's looksSecretShaped precedent", async () => {
    const port = createFakePort({
      stopResult: { kind: "transcript", text: "the api key is sk-LIVEKEY1234567890ABCDEF" },
    });
    const { controller } = makeController({ port });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop.outcome).toBe("drafted");
    if (stop.outcome !== "drafted") throw new Error("unreachable");
    expect(stop.looksSecretShaped).toBe(true);
    // Never blocked: the user's own voice content is still offered as a draft.
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

describe("a raw-audio port outcome (T277: transcribed, not discarded, when a client is wired)", () => {
  it("with no transcribe client injected (today's default mount): resolves 'transcription-unavailable', never a fake transcript", async () => {
    const port = createFakePort({
      stopResult: { kind: "audio", audioBase64: "AAAA", format: "audio/m4a" },
    });
    const { controller } = makeController({ port });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop).toEqual({ outcome: "transcription-unavailable" });
  });

  it("with a transcribe client injected: sends the captured clip's exact bytes/format and drafts the returned text", async () => {
    const port = createFakePort({
      stopResult: { kind: "audio", audioBase64: "ZmFrZS1jbGlw", format: "audio/m4a" },
    });
    const transcribeVoiceClip = vi.fn(async () => ({ text: "commit the fix", error: null }));
    const { controller } = makeController({
      port,
      transcribe: { transcribeVoiceClip },
      language: "en",
    });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(transcribeVoiceClip).toHaveBeenCalledWith({
      audioBase64: "ZmFrZS1jbGlw",
      format: "audio/m4a",
      language: "en",
    });
    expect(stop).toEqual({ outcome: "drafted", text: "commit the fix", looksSecretShaped: false });
  });

  it("omits language entirely when none was configured", async () => {
    const port = createFakePort({
      stopResult: { kind: "audio", audioBase64: "AAAA", format: "audio/m4a" },
    });
    const transcribeVoiceClip = vi.fn(async () => ({ text: "ok", error: null }));
    const { controller } = makeController({ port, transcribe: { transcribeVoiceClip } });

    await controller.requestStart();
    await controller.requestStop();

    expect(transcribeVoiceClip).toHaveBeenCalledWith({ audioBase64: "AAAA", format: "audio/m4a" });
  });

  it("a provider-reported error resolves 'transcription-failed' with its message", async () => {
    const port = createFakePort({
      stopResult: { kind: "audio", audioBase64: "AAAA", format: "audio/m4a" },
    });
    const transcribeVoiceClip = vi.fn(async () => ({
      text: null,
      error: "Dictation STT not configured",
    }));
    const { controller } = makeController({ port, transcribe: { transcribeVoiceClip } });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop).toEqual({
      outcome: "transcription-failed",
      message: "Dictation STT not configured",
    });
  });

  it("a rejected transcribeVoiceClip call (e.g. the daemon call itself throws) resolves 'transcription-failed', never an uncaught rejection", async () => {
    const port = createFakePort({
      stopResult: { kind: "audio", audioBase64: "AAAA", format: "audio/m4a" },
    });
    const transcribeVoiceClip = vi.fn(async () => {
      throw new Error("Recording is too long to transcribe — over the 25 MB limit.");
    });
    const { controller } = makeController({ port, transcribe: { transcribeVoiceClip } });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop).toEqual({
      outcome: "transcription-failed",
      message: "Recording is too long to transcribe — over the 25 MB limit.",
    });
  });

  it("a hallucination-guarded empty result (server already cleared it) resolves empty-transcript, not a draft of nothing", async () => {
    const port = createFakePort({
      stopResult: { kind: "audio", audioBase64: "AAAA", format: "audio/m4a" },
    });
    const transcribeVoiceClip = vi.fn(async () => ({ text: "", error: null }));
    const { controller } = makeController({ port, transcribe: { transcribeVoiceClip } });

    await controller.requestStart();
    const stop = await controller.requestStop();

    expect(stop).toEqual({ outcome: "empty-transcript" });
  });
});

describe("a denied microphone permission explains recovery via T33B7's own affordance", () => {
  it("requestStart short-circuits to permission-denied without ever starting the port", async () => {
    const port = createFakePort({ permission: "denied" });
    const { controller } = makeController({ port });

    const start = await controller.requestStart();
    expect(start).toEqual({ outcome: "permission-denied", state: "denied" });
    expect(port.calls.start).toBe(0);
    expect(controller.getState()).toEqual(IDLE_VOICE_STATE);
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

  it("the user cancelling discards the capture — port.cancel() runs and no draft is ever produced", async () => {
    const port = createFakePort();
    const { controller } = makeController({ port });

    await controller.requestStart();
    const cancelled = await controller.requestCancel();

    expect(cancelled).toEqual({ outcome: "cancelled", reason: "user" });
    expect(port.calls.cancel).toBe(1);
    expect(port.calls.stop).toBe(0);
    expect(controller.getState()).toEqual(IDLE_VOICE_STATE);

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
    const { controller } = makeController({ port });

    await controller.requestStart();
    const result = await controller.handleAppBackgrounded();

    expect(result).toEqual({ outcome: "cancelled", reason: "backgrounded" });
    expect(port.calls.cancel).toBe(1);
    expect(controller.getState()).toEqual(IDLE_VOICE_STATE);
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

    // The transcript can still be produced and drafted afterward.
    const stop = await controller.requestStop();
    expect(stop.outcome).toBe("drafted");
  });
});
