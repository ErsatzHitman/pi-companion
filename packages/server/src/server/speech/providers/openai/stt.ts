import { EventEmitter } from "node:events";
import type pino from "pino";
import { OpenAI } from "openai";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { v4 } from "uuid";
import { inferAudioExtension } from "../../../agent/audio-utils.js";
import type {
  LogprobToken,
  SpeechToTextProvider,
  StreamingTranscriptionSession,
  TranscriptionResult,
} from "../../speech-provider.js";

export type { LogprobToken, TranscriptionResult };

export interface STTConfig {
  apiKey: string;
  baseUrl?: string;
  model?: "whisper-1" | "gpt-4o-transcribe" | "gpt-4o-mini-transcribe" | (string & {});
  confidenceThreshold?: number; // Default: -3.0
}

/**
 * T277 (plan.md §9.4 "Groq transcription and draft insertion"): the free-tier ceiling Groq
 * documents for `/audio/transcriptions` (~13 minutes of 16 kHz mono 16-bit
 * WAV) — re-verified against Groq's own docs, not copied from a research
 * note — and, separately, OpenAI's own Whisper endpoint enforces the
 * identical 25 MB limit. One constant covers both, since `transcribeClip`
 * below is the same code path for either vendor (see this file's sibling
 * `config.ts` for why). Checked BEFORE the upload, so an oversize clip
 * fails with a clear message instead of a 413 from the far end.
 */
export const MAX_TRANSCRIPTION_CLIP_BYTES = 25 * 1024 * 1024;

/**
 * A known Whisper failure mode: a clip that is silence or non-speech noise
 * can still come back with confident-looking invented text ("hallucination").
 * Groq's (and OpenAI's) `verbose_json` response exposes `no_speech_prob` per
 * segment for exactly this; `0.6` is the commonly-used threshold in Whisper
 * tooling for "probably no speech here" (docs/openai/whisper's own
 * `VoiceActivityDetector` in openai's `whisper.cpp`-adjacent tooling uses
 * the same figure) — a real decision, not an arbitrary one, but not proven
 * against a labelled dataset in this repository. `transcribeClip` below
 * clears the guessed text to `""` rather than passing along a hallucinated
 * sentence, so it lands on `voice-model.ts`'s existing `"empty-transcript"`
 * path rather than putting invented words in the composer draft.
 */
const HALLUCINATION_NO_SPEECH_PROB_THRESHOLD = 0.6;

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null;
}

interface ClipTranscriptionSegment {
  start: number;
  end: number;
  no_speech_prob?: number;
  avg_logprob?: number;
}

function isClipTranscriptionSegment(value: unknown): value is ClipTranscriptionSegment {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.start === "number" && typeof value.end === "number";
}

function isClipTranscriptionSegmentArray(value: unknown): value is ClipTranscriptionSegment[] {
  return Array.isArray(value) && value.every((entry) => isClipTranscriptionSegment(entry));
}

/**
 * Duration-weighted average `no_speech_prob` across every segment — a
 * single short segment of confident noise shouldn't out-vote a long span of
 * genuine silence, or vice versa. Returns `null` when there is nothing to
 * weight (no segments, or every segment reports zero duration), in which
 * case the caller does not apply the hallucination guard at all: an
 * `undefined` verdict is not evidence of silence.
 */
function weightedAverageNoSpeechProb(segments: ClipTranscriptionSegment[]): number | null {
  let totalDuration = 0;
  let weightedSum = 0;
  for (const segment of segments) {
    const duration = Math.max(0, segment.end - segment.start);
    if (duration === 0 || segment.no_speech_prob === undefined) {
      continue;
    }
    totalDuration += duration;
    weightedSum += duration * segment.no_speech_prob;
  }
  if (totalDuration === 0) {
    return null;
  }
  return weightedSum / totalDuration;
}

function isLogprobToken(value: unknown): value is LogprobToken {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.token !== "string") {
    return false;
  }
  if (typeof value.logprob !== "number") {
    return false;
  }
  if (value.bytes === undefined) {
    return true;
  }
  return Array.isArray(value.bytes) && value.bytes.every((entry) => typeof entry === "number");
}

function isLogprobTokenArray(value: unknown): value is LogprobToken[] {
  return Array.isArray(value) && value.every((entry) => isLogprobToken(entry));
}

export class OpenAISTT implements SpeechToTextProvider {
  private readonly openaiClient: OpenAI;
  private readonly config: STTConfig;
  private readonly logger: pino.Logger;
  public readonly id = "openai" as const;

  constructor(sttConfig: STTConfig, parentLogger: pino.Logger) {
    this.config = sttConfig;
    this.logger = parentLogger.child({ module: "agent", provider: "openai", component: "stt" });
    this.openaiClient = new OpenAI({
      apiKey: sttConfig.apiKey,
      ...(sttConfig.baseUrl ? { baseURL: sttConfig.baseUrl } : {}),
    });
    this.logger.info({ model: sttConfig.model || "whisper-1" }, "STT (OpenAI Whisper) initialized");
  }

