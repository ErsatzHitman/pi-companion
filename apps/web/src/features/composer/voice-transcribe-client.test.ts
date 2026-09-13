import { describe, expect, it, vi } from "vitest";

import { resolveTranscribeClient } from "./voice-transcribe-client.js";

describe("resolveTranscribeClient (T277 web close, T282 pattern)", () => {
  it("returns undefined with no live client (honest transcription-unavailable, never a fake)", () => {
    expect(resolveTranscribeClient(null)).toBeUndefined();
    expect(resolveTranscribeClient(undefined)).toBeUndefined();
    expect(resolveTranscribeClient({})).toBeUndefined();
  });

  it("narrows the live client to its transcribeVoiceClip method, unchanged", async () => {
    const transcribeVoiceClip = vi.fn(async () => ({ text: "commit the fix", error: null }));
    const client = { transcribeVoiceClip };
    const resolved = resolveTranscribeClient(client);
    expect(resolved).toBeDefined();

    const result = await resolved!.transcribeVoiceClip({ audioBase64: "QUJD", format: "m4a" });
    expect(result).toEqual({ text: "commit the fix", error: null });
    expect(transcribeVoiceClip).toHaveBeenCalledWith({ audioBase64: "QUJD", format: "m4a" });
  });

  it("a clip resolves through the daemon when connected instead of transcription-unavailable", async () => {
    const transcribeVoiceClip = vi.fn(async () => ({ text: "hello from groq", error: null }));
    const resolved = resolveTranscribeClient({ transcribeVoiceClip });
    expect(resolved).toBeDefined();
    const result = await resolved!.transcribeVoiceClip({
      audioBase64: "AAAA",
      format: "audio/m4a",
    });
    expect(result.text).toBe("hello from groq");
    expect(result.error).toBeNull();
  });
});
