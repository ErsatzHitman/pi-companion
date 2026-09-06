/**
 * T36F coverage for the real, native-backed `ShareIntentPort`.
 *
 * Same technique as `../../platform/haptics/vibration-platform.test.ts`:
 * `expo-modules-core` reaches React Native and cannot be transformed by
 * this workspace's plain `vitest` setup, so `requireOptionalNativeModule`
 * is replaced with a controllable fixture via `vi.mock` before the
 * module under test is imported. `createShareIntentPortFromNativeModule`
 * and `parseNativeSharePayload` never import `expo-modules-core`
 * themselves, so most of the tests below exercise them directly against
 * a scripted fake `ShareIntentNativeModule` with no mocking involved at
 * all — only the small `createNativeShareIntentPort` block needs the
 * mock.
 *
 * **What is proven here, and what is not**: this proves the JS-side
 * conversion and orchestration end to end against a scripted stand-in
 * for `ShareIntentModule.kt` — never the real Kotlin, which no gate in
 * this repo can compile or run (see this feature's task report). The
 * "queued while not listening" tests below model exactly the contract
 * `ShareIntentModule.kt`'s `OnNewIntent`/`OnStartObserving` pair
 * documents (queue when no listener is attached, replay the moment one
 * attaches) by having the *fake* module reproduce that same contract in
 * its `addListener` — proving this file's `subscribe()` forwards a
 * replay correctly, not that the real native queue exists. A real
 * device is still the only thing that can confirm `OnStartObserving`
 * actually fires at that exact moment (see this feature's task report).
 */
import { describe, expect, it, vi } from "vitest";

import { classifyShareIntent } from "./share-intent-model";
import type { ShareIntentNativeModule } from "./share-intent-native-port.js";

const nativeModuleFixture = vi.hoisted(() => {
  return {
    resolveValue: null as unknown,
    requireOptionalNativeModule: vi.fn(() => nativeModuleFixture.resolveValue),
  };
});

vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: nativeModuleFixture.requireOptionalNativeModule,
}));

const {
  createNativeShareIntentPort,
  createShareIntentPortFromNativeModule,
  parseNativeSharePayload,
} = await import("./share-intent-native-port.js");

/** A minimal scripted fake matching `ShareIntentNativeModule`'s real shape. */
function fakeNativeModule(
  overrides: Partial<ShareIntentNativeModule> = {},
): ShareIntentNativeModule {
  return {
    async getInitialShareIntent() {
      return null;
    },
    addListener() {
      return { remove() {} };
    },
    ...overrides,
  };
}

describe("parseNativeSharePayload", () => {
  it("passes through a well-formed text payload", () => {
    expect(parseNativeSharePayload({ action: "SEND", mimeType: "text/plain", text: "hi" })).toEqual(
      {
        action: "SEND",
        mimeType: "text/plain",
        text: "hi",
        file: undefined,
      },
    );
  });

  it("passes through a well-formed file payload with an image content:// URI", () => {
    const result = parseNativeSharePayload({
      action: "SEND",
      mimeType: "image/png",
      file: {
        name: "photo.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        uri: "content://media/external/images/1",
      },
    });
    expect(result).toEqual({
      action: "SEND",
      mimeType: "image/png",
      text: undefined,
      file: {
        name: "photo.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        uri: "content://media/external/images/1",
      },
    });
  });

  it("coerces a malformed extras bag rather than throwing or dropping it", () => {
    // No `action`, no `mimeType`, a non-object `file` — the shape a real
    // OS extras bag could plausibly deliver if something upstream (a
    // buggy sender app) omitted required fields.
    expect(parseNativeSharePayload({ file: "not-an-object" })).toEqual({
      action: "",
      mimeType: "",
      text: undefined,
      file: undefined,
    });
  });

  it("returns null for a payload that cannot be an intent at all", () => {
    expect(parseNativeSharePayload(null)).toBeNull();
    expect(parseNativeSharePayload("garbage")).toBeNull();
    expect(parseNativeSharePayload(42)).toBeNull();
  });
});

describe("real Intent shapes reach classifyShareIntent as a draft or a named refusal", () => {
  it("ACTION_SEND text/plain is accepted as text", () => {
    const parsed = parseNativeSharePayload({
      action: "SEND",
      mimeType: "text/plain",
      text: "remember this",
    });
    const result = classifyShareIntent(parsed!);
    expect(result).toEqual({
      accepted: true,
      content: { kind: "text", text: "remember this", looksSecretShaped: false },
    });
  });

  it("ACTION_SEND with an image content:// URI is accepted as a file", () => {
    const parsed = parseNativeSharePayload({
      action: "SEND",
      mimeType: "image/jpeg",
      file: {
        name: "IMG_1.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4096,
        uri: "content://media/1",
      },
    });
    const result = classifyShareIntent(parsed!);
    expect(result).toEqual({
      accepted: true,
      content: {
        kind: "file",
        name: "IMG_1.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4096,
        uri: "content://media/1",
      },
    });
  });

  it("ACTION_SEND_MULTIPLE is refused by name, not silently dropped", () => {
    const parsed = parseNativeSharePayload({ action: "SEND_MULTIPLE", mimeType: "image/jpeg" });
    const result = classifyShareIntent(parsed!);
    expect(result.accepted).toBe(false);
    expect((result as { reason: string }).reason).toBe("unsupported-action");
  });

  it("a malformed extras bag (no action, no mimeType) is refused by name", () => {
    const parsed = parseNativeSharePayload({ someUnexpectedField: true });
    const result = classifyShareIntent(parsed!);
    expect(result.accepted).toBe(false);
    expect((result as { reason: string }).reason).toBe("unsupported-action");
  });

  it("a missing MIME type on an otherwise-plausible text share is refused by name", () => {
    const parsed = parseNativeSharePayload({ action: "SEND", text: "hello" });
    const result = classifyShareIntent(parsed!);
    expect(result.accepted).toBe(false);
    expect((result as { reason: string }).reason).toBe("unsupported-type");
  });
});

