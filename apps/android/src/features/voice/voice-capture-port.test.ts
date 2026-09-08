import { describe, expect, it } from "vitest";

import { createUnavailableVoiceCapturePort } from "./voice-capture-port";

describe("createUnavailableVoiceCapturePort — an explicit 'no capture' VoiceCapturePort (no longer the only or default production one — see expo-audio-voice-capture-port.test.ts for T276's real port)", () => {
  it("reports unavailable for both permission reads, without prompting anything", async () => {
    const port = createUnavailableVoiceCapturePort();
    expect(await port.getPermissionStatus()).toBe("unavailable");
    expect(await port.requestPermission()).toBe("unavailable");
  });

  it("start/cancel resolve without throwing (nothing to start or discard)", async () => {
    const port = createUnavailableVoiceCapturePort();
    await expect(port.start()).resolves.toBeUndefined();
    await expect(port.cancel()).resolves.toBeUndefined();
  });

  it("stop() resolves an empty transcript — never a non-empty one that could be silently sent", async () => {
    const port = createUnavailableVoiceCapturePort();
    const result = await port.stop();
    expect(result).toEqual({ kind: "transcript", text: "" });
  });
});
