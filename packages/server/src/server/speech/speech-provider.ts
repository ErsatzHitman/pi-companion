import type pino from "pino";
import type { Readable } from "node:stream";

export interface LogprobToken {
  token: string;
  logprob: number;
  bytes?: number[];
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  logprobs?: LogprobToken[];
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

export interface StreamingTranscriptionCommittedEvent {
  segmentId: string;
  previousSegmentId: string | null;
}

export interface StreamingTranscriptionEvent {
  segmentId: string;
  transcript: string;
  isFinal: boolean;
  language?: string;
  logprobs?: LogprobToken[];
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

export interface StreamingTranscriptionSession {
  /**
   * Required PCM16LE sample rate for `appendPcm16()`.
   * Callers are responsible for resampling before appending.
   */
  requiredSampleRate: number;

  connect(): Promise<void>;
  appendPcm16(pcm16le: Buffer): void;
  commit(): void;
  clear(): void;
  close(): void;

  on(event: "committed", handler: (payload: StreamingTranscriptionCommittedEvent) => void): unknown;
  on(event: "transcript", handler: (payload: StreamingTranscriptionEvent) => void): unknown;
  on(event: "error", handler: (err: unknown) => void): unknown;
}

export interface SpeechToTextProvider {
  id: "openai" | "local" | (string & {});
  createSession(params: {
    logger: pino.Logger;
    language?: string;
    prompt?: string;
  }): StreamingTranscriptionSession;
  /**
   * T277 (plan.md §9.4 "Groq transcription and draft insertion"): a one-shot transcription of an
   * already-complete audio clip (no session, no PCM conversion) — the
   * primitive a captured-but-not-streamed recording needs. Optional and
   * disclosed, not implemented by every provider: `OpenAISTT`
   * (`providers/openai/stt.ts`) implements it, since the OpenAI-compatible
   * REST endpoint it already wraps accepts a complete file directly; the
   * local sherpa-onnx provider does not, because its whole design is
   * incremental PCM streaming into an on-device recognizer with no
   * "hand me one complete compressed file" entry point. A caller that needs
   * this and gets a provider without it must say so, not synthesize a fake
   * transcription.
   */
  transcribeClip?(
    audioBuffer: Buffer,
    format: string,
    options?: { language?: string },
  ): Promise<TranscriptionResult>;
}

export interface SpeechStreamResult {
  stream: Readable;
  format: string;
}

export interface TextToSpeechProvider {
  synthesizeSpeech(text: string): Promise<SpeechStreamResult>;
}
