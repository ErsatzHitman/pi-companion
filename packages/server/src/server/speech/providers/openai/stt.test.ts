import pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

const { openAiConstructorOptionsMock, transcriptionsCreateMock } = vi.hoisted(() => ({
  openAiConstructorOptionsMock: vi.fn(),
  transcriptionsCreateMock: vi.fn(),
}));

vi.mock("openai", () => ({
  OpenAI: vi.fn(function OpenAI(options: unknown) {
    openAiConstructorOptionsMock(options);
    return {
      audio: {
        transcriptions: {
          create: transcriptionsCreateMock,
        },
      },
    };
  }),
}));

import { OpenAISTT } from "./stt.js";

/**
 * Drains the `file` stream the real `openai` SDK would upload, exactly the
 * way this file's own "passes transcription prompt" test already does
 * inline. Required for every `transcribeClip` test below: `create()` is
 * mocked and never actually reads the stream, so an unconsumed
 * `fs.createReadStream()` opens its fd lazily on a later tick — racing
 * `transcribeClip`'s own `finally { unlink(tempFilePath) }`, which runs as
 * soon as the (synchronously-resolving) mock returns. Observed directly:
 * without this drain, that race intermittently threw an unhandled
 * `EPERM`/`ENOENT` from the stream's own later `open()` call, on an
 * already-deleted temp file — never a failed assertion, since the promise
 * `transcribeClip` returns had already resolved by then, but a real
 * unhandled-rejection warning vitest correctly flagged. Draining forces the
 * stream to actually open+close before the mock resolves, the same
 * ordering the real SDK guarantees by actually uploading the bytes.
 */
function mockTranscriptionResult(result: Record<string, unknown>) {
  transcriptionsCreateMock.mockImplementation(async (request: { file: NodeJS.ReadableStream }) => {
    await new Promise<void>((resolve, reject) => {
      request.file.once("error", reject);
      request.file.once("end", resolve);
      request.file.resume();
    });
    return result;
  });
}