  public createSession(params: {
    logger: pino.Logger;
    language?: string;
    prompt?: string;
  }): StreamingTranscriptionSession {
    const emitter = new EventEmitter();
    const logger = params.logger.child({ provider: "openai", component: "stt-session" });
    const requiredSampleRate = 24000;

    let connected = false;
    let segmentId = v4();
    let previousSegmentId: string | null = null;
    let pcm16: Buffer = Buffer.alloc(0);
    const transcribeAudio = this.transcribeAudioInternal.bind(this);

    const convertPCMToWavBuffer = (pcmBuffer: Buffer): Buffer => {
      const headerSize = 44;
      const channels = 1;
      const bitsPerSample = 16;
      const sampleRate = requiredSampleRate;
      const wavBuffer = Buffer.alloc(headerSize + pcmBuffer.length);
      const byteRate = (sampleRate * channels * bitsPerSample) / 8;
      const blockAlign = (channels * bitsPerSample) / 8;

      wavBuffer.write("RIFF", 0);
      wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
      wavBuffer.write("WAVE", 8);
      wavBuffer.write("fmt ", 12);
      wavBuffer.writeUInt32LE(16, 16);
      wavBuffer.writeUInt16LE(1, 20);
      wavBuffer.writeUInt16LE(channels, 22);
      wavBuffer.writeUInt32LE(sampleRate, 24);
      wavBuffer.writeUInt32LE(byteRate, 28);
      wavBuffer.writeUInt16LE(blockAlign, 32);
      wavBuffer.writeUInt16LE(bitsPerSample, 34);
      wavBuffer.write("data", 36);
      wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
      pcmBuffer.copy(wavBuffer, 44);

      return wavBuffer;
    };

    return {
      requiredSampleRate,
      async connect() {
        connected = true;
      },
      appendPcm16(chunk: Buffer) {
        if (!connected) {
          emitter.emit("error", new Error("STT session not connected"));
          return;
        }
        pcm16 = pcm16.length === 0 ? chunk : Buffer.concat([pcm16, chunk]);
      },
      commit() {
        if (!connected) {
          emitter.emit("error", new Error("STT session not connected"));
          return;
        }

        const committedId = segmentId;
        const prev = previousSegmentId;
        emitter.emit("committed", { segmentId: committedId, previousSegmentId: prev });

        void (async () => {
          try {
            if (pcm16.length === 0) {
              emitter.emit("transcript", {
                segmentId: committedId,
                transcript: "",
                isFinal: true,
                language: params.language,
                isLowConfidence: true,
              });
              return;
            }

            const wav = convertPCMToWavBuffer(pcm16);
            const result = await transcribeAudio(
              wav,
              "audio/wav",
              params.language ?? "en",
              logger,
              params.prompt,
            );

            emitter.emit("transcript", {
              segmentId: committedId,
              transcript: result.text,
              isFinal: true,
              language: result.language,
              logprobs: result.logprobs,
              avgLogprob: result.avgLogprob,
              isLowConfidence: result.isLowConfidence,
            });
          } catch (err) {
            emitter.emit("error", err);
          } finally {
            previousSegmentId = committedId;
            segmentId = v4();
            pcm16 = Buffer.alloc(0);
          }
        })();
      },
      clear() {
        pcm16 = Buffer.alloc(0);
        segmentId = v4();
      },
      close() {
        connected = false;
        pcm16 = Buffer.alloc(0);
      },
      on(event: string, handler: (...args: never[]) => void) {
        emitter.on(event, handler as (...args: unknown[]) => void);
        return undefined;
      },
    };
  }

