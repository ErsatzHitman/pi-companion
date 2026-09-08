/**
 * T276 coverage for the real `createExpoAudioVoiceCapturePort` adapter.
 *
 * Same technique as `apps/android/src/platform/haptics/
 * vibration-platform.test.ts`: `expo-audio` transitively imports
 * `react-native` (its `ExpoAudio.js` does `import { Platform } from
 * "react-native"`), which this workspace's plain `vitest` setup cannot
 * transform (the "RN-in-vitest limitation" — see
 * `expo-audio-voice-capture-port.ts`'s own header). `expo-audio` is
 * replaced with a controllable fixture via a `vi.mock` factory, hoisted
 * to the top of this file, before the module under test is imported —
 * so the real native package, and the real `react-native` it would drag
 * in, is never actually loaded here, in ANY test in this file (the
 * module under test's own top-level `import ... from "expo-audio"`
 * always runs, regardless of which `VoiceCaptureBindings` a given test
 * injects).
 *
 * Two proof strategies:
 *  - Most of this suite injects a plain fake `VoiceCaptureBindings`
 *    directly (no interaction with the mocked `expo-audio` fixture at
 *    all) to prove the port's own composition logic — permission
 *    mapping, the start/stop/cancel call sequence, the T83
 *    exactly-once-permission invariant.
 *  - The last block proves `DEFAULT_BINDINGS` itself — the object that
 *    actually wires to `expo-audio` — by calling
 *    `createExpoAudioVoiceCapturePort()` with NO arguments and reading
 *    the mocked fixture's own recorded calls/constructor options.
 */
import { describe, expect, it, vi } from "vitest";

import type { PermissionState } from "../composer/permission-recovery.js";
import type { VoiceCaptureOutcome } from "./voice-capture-port.js";
import type {
  ExpoPermissionResponse,
  RecorderHandle,
  VoiceCaptureBindings,
} from "./expo-audio-voice-capture-port.js";

const audioFixture = vi.hoisted(() => {
  const state: {
    permission: { granted: boolean; status: string; canAskAgain: boolean };
    recorderInstances: {
      options: unknown;
      uri: string | null;
      calls: { prepareToRecordAsync: number; record: number; stop: number; release: number };
    }[];
    getRecordingPermissionsAsyncCalls: number;
    requestRecordingPermissionsAsyncCalls: number;
  } = {
    permission: { granted: true, status: "granted", canAskAgain: true },
    recorderInstances: [],
    getRecordingPermissionsAsyncCalls: 0,
    requestRecordingPermissionsAsyncCalls: 0,
  };

  class FakeAudioRecorder {
    options: unknown;
    uri: string | null = "file:///default-clip.m4a";
    calls = { prepareToRecordAsync: 0, record: 0, stop: 0, release: 0 };
    constructor(options: unknown) {
      this.options = options;
      state.recorderInstances.push(this);
    }
    async prepareToRecordAsync() {
      this.calls.prepareToRecordAsync += 1;
    }
    record() {
      this.calls.record += 1;
    }
    async stop() {
      this.calls.stop += 1;
    }
    release() {
      this.calls.release += 1;
    }
  }

  return {
    state,
    FakeAudioRecorder,
    reset() {
      state.permission = { granted: true, status: "granted", canAskAgain: true };
      state.recorderInstances = [];
      state.getRecordingPermissionsAsyncCalls = 0;
      state.requestRecordingPermissionsAsyncCalls = 0;
    },
  };
});

vi.mock("expo-audio", () => ({
  AudioModule: { AudioRecorder: audioFixture.FakeAudioRecorder },
  async getRecordingPermissionsAsync() {
    audioFixture.state.getRecordingPermissionsAsyncCalls += 1;
    return audioFixture.state.permission;
  },
  async requestRecordingPermissionsAsync() {
    audioFixture.state.requestRecordingPermissionsAsyncCalls += 1;
    return audioFixture.state.permission;
  },
}));

