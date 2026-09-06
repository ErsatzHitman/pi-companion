/**
 * Audio input interface (plan.md §7.3).
 *
 * Covers microphone capture for voice features. Web adapters use
 * `getUserMedia`/`AudioWorklet`; Android adapters use
 * `@picompanion/expo-two-way-audio`. Chunk framing/encoding is an
 * adapter concern; core only sees raw PCM-ish byte chunks.
 */
export interface AudioInputChunk {
  data: Uint8Array;
  sampleRateHz: number;
  timestampMs: number;
}

export interface AudioInputSession {
  stop(): Promise<void>;
  onChunk(listener: (chunk: AudioInputChunk) => void): () => void;
}

export interface AudioInputOptions {
  sampleRateHz?: number;
}

export interface AudioInput {
  requestPermission(): Promise<boolean>;
  start(options?: AudioInputOptions): Promise<AudioInputSession>;
}
