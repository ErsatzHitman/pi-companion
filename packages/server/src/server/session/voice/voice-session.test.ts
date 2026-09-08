import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, test, vi } from "vitest";

import { VoiceSession, type VoiceSessionHost } from "./voice-session.js";
import type { ManagedAgent } from "../../agent/agent-manager.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionCommittedEvent,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "../../speech/speech-provider.js";
import type {
  TurnDetectionProvider,
  TurnDetectionSession,
} from "../../speech/turn-detection-provider.js";
import type { SpeechReadinessSnapshot } from "../../speech/speech-runtime.js";

const VOICE_AGENT_ID = "11111111-1111-4111-8111-111111111111";

class FakeVoiceTurnDetectionSession extends EventEmitter implements TurnDetectionSession {
  public readonly requiredSampleRate = 16000;

  async connect(): Promise<void> {}

  appendPcm16(_chunk: Buffer): void {}

  flush(): void {}
  reset(): void {}
  close(): void {}
}

class FakeVoiceSttSession extends EventEmitter implements StreamingTranscriptionSession {
  public readonly requiredSampleRate = 16000;
  public commitCount = 0;

  async connect(): Promise<void> {}

  appendPcm16(_pcm16le: Buffer): void {}

  commit(): void {
    this.commitCount += 1;
  }

  clear(): void {}
  close(): void {}

  emitCommitted(event: StreamingTranscriptionCommittedEvent): void {
    this.emit("committed", event);
  }

  emitTranscript(event: StreamingTranscriptionEvent): void {
    this.emit("transcript", event);
  }
}

interface FakeVoiceHost extends VoiceSessionHost {
  readonly emitted: SessionOutboundMessage[];
  readonly spokenInput: Array<{ agentId: string; text: string }>;
}

function createFakeHost(): FakeVoiceHost {
  const emitted: SessionOutboundMessage[] = [];
  const spokenInput: Array<{ agentId: string; text: string }> = [];
  return {
    emitted,
    spokenInput,
    emit: (msg) => {
      emitted.push(msg);
    },
    loadAgent: async (agentId) =>
      ({ id: agentId, config: { systemPrompt: undefined } }) as unknown as ManagedAgent,
    reloadAgentSession: async (agentId) => ({ id: agentId }) as unknown as ManagedAgent,
    sendSpokenInput: async (agentId, text) => {
      spokenInput.push({ agentId, text });
    },
    interruptAgentIfRunning: async () => {},
    hasActiveAgentRun: () => false,
  };
}