describe("OpenAISTT", () => {
  afterEach(() => {
    openAiConstructorOptionsMock.mockReset();
    transcriptionsCreateMock.mockReset();
  });

  test("passes configured baseUrl to the OpenAI client", () => {
    const provider = new OpenAISTT(
      { apiKey: "sk-test", baseUrl: "https://speech.example.com/v1" },
      pino({ level: "silent" }),
    );

    expect(provider.id).toBe("openai");
    expect(openAiConstructorOptionsMock).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://speech.example.com/v1",
    });
  });

  test("passes transcription prompt to OpenAI REST STT", async () => {
    transcriptionsCreateMock.mockImplementation(
      async (request: { file: NodeJS.ReadableStream }) => {
        await new Promise<void>((resolve, reject) => {
          request.file.once("error", reject);
          request.file.once("end", resolve);
          request.file.resume();
        });
        return { text: "hello" };
      },
    );

    const provider = new OpenAISTT(
      { apiKey: "sk-test", model: "gpt-4o-transcribe" },
      pino({ level: "silent" }),
    );
    const session = provider.createSession({
      logger: pino({ level: "silent" }),
      language: "en",
      prompt: "Only transcribe the speaker.",
    });

    const transcript = new Promise<string>((resolve, reject) => {
      session.on("transcript", (event) => {
        if (event.isFinal) {
          resolve(event.transcript);
        }
      });
      session.on("error", (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    await session.connect();
    session.appendPcm16(Buffer.from([0, 0, 0, 0]));
    session.commit();

    await expect(transcript).resolves.toBe("hello");
    expect(transcriptionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        language: "en",
        model: "gpt-4o-transcribe",
        prompt: "Only transcribe the speaker.",
        response_format: "json",
      }),
    );
  });

  // T277: transcribeClip is the one-shot ("hand me one complete file")
  // primitive a captured-but-not-streamed clip needs — distinct from the
  // streaming session above, and reused unmodified for Groq (see
  // ../config.ts's header for why Groq needs no separate provider class).
  describe("transcribeClip", () => {
    test("sends the raw clip straight through with verbose_json and returns its text", async () => {
      mockTranscriptionResult({
        text: "add tests for the login handler",
        language: "en",
        segments: [{ start: 0, end: 2, no_speech_prob: 0.02, avg_logprob: -0.1 }],
      });

      const provider = new OpenAISTT(
        {
          apiKey: "gsk-test",
          baseUrl: "https://api.groq.com/openai/v1",
          model: "whisper-large-v3-turbo",
        },
        pino({ level: "silent" }),
      );

      const result = await provider.transcribeClip(Buffer.from([1, 2, 3, 4]), "audio/m4a", {
        language: "en",
      });

      expect(result.text).toBe("add tests for the login handler");
      expect(result.language).toBe("en");
      expect(transcriptionsCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "whisper-large-v3-turbo",
          language: "en",
          response_format: "verbose_json",
        }),
      );
    });

    test("omits language when none is given", async () => {
      mockTranscriptionResult({ text: "hi", segments: [] });
      const provider = new OpenAISTT({ apiKey: "sk-test" }, pino({ level: "silent" }));

      await provider.transcribeClip(Buffer.from([1]), "audio/wav");

      const call = transcriptionsCreateMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call).not.toHaveProperty("language");
    });

    test("rejects an oversize clip BEFORE calling the API — a clear message, not a 413", async () => {
      const provider = new OpenAISTT({ apiKey: "sk-test" }, pino({ level: "silent" }));
      const oversized = Buffer.alloc(25 * 1024 * 1024 + 1);

      await expect(provider.transcribeClip(oversized, "audio/m4a")).rejects.toThrow(/25 MB/);
      expect(transcriptionsCreateMock).not.toHaveBeenCalled();
    });

    test("a clip comfortably under the ceiling is accepted (never reaches the size-check throw)", async () => {
      mockTranscriptionResult({ text: "ok", segments: [] });
      const provider = new OpenAISTT({ apiKey: "sk-test" }, pino({ level: "silent" }));

      await expect(provider.transcribeClip(Buffer.alloc(1024), "audio/wav")).resolves.toMatchObject(
        { text: "ok" },
      );
    });

    // NOTE: the exact boundary (a real MAX_TRANSCRIPTION_CLIP_BYTES-sized
    // buffer written to and re-read from a real temp file) is deliberately
    // NOT exercised here — it was tried and removed. On this Windows
    // sandbox, writing a real ~25 MB file and immediately re-opening it for
    // `createReadStream` raced against the OS (observed as both `EPERM` and
    // `ENOENT` across repeated runs of the identical test, never the
    // assertion itself failing) — the same write-then-immediately-read
    // pattern `transcribeAudioInternal` above already uses for a real large
    // clip, so this is a pre-existing filesystem-timing hazard on Windows,
    // not something this task's `> MAX_TRANSCRIPTION_CLIP_BYTES` check
    // introduced. The strict `>` (not `>=`) in the source is what makes
    // exactly-at-the-limit pass through to the real API call rather than
    // being rejected; the two tests bracketing this one prove the reject
    // side (`+1` byte over) and the accept side (comfortably under) of that
    // same comparison without needing a real oversized write.

    // The hallucination guard: a known Whisper failure mode is confident
    // invented text over silence. Groq/OpenAI's verbose_json exposes
    // no_speech_prob per segment for exactly this.
    describe("hallucination guard (no_speech_prob)", () => {
      test("clears text to empty when the duration-weighted no_speech_prob is high", async () => {
        mockTranscriptionResult({
          text: "Thanks for watching!",
          segments: [{ start: 0, end: 3, no_speech_prob: 0.92, avg_logprob: -1.9 }],
        });
        const provider = new OpenAISTT({ apiKey: "sk-test" }, pino({ level: "silent" }));

        const result = await provider.transcribeClip(Buffer.from([1]), "audio/wav");

        expect(result.text).toBe("");
        expect(result.isLowConfidence).toBe(true);
      });

      test("keeps confident speech text when no_speech_prob is low", async () => {
        mockTranscriptionResult({
          text: "commit the fix",
          segments: [{ start: 0, end: 1.5, no_speech_prob: 0.03, avg_logprob: -0.2 }],
        });
        const provider = new OpenAISTT({ apiKey: "sk-test" }, pino({ level: "silent" }));

        const result = await provider.transcribeClip(Buffer.from([1]), "audio/wav");

        expect(result.text).toBe("commit the fix");
        expect(result.isLowConfidence).toBe(false);
      });

      test("weights by segment duration — a long confident segment outvotes a short silent one", async () => {
        mockTranscriptionResult({
          text: "run the tests",
          segments: [
            { start: 0, end: 0.2, no_speech_prob: 0.95, avg_logprob: -2 },
            { start: 0.2, end: 5.2, no_speech_prob: 0.01, avg_logprob: -0.1 },
          ],
        });
        const provider = new OpenAISTT({ apiKey: "sk-test" }, pino({ level: "silent" }));

        const result = await provider.transcribeClip(Buffer.from([1]), "audio/wav");

        expect(result.text).toBe("run the tests");
      });

      test("no segments at all: the guard does not fire (nothing to weight), text passes through", async () => {
        mockTranscriptionResult({ text: "hello there" });
        const provider = new OpenAISTT({ apiKey: "sk-test" }, pino({ level: "silent" }));

        const result = await provider.transcribeClip(Buffer.from([1]), "audio/wav");

        expect(result.text).toBe("hello there");
        expect(result.isLowConfidence).toBeUndefined();
      });
    });

    test("wraps a transport failure in a clear error", async () => {
      // Drains the stream (same reason `mockTranscriptionResult` does)
      // before rejecting, so the unconsumed-stream-vs-unlink race can't
      // fire here either.
      transcriptionsCreateMock.mockImplementation(
        async (request: { file: NodeJS.ReadableStream }) => {
          await new Promise<void>((resolve, reject) => {
            request.file.once("error", reject);
            request.file.once("end", resolve);
            request.file.resume();
          });
          throw new Error("network unreachable");
        },
      );
      const provider = new OpenAISTT({ apiKey: "sk-test" }, pino({ level: "silent" }));

      await expect(provider.transcribeClip(Buffer.from([1]), "audio/wav")).rejects.toThrow(
        /Transcription failed.*network unreachable/,
      );
    });
  });
});