  private async transcribeAudioInternal(
    audioBuffer: Buffer,
    format: string,
    language: string,
    logger: pino.Logger,
    prompt?: string,
  ): Promise<TranscriptionResult> {
    if (audioBuffer.length > MAX_TRANSCRIPTION_CLIP_BYTES) {
      throw new Error(describeOversizeClip(audioBuffer.length));
    }

    const startTime = Date.now();
    let tempFilePath: string | null = null;

    try {
      const ext = inferAudioExtension(format);
      tempFilePath = join(tmpdir(), `audio-${v4()}.${ext}`);
      await writeFile(tempFilePath, audioBuffer);

      logger.debug({ tempFilePath, bytes: audioBuffer.length }, "Transcribing audio file");

      const modelToUse = this.config.model ?? "whisper-1";
      const supportsLogprobs =
        modelToUse === "gpt-4o-transcribe" || modelToUse === "gpt-4o-mini-transcribe";
      const includeLogprobs: ["logprobs"] = ["logprobs"];

      const response = await this.openaiClient.audio.transcriptions.create({
        file: await import("fs").then((fs) => fs.createReadStream(tempFilePath!)),
        language,
        model: modelToUse,
        ...(prompt ? { prompt } : {}),
        ...(supportsLogprobs ? { include: includeLogprobs } : {}),
        response_format: "json",
      });

      const duration = Date.now() - startTime;
      const confidenceThreshold = this.config.confidenceThreshold ?? -3.0;

      let avgLogprob: number | undefined;
      let isLowConfidence = false;
      const logprobs =
        supportsLogprobs && isObject(response) && isLogprobTokenArray(response.logprobs)
          ? response.logprobs
          : undefined;

      if (logprobs && logprobs.length > 0) {
        const totalLogprob = logprobs.reduce((sum, token) => sum + token.logprob, 0);
        avgLogprob = totalLogprob / logprobs.length;
        isLowConfidence = avgLogprob < confidenceThreshold;

        if (isLowConfidence) {
          logger.debug(
            {
              avgLogprob,
              threshold: confidenceThreshold,
              text: response.text,
              tokenLogprobs: logprobs.map((t) => `${t.token}:${t.logprob.toFixed(2)}`).join(", "),
            },
            "Low confidence transcription detected",
          );
        }
      }

      logger.debug({ duration, text: response.text, avgLogprob }, "Transcription complete");

      return {
        text: response.text,
        duration: duration,
        logprobs: logprobs,
        avgLogprob: avgLogprob,
        isLowConfidence: isLowConfidence,
        language:
          isObject(response) && typeof response.language === "string"
            ? response.language
            : undefined,
      };
    } catch (error) {
      logger.error({ err: error }, "Transcription error");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`STT transcription failed: ${message}`, { cause: error });
    } finally {
      if (tempFilePath) {
        try {
          await unlink(tempFilePath);
        } catch {
          logger.warn({ tempFilePath }, "Failed to clean up temp file");
        }
      }
    }
  }

  /**
   * T277 (plan.md §9.4 "Groq transcription and draft insertion"): a ONE-SHOT transcription of an
   * already-complete audio clip — no streaming session, no PCM conversion.
   * `format` is passed straight through to `inferAudioExtension` (already
   * format-agnostic: wav, m4a/aac, mp3, webm, ogg, flac, mp4 all resolve to
   * a real extension), and the raw bytes go to the OpenAI-compatible
   * endpoint exactly as captured — this is what makes Groq reachable via
   * this SAME class: neither this method nor `OpenAISTT` cares whether the
   * container is a browser's raw PCM/WAV or a mobile client's AAC/m4a clip.
   * `createSession`/`transcribeAudioInternal` above are unchanged and still
   * serve the streaming dictation/voice-mode paths, which are themselves
   * PCM-only further up their own call chain — this method exists
   * specifically because that PCM-only assumption does not hold for a
   * complete, already-encoded clip like the one `expo-audio-voice-capture-
   * port.ts` produces.
   */
  public async transcribeClip(
    audioBuffer: Buffer,
    format: string,
    options?: { language?: string },
  ): Promise<TranscriptionResult> {
    if (audioBuffer.length > MAX_TRANSCRIPTION_CLIP_BYTES) {
      throw new Error(describeOversizeClip(audioBuffer.length));
    }

    let tempFilePath: string | null = null;
    try {
      const ext = inferAudioExtension(format);
      tempFilePath = join(tmpdir(), `voice-clip-${v4()}.${ext}`);
      await writeFile(tempFilePath, audioBuffer);

      const modelToUse = this.config.model ?? "whisper-1";
      const response = await this.openaiClient.audio.transcriptions.create({
        file: await import("fs").then((fs) => fs.createReadStream(tempFilePath!)),
        model: modelToUse,
        ...(options?.language ? { language: options.language } : {}),
        // `verbose_json` (not `"json"`, unlike `transcribeAudioInternal`
        // above): only this response shape carries per-segment
        // `no_speech_prob`, which the hallucination guard below needs.
        response_format: "verbose_json",
      });

      const rawText = isObject(response) && typeof response.text === "string" ? response.text : "";
      const segments =
        isObject(response) && isClipTranscriptionSegmentArray(response.segments)
          ? response.segments
          : [];
      const noSpeechProb = weightedAverageNoSpeechProb(segments);
      const isLikelyHallucination =
        noSpeechProb !== null && noSpeechProb >= HALLUCINATION_NO_SPEECH_PROB_THRESHOLD;

      return {
        text: isLikelyHallucination ? "" : rawText,
        language:
          isObject(response) && typeof response.language === "string"
            ? response.language
            : undefined,
        ...(noSpeechProb !== null ? { isLowConfidence: isLikelyHallucination } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Transcription failed: ${message}`, { cause: error });
    } finally {
      if (tempFilePath) {
        try {
          await unlink(tempFilePath);
        } catch {
          // Best-effort cleanup only — matches transcribeAudioInternal above.
        }
      }
    }
  }
}

function describeOversizeClip(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  const limitMb = (MAX_TRANSCRIPTION_CLIP_BYTES / (1024 * 1024)).toFixed(0);
  return `Recording is ${mb} MB, over the ${limitMb} MB transcription limit. Trim it and try again.`;
}