function createVoiceSession() {
  const detector = new FakeVoiceTurnDetectionSession();
  const sttSession = new FakeVoiceSttSession();
  const stt: SpeechToTextProvider = {
    id: "local",
    createSession: vi.fn(() => sttSession),
  };
  const turnDetection: TurnDetectionProvider = {
    id: "local",
    createSession: vi.fn(() => detector),
  };
  const host = createFakeHost();
  const voiceSession = new VoiceSession({
    host,
    logger: pino({ level: "silent" }),
    sessionId: "voice-session-test",
    sttLanguage: "en",
    tts: null,
    stt,
    voice: { turnDetection },
  });
  return { voiceSession, detector, sttSession, host };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("VoiceSession streaming transcription", () => {
  test("surfaces a refused voice-mode agent interruption", async () => {
    const { voiceSession, host } = createVoiceSession();
    host.interruptAgentIfRunning = vi.fn(async () => {
      throw new Error("active run cancellation was not acknowledged");
    });

    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);

    await expect(voiceSession.handleAbort()).rejects.toThrow(
      "active run cancellation was not acknowledged",
    );
    expect(host.interruptAgentIfRunning).toHaveBeenCalledWith(VOICE_AGENT_ID);
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "activity_log",
        payload: expect.objectContaining({
          type: "error",
          content: "Voice interruption failed: active run cancellation was not acknowledged",
          metadata: { voiceAbortFailed: true },
        }),
      }),
    );

    await voiceSession.cleanup();
  });

  test("delivers the streaming final transcript to the agent exactly once", async () => {
    const { voiceSession, detector, sttSession, host } = createVoiceSession();

    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    detector.emit("speech_started");
    await settle();
    detector.emit("speech_stopped");
    await settle();
    sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
    sttSession.emitTranscript({
      segmentId: "segment-1",
      transcript: "ship the streaming final",
      isFinal: true,
      language: "en",
      avgLogprob: -0.1,
      isLowConfidence: false,
    });
    await settle();

    expect(sttSession.commitCount).toBe(1);
    expect(host.spokenInput).toEqual([
      { agentId: VOICE_AGENT_ID, text: "ship the streaming final" },
    ]);
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "transcription_result",
        payload: expect.objectContaining({
          text: "ship the streaming final",
          language: "en",
          avgLogprob: -0.1,
        }),
      }),
    );

    await voiceSession.cleanup();
  });

  test("emits an empty transcript on finalization timeout without submitting to the agent", async () => {
    vi.useFakeTimers();
    try {
      const { voiceSession, detector, sttSession, host } = createVoiceSession();

      await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
      detector.emit("speech_started");
      await settle();
      detector.emit("speech_stopped");
      await settle();
      sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });

      await vi.advanceTimersByTimeAsync(10_000);
      await settle();

      expect(host.spokenInput).toEqual([]);
      expect(host.emitted).toContainEqual(
        expect.objectContaining({
          type: "transcription_result",
          payload: expect.objectContaining({ text: "" }),
        }),
      );

      await voiceSession.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  test("filters a low-confidence streaming final without submitting to the agent", async () => {
    const { voiceSession, detector, sttSession, host } = createVoiceSession();

    await voiceSession.handleSetVoiceMode(true, VOICE_AGENT_ID);
    detector.emit("speech_started");
    await settle();
    detector.emit("speech_stopped");
    await settle();
    sttSession.emitCommitted({ segmentId: "segment-1", previousSegmentId: null });
    sttSession.emitTranscript({
      segmentId: "segment-1",
      transcript: "background noise",
      isFinal: true,
      avgLogprob: -2.5,
      isLowConfidence: true,
    });
    await settle();

    expect(host.spokenInput).toEqual([]);
    expect(host.emitted).toContainEqual(
      expect.objectContaining({
        type: "transcription_result",
        payload: expect.objectContaining({
          text: "",
          avgLogprob: -2.5,
          isLowConfidence: true,
        }),
      }),
    );

    await voiceSession.cleanup();
  });
});