const { createExpoAudioVoiceCapturePort, readClipAsBase64 } =
  await import("./expo-audio-voice-capture-port.js");

function permission(
  granted: boolean,
  status: string,
  canAskAgain: boolean,
): ExpoPermissionResponse {
  return { granted, status, canAskAgain };
}

function createFakeRecorder(uri: string | null): RecorderHandle & {
  calls: { prepareToRecordAsync: number; record: number; stop: number; release: number };
} {
  const calls = { prepareToRecordAsync: 0, record: 0, stop: 0, release: 0 };
  return {
    calls,
    uri,
    async prepareToRecordAsync() {
      calls.prepareToRecordAsync += 1;
    },
    record() {
      calls.record += 1;
    },
    async stop() {
      calls.stop += 1;
    },
    release() {
      calls.release += 1;
    },
  };
}

function createFakeBindings(overrides?: {
  permission?: ExpoPermissionResponse;
  recorder?: ReturnType<typeof createFakeRecorder>;
  audioBase64?: string;
}): VoiceCaptureBindings & {
  calls: {
    getRecordingPermissionsAsync: number;
    requestRecordingPermissionsAsync: number;
    createRecorder: number;
    readClipAsBase64: string[];
  };
} {
  const perm = overrides?.permission ?? permission(true, "granted", true);
  const recorder = overrides?.recorder ?? createFakeRecorder("file:///clip.m4a");
  const calls = {
    getRecordingPermissionsAsync: 0,
    requestRecordingPermissionsAsync: 0,
    createRecorder: 0,
    readClipAsBase64: [] as string[],
  };
  return {
    calls,
    async getRecordingPermissionsAsync() {
      calls.getRecordingPermissionsAsync += 1;
      return perm;
    },
    async requestRecordingPermissionsAsync() {
      calls.requestRecordingPermissionsAsync += 1;
      return perm;
    },
    createRecorder() {
      calls.createRecorder += 1;
      return recorder;
    },
    async readClipAsBase64(uri: string) {
      calls.readClipAsBase64.push(uri);
      return overrides?.audioBase64 ?? "ZmFrZS1hdWRpby1ieXRlcw==";
    },
  };
}

describe("createExpoAudioVoiceCapturePort — permission mapping", () => {
  it.each<[boolean, string, boolean, PermissionState]>([
    [true, "granted", true, "granted"],
    [false, "denied", true, "denied"],
    [false, "denied", false, "denied-permanently"],
    [false, "undetermined", true, "undetermined"],
  ])(
    "granted=%s status=%s canAskAgain=%s -> %s",
    async (granted, status, canAskAgain, expected) => {
      const bindings = createFakeBindings({ permission: permission(granted, status, canAskAgain) });
      const port = createExpoAudioVoiceCapturePort(bindings);

      expect(await port.getPermissionStatus()).toBe(expected);
      expect(await port.requestPermission()).toBe(expected);
    },
  );

  it("getPermissionStatus never calls requestRecordingPermissionsAsync, and vice versa", async () => {
    const bindings = createFakeBindings();
    const port = createExpoAudioVoiceCapturePort(bindings);

    await port.getPermissionStatus();
    expect(bindings.calls.getRecordingPermissionsAsync).toBe(1);
    expect(bindings.calls.requestRecordingPermissionsAsync).toBe(0);

    await port.requestPermission();
    expect(bindings.calls.requestRecordingPermissionsAsync).toBe(1);
    expect(bindings.calls.getRecordingPermissionsAsync).toBe(1);
  });
});

