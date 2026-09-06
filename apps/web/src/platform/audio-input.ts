import type {
  AudioInput,
  AudioInputChunk,
  AudioInputOptions,
  AudioInputSession,
} from "@picompanion/frontend-core";

const DEFAULT_SAMPLE_RATE_HZ = 16_000;
const BUFFER_SIZE = 4096;

function floatTo16BitPcm(input: Float32Array): Uint8Array {
  const output = new Uint8Array(input.length * 2);
  const view = new DataView(output.buffer);
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return output;
}

/**
 * `AudioInput` backed by `getUserMedia` (plan.md §7.3).
 *
 * Uses a `ScriptProcessorNode` for PCM framing rather than an
 * `AudioWorkletNode`: it is deprecated but needs no separate worklet
 * module to bundle, and this scaffold has no voice feature exercising it
 * yet. Revisit with `AudioWorkletNode` when a voice feature task lands.
 */
export function createBrowserAudioInput(): AudioInput {
  return {
    async requestPermission() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
        return true;
      } catch {
        return false;
      }
    },
    async start(options?: AudioInputOptions): Promise<AudioInputSession> {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio capture is not available in this browser context");
      }
      const sampleRateHz = options?.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext({ sampleRate: sampleRateHz });
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1);
      // A `ScriptProcessorNode` only fires `audioprocess` while connected to
      // a destination; route through a silent gain node so capture never
      // plays the microphone back out loud.
      const mute = context.createGain();
      mute.gain.value = 0;
      const listeners = new Set<(chunk: AudioInputChunk) => void>();

      processor.addEventListener("audioprocess", (event) => {
        const data = floatTo16BitPcm(event.inputBuffer.getChannelData(0));
        const chunk: AudioInputChunk = {
          data,
          sampleRateHz: context.sampleRate,
          timestampMs: Date.now(),
        };
        for (const listener of listeners) listener(chunk);
      });

      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);

      return {
        async stop() {
          processor.disconnect();
          mute.disconnect();
          source.disconnect();
          for (const track of stream.getTracks()) track.stop();
          await context.close();
        },
        onChunk(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    },
  };
}