// T277: handleTranscribeClip — the one-shot ("hand me one complete file")
// entry point a captured, already-encoded clip needs. Gated the same way
// handleDictationStreamStart is (same "dictation" readiness check), and
// resolved from the same dictation STT slot, deliberately never touching
// DictationStreamManager's own PCM-only streaming path.
describe("VoiceSession.handleTranscribeClip (T277)", () => {
  function createVoiceSessionWithDictation(options?: {
    dictationStt?: SpeechToTextProvider | null;
    getSpeechReadiness?: () => SpeechReadinessSnapshot;
  }) {
    const host = createFakeHost();
    const voiceSession = new VoiceSession({
      host,
      logger: pino({ level: "silent" }),
      sessionId: "voice-session-clip-test",
      sttLanguage: "en",
      tts: null,
      stt: null,
      dictation: {
        stt: options?.dictationStt ?? null,
        sttLanguage: "en",
        getSpeechReadiness: options?.getSpeechReadiness,
      },
    });
    return { voiceSession, host };
  }

  function requestMessage(overrides?: { language?: string; requestId?: string }) {
    return {
      type: "transcribe_voice_clip.request" as const,
      audioBase64: Buffer.from("fake clip bytes").toString("base64"),
      format: "audio/m4a",
      requestId: overrides?.requestId ?? "req-1",
      ...(overrides?.language ? { language: overrides.language } : {}),
    };
  }

  test("no dictation STT configured: responds with a clear error, never throws", async () => {
    const { voiceSession, host } = createVoiceSessionWithDictation({ dictationStt: null });

    await voiceSession.handleTranscribeClip(requestMessage());

    expect(host.emitted).toEqual([
      {
        type: "transcribe_voice_clip.response",
        payload: { requestId: "req-1", text: null, error: "Dictation STT not configured" },
      },
    ]);
  });

  test("a provider without transcribeClip responds with an error naming the provider, never a fake transcript", async () => {
    const provider: SpeechToTextProvider = { id: "local", createSession: vi.fn() };
    const { voiceSession, host } = createVoiceSessionWithDictation({ dictationStt: provider });

    await voiceSession.handleTranscribeClip(requestMessage());

    expect(host.emitted).toHaveLength(1);
    const [emitted] = host.emitted;
    expect(emitted.type).toBe("transcribe_voice_clip.response");
    if (emitted.type !== "transcribe_voice_clip.response") throw new Error("unreachable");
    expect(emitted.payload.text).toBeNull();
    expect(emitted.payload.error).toContain("local");
    expect(emitted.payload.error).toContain("does not support");
  });

  test("decodes the base64 clip and forwards format + language to the provider, returning its text", async () => {
    const transcribeClip = vi.fn(
      async (_audio: Buffer, _format: string, _options?: { language?: string }) => ({
        text: "commit the fix",
      }),
    );
    const provider: SpeechToTextProvider = {
      id: "openai",
      createSession: vi.fn(),
      transcribeClip,
    };
    const { voiceSession, host } = createVoiceSessionWithDictation({ dictationStt: provider });

    await voiceSession.handleTranscribeClip(requestMessage({ language: "fr", requestId: "req-2" }));

    expect(transcribeClip).toHaveBeenCalledTimes(1);
    const [audioArg, formatArg, optionsArg] = transcribeClip.mock.calls[0];
    expect(Buffer.isBuffer(audioArg)).toBe(true);
    expect((audioArg as Buffer).toString()).toBe("fake clip bytes");
    expect(formatArg).toBe("audio/m4a");
    expect(optionsArg).toEqual({ language: "fr" });

    expect(host.emitted).toEqual([
      {
        type: "transcribe_voice_clip.response",
        payload: { requestId: "req-2", text: "commit the fix", error: null },
      },
    ]);
  });

  test("falls back to the session's own dictation language when the request carries none", async () => {
    const transcribeClip = vi.fn(
      async (_audio: Buffer, _format: string, _options?: { language?: string }) => ({
        text: "ok",
      }),
    );
    const provider: SpeechToTextProvider = { id: "openai", createSession: vi.fn(), transcribeClip };
    const { voiceSession } = createVoiceSessionWithDictation({ dictationStt: provider });

    await voiceSession.handleTranscribeClip(requestMessage());

    const [, , optionsArg] = transcribeClip.mock.calls[0];
    expect(optionsArg).toEqual({ language: "en" });
  });

  test("a transcribeClip failure (e.g. oversize clip, transport error) responds with the error, never a partial success", async () => {
    const transcribeClip = vi.fn(async () => {
      throw new Error("Recording is 30.0 MB, over the 25 MB transcription limit.");
    });
    const provider: SpeechToTextProvider = { id: "openai", createSession: vi.fn(), transcribeClip };
    const { voiceSession, host } = createVoiceSessionWithDictation({ dictationStt: provider });

    await voiceSession.handleTranscribeClip(requestMessage());

    expect(host.emitted).toEqual([
      {
        type: "transcribe_voice_clip.response",
        payload: {
          requestId: "req-1",
          text: null,
          error: "Recording is 30.0 MB, over the 25 MB transcription limit.",
        },
      },
    ]);
  });

  test("a disabled dictation feature refuses the request WITHOUT ever calling the provider", async () => {
    const transcribeClip = vi.fn(async () => ({ text: "should never run" }));
    const provider: SpeechToTextProvider = { id: "openai", createSession: vi.fn(), transcribeClip };
    const readiness: SpeechReadinessSnapshot = {
      generatedAt: new Date().toISOString(),
      requiredLocalModelIds: [],
      missingLocalModelIds: [],
      download: { inProgress: false, error: null },
      realtimeVoice: {
        enabled: true,
        available: true,
        reasonCode: "ready",
        message: "ready",
        retryable: false,
        missingModelIds: [],
      },
      dictation: {
        enabled: false,
        available: false,
        reasonCode: "disabled",
        message: "Dictation is disabled.",
        retryable: false,
        missingModelIds: [],
      },
      voiceFeature: {
        enabled: true,
        available: true,
        reasonCode: "ready",
        message: "ready",
        retryable: false,
        missingModelIds: [],
      },
    };
    const { voiceSession, host } = createVoiceSessionWithDictation({
      dictationStt: provider,
      getSpeechReadiness: () => readiness,
    });

    await voiceSession.handleTranscribeClip(requestMessage());

    expect(transcribeClip).not.toHaveBeenCalled();
    expect(host.emitted).toEqual([
      {
        type: "transcribe_voice_clip.response",
        payload: { requestId: "req-1", text: null, error: "Dictation is disabled." },
      },
    ]);
  });
});