describe("createShareIntentPortFromNativeModule", () => {
  it("getInitialShareIntent forwards a parsed payload from the native module", async () => {
    const native = fakeNativeModule({
      async getInitialShareIntent() {
        return { action: "SEND", mimeType: "text/plain", text: "shared from cold start" };
      },
    });
    const port = createShareIntentPortFromNativeModule(native);
    expect(await port.getInitialShareIntent()).toEqual({
      action: "SEND",
      mimeType: "text/plain",
      text: "shared from cold start",
      file: undefined,
    });
  });

  it("getInitialShareIntent resolves null when the native module reports no launch share", async () => {
    const port = createShareIntentPortFromNativeModule(fakeNativeModule());
    expect(await port.getInitialShareIntent()).toBeNull();
  });

  it("getInitialShareIntent resolves null, never throws, when the native call rejects", async () => {
    const native = fakeNativeModule({
      async getInitialShareIntent() {
        throw new Error("no current activity yet");
      },
    });
    const port = createShareIntentPortFromNativeModule(native);
    await expect(port.getInitialShareIntent()).resolves.toBeNull();
  });

  it("subscribe delivers an actually-received event to the handler, not just a registered listener", () => {
    let deliver: ((payload: unknown) => void) | null = null;
    const native = fakeNativeModule({
      addListener(_eventName, listener) {
        deliver = listener;
        return { remove() {} };
      },
    });
    const port = createShareIntentPortFromNativeModule(native);
    const received: unknown[] = [];
    port.subscribe((intent) => received.push(intent));

    expect(received).toHaveLength(0); // registering alone delivers nothing
    deliver!({ action: "SEND", mimeType: "text/plain", text: "warm share" });
    expect(received).toEqual([
      { action: "SEND", mimeType: "text/plain", text: "warm share", file: undefined },
    ]);
  });

  it("unsubscribing calls the native subscription's remove()", () => {
    const removeSpy = vi.fn();
    const native = fakeNativeModule({
      addListener() {
        return { remove: removeSpy };
      },
    });
    const port = createShareIntentPortFromNativeModule(native);
    const unsubscribe = port.subscribe(() => {});
    expect(removeSpy).not.toHaveBeenCalled();
    unsubscribe();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it("replays an intent queued before any listener was attached (the fourth acceptance criterion, modeled at this boundary)", () => {
    // Mirrors ShareIntentModule.kt's OnNewIntent/OnStartObserving contract:
    // the fake queues a payload that "arrived" before subscribe() was ever
    // called, then — exactly like the real module's OnStartObserving —
    // delivers it synchronously the moment addListener is invoked.
    let queued: unknown = {
      action: "SEND",
      mimeType: "text/plain",
      text: "arrived while nobody was listening",
    };
    const native = fakeNativeModule({
      addListener(_eventName, listener) {
        if (queued) {
          const toDeliver = queued;
          queued = null;
          listener(toDeliver);
        }
        return { remove() {} };
      },
    });
    const port = createShareIntentPortFromNativeModule(native);
    const received: unknown[] = [];
    port.subscribe((intent) => received.push(intent));

    expect(received).toEqual([
      {
        action: "SEND",
        mimeType: "text/plain",
        text: "arrived while nobody was listening",
        file: undefined,
      },
    ]);
  });
});

describe("createNativeShareIntentPort", () => {
  it("falls back to the unavailable port when the native module isn't linked yet", async () => {
    nativeModuleFixture.resolveValue = null;
    const port = createNativeShareIntentPort();
    expect(nativeModuleFixture.requireOptionalNativeModule).toHaveBeenCalledWith(
      "ShareIntentModule",
    );
    expect(await port.getInitialShareIntent()).toBeNull();
    const handler = vi.fn();
    port.subscribe(handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it("wires a linked native module's real getInitialShareIntent through, not a stand-in", async () => {
    const getInitialShareIntent = vi.fn(async () => ({
      action: "SEND",
      mimeType: "text/plain",
      text: "real module",
    }));
    nativeModuleFixture.resolveValue = fakeNativeModule({ getInitialShareIntent });
    const port = createNativeShareIntentPort();
    const result = await port.getInitialShareIntent();
    expect(getInitialShareIntent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      action: "SEND",
      mimeType: "text/plain",
      text: "real module",
      file: undefined,
    });
  });
});