describe("createExpoAudioVoiceCapturePort — start()/stop()/cancel() wiring", () => {
  it("start() prepares and records, in that order, on a freshly created recorder", async () => {
    const recorder = createFakeRecorder("file:///clip.m4a");
    const bindings = createFakeBindings({ recorder });
    const port = createExpoAudioVoiceCapturePort(bindings);

    await port.start();

    expect(bindings.calls.createRecorder).toBe(1);
    expect(recorder.calls.prepareToRecordAsync).toBe(1);
    expect(recorder.calls.record).toBe(1);
  });

  it("T83: start() never touches either permission binding — the one-resolution-per-press invariant holds even for a real port", async () => {
    const bindings = createFakeBindings();
    const port = createExpoAudioVoiceCapturePort(bindings);

    await port.start();

    expect(bindings.calls.getRecordingPermissionsAsync).toBe(0);
    expect(bindings.calls.requestRecordingPermissionsAsync).toBe(0);
  });

  it("stop() stops the active recorder, releases it, reads its uri, and resolves a base64 audio outcome", async () => {
    const recorder = createFakeRecorder("file:///clip.m4a");
    const bindings = createFakeBindings({ recorder, audioBase64: "c29tZS1hdWRpbw==" });
    const port = createExpoAudioVoiceCapturePort(bindings);

    await port.start();
    const outcome = await port.stop();

    expect(recorder.calls.stop).toBe(1);
    expect(recorder.calls.release).toBe(1);
    expect(bindings.calls.readClipAsBase64).toEqual(["file:///clip.m4a"]);
    const expected: VoiceCaptureOutcome = {
      kind: "audio",
      audioBase64: "c29tZS1hdWRpbw==",
      format: "audio/m4a",
    };
    expect(outcome).toEqual(expected);
  });

  it("stop() resolves an empty transcript, never reading a clip, when the recorder produced no uri", async () => {
    const recorder = createFakeRecorder(null);
    const bindings = createFakeBindings({ recorder });
    const port = createExpoAudioVoiceCapturePort(bindings);

    await port.start();
    const outcome = await port.stop();

    expect(outcome).toEqual({ kind: "transcript", text: "" });
    expect(bindings.calls.readClipAsBase64).toEqual([]);
  });

  it("stop() without a prior start() is a safe no-op, never calling createRecorder", async () => {
    const bindings = createFakeBindings();
    const port = createExpoAudioVoiceCapturePort(bindings);

    const outcome = await port.stop();

    expect(outcome).toEqual({ kind: "transcript", text: "" });
    expect(bindings.calls.createRecorder).toBe(0);
  });

  it("cancel() stops and releases the recorder but never reads its clip — nothing captured on a cancel ever leaves this port", async () => {
    const recorder = createFakeRecorder("file:///clip.m4a");
    const bindings = createFakeBindings({ recorder });
    const port = createExpoAudioVoiceCapturePort(bindings);

    await port.start();
    await port.cancel();

    expect(recorder.calls.stop).toBe(1);
    expect(recorder.calls.release).toBe(1);
    expect(bindings.calls.readClipAsBase64).toEqual([]);
  });

  it("cancel() with nothing recording is a safe no-op", async () => {
    const bindings = createFakeBindings();
    const port = createExpoAudioVoiceCapturePort(bindings);

    await expect(port.cancel()).resolves.toBeUndefined();
  });

  it("a second stop() after one already resolved is a safe no-op (activeRecorder was cleared)", async () => {
    const recorder = createFakeRecorder("file:///clip.m4a");
    const bindings = createFakeBindings({ recorder });
    const port = createExpoAudioVoiceCapturePort(bindings);

    await port.start();
    await port.stop();
    const second = await port.stop();

    expect(second).toEqual({ kind: "transcript", text: "" });
    expect(recorder.calls.stop).toBe(1); // not called again
  });
});

/**
 * MUTATION (CLAUDE.md "a fix that no test can fail is not a fix"): a
 * speculative permission precheck —
 * `await bindings.getRecordingPermissionsAsync();` as the first line of
 * `start()` — was added to a scratch copy of
 * `expo-audio-voice-capture-port.ts` and confirmed to fail this file's
 * "start() never touches either permission binding" test
 * (`0 !== 1`) before the scratch copy was discarded and the real
 * production file was confirmed unchanged. See this task's final report
 * for the real `vitest` output for both the passing and failing runs.
 */

