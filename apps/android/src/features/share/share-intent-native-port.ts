/**
 * Real Android `ShareIntentPort` (T36F, plan.md §9.3), backed by
 * `../../../modules/share-intent/`'s native `ShareIntentModule`.
 *
 * `share-intent-port.ts` (T36C) defines the seam and documents why no
 * real implementation existed until now: `expo-share-intent` was
 * rejected (unvetted third-party code on the "never log shared
 * content" boundary), bare `expo-linking` was ruled out (would force
 * shared content into a URL), and this task may not `npm install`
 * anything. This module is route 3 from `share-intent-receiver.ts`'s
 * decision record: the small in-repo native module, now written.
 *
 * ---------------------------------------------------------------------
 * Why this file still imports nothing that reaches React Native at the
 * type/logic level, despite calling `expo-modules-core`
 * ---------------------------------------------------------------------
 * `createShareIntentPortFromNativeModule` and `parseNativeSharePayload`
 * take an already-resolved native module object as a plain parameter —
 * they never import `expo-modules-core` themselves and are exercised in
 * `share-intent-native-port.test.ts` against a scripted fake, zero real
 * native code involved (same technique as `../../platform/haptics/
 * vibration-platform.ts`'s `createRNVibrationPlatform`: `vi.mock
 * ("expo-modules-core", …)` before the module under test is imported,
 * so Vitest/Rolldown never has to parse the real package). Only
 * `createNativeShareIntentPort` below — this build's actual production
 * factory — calls `requireOptionalNativeModule` directly; it is a thin,
 * one-line wrapper proven by the same test file's "falls back to the
 * unavailable port when the module isn't linked" case.
 *
 * `requireOptionalNativeModule` (not `requireNativeModule`) is used
 * deliberately: it returns `null` instead of throwing when
 * `ShareIntentModule` is not yet linked into the running binary — the
 * case for every build until someone runs `expo prebuild` for this
 * change (unverifiable in this sandbox; see this feature's task
 * report). Falling back to `createUnavailableShareIntentPort()` in
 * that case means this file is safe to wire up immediately: it never
 * crashes an unbuilt binary, it just behaves exactly as it already did
 * before this task.
 */
import { requireOptionalNativeModule } from "expo-modules-core";

import type { RawShareIntent, RawShareIntentFile } from "./share-intent-model.js";
import { createUnavailableShareIntentPort } from "./share-intent-port.js";
import type { ShareIntentPort } from "./share-intent-port.js";

const NATIVE_MODULE_NAME = "ShareIntentModule";
const EVENT_NAME = "onShareIntent";

/** An Expo Modules `addListener` subscription handle — `EventSubscription`'s actual shape, restated here so this file never has to import the type from `expo-modules-core`. */
export interface NativeEventSubscription {
  remove(): void;
}

/**
 * Shape of `ShareIntentModule` (`../../../modules/share-intent/android/
 * .../ShareIntentModule.kt`) as JS sees it — restated here, not
 * imported from `expo-modules-core`, so this interface (and every
 * function below that takes it as a parameter) stays provable without
 * any real native import. `getInitialShareIntent` and the
 * `onShareIntent` event both hand back `unknown`, not `RawShareIntent`
 * directly: the native boundary is untrusted input exactly like the
 * OS `Intent` it comes from, so it is validated by
 * `parseNativeSharePayload` below rather than trusted at the type
 * level alone.
 */
export interface ShareIntentNativeModule {
  getInitialShareIntent(): Promise<unknown>;
  addListener(
    eventName: typeof EVENT_NAME,
    listener: (payload: unknown) => void,
  ): NativeEventSubscription;
}

/**
 * Narrows an untrusted native payload into a `RawShareIntent`.
 * Returns `null` only for a payload that cannot represent an intent at
 * all (not an object) — every other shape, however incomplete or
 * wrongly typed its fields, is coerced field-by-field (missing/wrong
 * -> `""`/`0`/`undefined`) and passed through, so a genuinely malformed
 * share (e.g. a file entry with no `mimeType`) still reaches
 * `classifyShareIntent` and comes back a **named** refusal
 * (`"unsupported-type"`) rather than being silently dropped here. This
 * mirrors `classifyShareIntent`'s own "never throws, always names the
 * reason" contract one layer earlier, at the one boundary in this
 * feature that crosses out of TypeScript's type system.
 */
export function parseNativeSharePayload(value: unknown): RawShareIntent | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    action: typeof record["action"] === "string" ? record["action"] : "",
    mimeType: typeof record["mimeType"] === "string" ? record["mimeType"] : "",
    text: typeof record["text"] === "string" ? record["text"] : undefined,
    file: parseNativeFile(record["file"]),
  };
}

function parseNativeFile(value: unknown): RawShareIntentFile | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    name: typeof record["name"] === "string" ? record["name"] : "",
    mimeType: typeof record["mimeType"] === "string" ? record["mimeType"] : "",
    sizeBytes: typeof record["sizeBytes"] === "number" ? record["sizeBytes"] : 0,
    uri: typeof record["uri"] === "string" ? record["uri"] : "",
  };
}

/**
 * Builds a `ShareIntentPort` over an already-resolved native module —
 * the provable half of this file. See `share-intent-native-port.test.ts`
 * for: initial-intent forwarding, initial-intent native rejection
 * treated as "no share" (never crashes app startup), subscribe
 * forwarding an actually-received event (not just a registered
 * listener), unsubscribe calling the native subscription's `remove()`,
 * and the queued-before-listening replay property (this feature's
 * fourth acceptance criterion, modeled at this boundary — see that
 * test file's doc comment for exactly what remains for a device to
 * confirm).
 */
export function createShareIntentPortFromNativeModule(
  native: ShareIntentNativeModule,
): ShareIntentPort {
  return {
    async getInitialShareIntent() {
      let raw: unknown;
      try {
        raw = await native.getInitialShareIntent();
      } catch {
        // A native-side failure (e.g. no current activity yet) must never
        // crash startup — treat it as "no share", same as a genuine null.
        return null;
      }
      if (raw === null || raw === undefined) return null;
      return parseNativeSharePayload(raw);
    },

    subscribe(handler) {
      const subscription = native.addListener(EVENT_NAME, (payload) => {
        const parsed = parseNativeSharePayload(payload);
        if (parsed) handler(parsed);
      });
      return () => subscription.remove();
    },
  };
}

/**
 * This build's real production `ShareIntentPort` factory — replaces
 * `createUnavailableShareIntentPort()` at whatever seam
 * `T32S12` wires (see this feature's task report for the exact call
 * site handed to it). Never imported by a test directly for that
 * reason: this is the one line in this file that actually touches
 * `expo-modules-core`.
 */
export function createNativeShareIntentPort(): ShareIntentPort {
  const native = requireOptionalNativeModule<ShareIntentNativeModule>(NATIVE_MODULE_NAME);
  if (!native) return createUnavailableShareIntentPort();
  return createShareIntentPortFromNativeModule(native);
}