describe("createExpoAudioVoiceCapturePort() with no arguments — the real DEFAULT_BINDINGS wired to expo-audio", () => {
  it("getPermissionStatus()/requestPermission() reach the mocked expo-audio functions directly", async () => {
    audioFixture.reset();
    audioFixture.state.permission = { granted: false, status: "denied", canAskAgain: false };
    const port = createExpoAudioVoiceCapturePort();

    expect(await port.getPermissionStatus()).toBe("denied-permanently");
    expect(audioFixture.state.getRecordingPermissionsAsyncCalls).toBe(1);

    expect(await port.requestPermission()).toBe("denied-permanently");
    expect(audioFixture.state.requestRecordingPermissionsAsyncCalls).toBe(1);
  });

  it("start() constructs a real AudioModule.AudioRecorder configured for 16 kHz mono AAC/m4a, then prepares and records", async () => {
    audioFixture.reset();
    const port = createExpoAudioVoiceCapturePort();

    await port.start();

    expect(audioFixture.state.recorderInstances).toHaveLength(1);
    const recorder = audioFixture.state.recorderInstances[0];
    expect(recorder?.options).toMatchObject({
      extension: ".m4a",
      sampleRate: 16000,
      numberOfChannels: 1,
      outputFormat: "mpeg4",
      audioEncoder: "aac",
    });
    expect(recorder?.calls.prepareToRecordAsync).toBe(1);
    expect(recorder?.calls.record).toBe(1);
  });
});

/**
 * `readClipAsBase64` is React Native's own `fetch`/`Blob`/`FileReader`
 * globals, not `expo-audio` — this workspace's plain `vitest` (Node)
 * environment has neither `Blob` payload plumbed through a real
 * `FileReader` nor `FileReader` itself as a global, so both are stubbed
 * here, minimally, to prove the one piece of real logic this function
 * has: stripping the `data:...;base64,` prefix `readAsDataURL` always
 * produces.
 */
describe("readClipAsBase64 — the data-URI-to-base64 extraction, no expo-file-system involved", () => {
  it("returns only the payload after the first comma of the data URI FileReader produces", async () => {
    const originalFetch = globalThis.fetch;
    const originalFileReader = globalThis.FileReader;
    globalThis.fetch = (async () => ({
      blob: async () => ({ size: 3 }),
    })) as unknown as typeof fetch;
    class StubFileReader {
      result: string | null = null;
      onerror: (() => void) | null = null;
      onloadend: (() => void) | null = null;
      readAsDataURL() {
        this.result = "data:audio/m4a;base64,c29tZS1jbGlwLWJ5dGVz";
        this.onloadend?.();
      }
    }
    globalThis.FileReader = StubFileReader as unknown as typeof FileReader;

    try {
      const base64 = await readClipAsBase64("file:///clip.m4a");
      expect(base64).toBe("c29tZS1jbGlwLWJ5dGVz");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.FileReader = originalFileReader;
    }
  });

  it("rejects when FileReader reports an error, rather than resolving garbage", async () => {
    const originalFetch = globalThis.fetch;
    const originalFileReader = globalThis.FileReader;
    globalThis.fetch = (async () => ({
      blob: async () => ({ size: 3 }),
    })) as unknown as typeof fetch;
    class FailingFileReader {
      result: string | null = null;
      error = new Error("boom");
      onerror: (() => void) | null = null;
      onloadend: (() => void) | null = null;
      readAsDataURL() {
        this.onerror?.();
      }
    }
    globalThis.FileReader = FailingFileReader as unknown as typeof FileReader;

    try {
      await expect(readClipAsBase64("file:///clip.m4a")).rejects.toThrow("boom");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.FileReader = originalFileReader;
    }
  });
});
