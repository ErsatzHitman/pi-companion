/**
 * The real, `expo-audio`-backed `VoiceCapturePort` (T276, plan.md
 * §9.2/§12.4).
 *
 * Deliberately a SEPARATE file from `voice-capture-port.ts`, which
 * declares the `VoiceCapturePort` contract and
 * `createUnavailableVoiceCapturePort` and stays completely
 * `react-native`-free. This file's top-level `import ... from
 * "expo-audio"` is not: `expo-audio`'s own `ExpoAudio.js` does
 * `import { Platform } from "react-native"`, so importing this module
 * transitively imports `react-native` — exactly the "RN-in-vitest
 * limitation" this repository's `CLAUDE.md` catalogues (any test
 * importing a module that reaches `react-native` fails with a
 * RolldownError). Splitting the real implementation out here is what
 * keeps `voice-capture-port.ts` — and every existing test that imports
 * it directly (`voice-capture-port.test.ts`, `voice-model.ts`,
 * `mic-press-model.ts`/`.test.ts`) — untouched by that limitation. This
 * file's own test (`./expo-audio-voice-capture-port.test.ts`) proves
 * itself the same way `apps/android/src/platform/haptics/
 * vibration-platform.test.ts` proves its real `react-native` binding:
 * `vi.mock("expo-audio", ...)` before a dynamic `import()` of the
 * module under test, so the real native package — and the real
 * `react-native` it would drag in — is never actually loaded.
 *
 * ## Dependency: settled, not re-derived here
 *
 * `expo-audio@~1.0.13` (resolves 1.0.16) was installed by the owner at
 * `fad6be1` for this exact task — see `docs/issues-from-plan.md`'s T276
 * section, which forbids re-opening that question, and confirms
 * `expo-av` (deprecated) and `@picompanion/expo-two-way-audio` (a live
 * two-way stream API, wrong shape for clip capture) were both measured
 * and rejected.
 *
 * ## `expo-file-system` is NOT used here, and that was measured, not assumed
 *
 * T276's own brief says `expo-file-system` "is already installed for
 * reading the finished clip." That is not true of `apps/android`
 * specifically, checked directly against this repository's own
 * `package-lock.json` rather than trusted on the brief's word:
 * `apps/android/package.json` declares no `expo-file-system` dependency
 * at all. The only *importable* copy from `apps/android/src` — Node's
 * module resolution walks from the importing file up through
 * `apps/android/node_modules` (no `expo-file-system` there) to the
 * *repository root* `node_modules/expo-file-system` — resolves to
 * version `57.0.6`, declared as a real dependency of a root-hoisted
 * `expo@57.0.18` that belongs to a completely different Expo SDK
 * generation than this app's own (`apps/android/node_modules/
 * expo@54.0.37`, matching `apps/android/package.json`'s `"expo":
 * "^54.0.18"`) — the exact "root hoist from a different worktree's
 * install" contamination `attachment-source-port.ts`'s own doc comment
 * already warns about for a different package pair. The version this
 * app's own `expo@54.0.37` actually needs
 * (`apps/android/node_modules/expo/package.json`'s own
 * `"expo-file-system": "~19.0.24"`) IS correctly nested in
 * `package-lock.json` at `apps/android/node_modules/expo/node_modules/
 * expo-file-system@19.0.24` — but that copy is only reachable by
 * `expo`'s own internal imports, never by a plain `import ... from
 * "expo-file-system"` written in `apps/android/src`, which is not
 * declared to resolve there. Relying on it here would mean importing an
 * undeclared dependency that resolves, today, to the wrong SDK's
 * version. This task may not edit `package.json` to fix that (npm
 * install/dependency edits are refused), so this module reads the
 * finished clip and encodes it to base64 using only globals React
 * Native itself already ships — `fetch`/`Blob`/`FileReader`
 * (`readClipAsBase64` below) — needing no new dependency at all.
 *
 * ## Format: REQUESTED 16 kHz mono, not measured — disclosed, not assumed
 *
 * `ANDROID_RECORDING_OPTIONS` below requests `sampleRate: 16000,
 * numberOfChannels: 1` explicitly (neither shipped `RecordingPresets`
 * is 16 kHz mono — both are 44100 Hz AND both are stereo,
 * `numberOfChannels: 2`; they differ only in `bitRate` and in
 * `LOW_QUALITY`'s AMR-NB/`.3gp` Android override. CORRECTED at the
 * P9-O merge gate: this said "`HIGH_QUALITY` is stereo, `LOW_QUALITY`
 * mono at 44100", which is false for `LOW_QUALITY` — read back from
 * `node_modules/expo-audio/build/RecordingConstants.js`, where
 * `LOW_QUALITY.numberOfChannels` is `2`. The conclusion the clause
 * supports never depended on it — neither preset is 16 kHz — which is
 * why a sentence half-wrong about the package survived.) **This task's brief requires reading
 * the produced recording's ACTUAL sample rate/channel count back and
 * stating the MEASURED values here, never the requested ones — that
 * could not be done in this environment.** There is no Android
 * device/emulator attached to this sandbox, and this repository's
 * `CLAUDE.md` forbids starting the long-running, interactive process an
 * emulator boot would be as part of verification. It is also not simply
 * a matter of adding a step: read directly from `expo-audio`'s own type
 * declarations (`node_modules/expo-audio/build/Audio.types.d.ts`),
 * neither `RecorderState` (`canRecord`/`isRecording`/`durationMillis`/
 * `mediaServicesDidReset`/`metering`/`url`) nor `RecordingStatus`
 * (`id`/`isFinished`/`hasError`/`error`/`url`) exposes a sample-rate or
 * channel-count field at all — there is no JS-level API on this package
 * to read either back, even on a real device. The only faithful
 * measurement is external, off the produced `.m4a`'s own container
 * header (for example `ffprobe` on a copy of the file pulled off
 * device, or Android's own `MediaExtractor`/`MediaFormat` reading the
 * decoded track's `KEY_SAMPLE_RATE`/`KEY_CHANNEL_COUNT`), since a
 * device's AAC encoder is not guaranteed to honor an unusual requested
 * rate. **Whoever first runs this on a real device must perform that
 * measurement and replace this paragraph with the real figures, citing
 * the run — do not treat the requested values above as a substitute.**
 *
 * ## The permission invariant (T83) is preserved structurally
 *
 * `start()` below never reads or requests permission itself — see its
 * own comment. `voice-model.ts`'s `requestStart()` is the only caller,
 * and it already resolves permission exactly once
 * (`../composer/permission-recovery.js`'s `resolvePermission`) before
 * ever calling `port.start()` — the same structural guarantee
 * `mic-press-model.test.ts`'s counting-fake proof already covers for
 * every `VoiceCapturePort`, this one included, since nothing about that
 * call graph changes with a real port swapped in.
 * `expo-audio-voice-capture-port.test.ts`'s own counting-bindings test
 * below additionally proves THIS module's `start()` never calls either
 * permission binding — closing the one gap a real implementation could
 * introduce that the generic counting-fake in `mic-press-model.test.ts`
 * cannot see (it fakes the whole port; this proves the concrete one).
 *
 * ## The one disclosed gap: a cancelled recording's file is not deleted
 *
 * `cancel()` stops the native recorder and releases the microphone
 * immediately (the urgent half of `voice-model.ts`'s own
 * "a background app should not go on holding an open microphone
 * unattended" contract) and never reads the cancelled clip's bytes into
 * memory, so nothing captured on a cancelled recording ever reaches the
 * outbox, the network, or this port's own caller. It does NOT delete
 * the finished file from the device's private cache/document directory
 * — doing that needs a real filesystem-delete call, which is exactly
 * the `expo-file-system` capability this module deliberately does not
 * depend on (see above). The file sits in this app's own private
 * storage (never a shared/public directory), inaccessible to any other
 * app, until the OS or this app's own cache-clearing reclaims it — a
 * real but bounded exposure, not a silent one. Closing it needs either
 * `expo-file-system` (with the dependency question above resolved
 * first) or a different native deletion primitive; filed here by name
 * for whichever task picks it up next.
 */
import {
  AudioModule,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from "expo-audio";

import type { PermissionState } from "../composer/permission-recovery.js";
import type { VoiceCaptureOutcome, VoiceCapturePort } from "./voice-capture-port.js";

/** The container/format tag carried on every `{ kind: "audio" }` outcome this port resolves. */
const RECORDING_FORMAT = "audio/m4a";

/**
 * REQUESTED capture format — see this module's header for why these are
 * requested, not measured, values. Already flattened to the shape
 * `expo-audio`'s own (unexported) `createRecordingOptions()` helper
 * would produce for `Platform.OS === "android"`
 * (`{ ...commonFields, ...options.android }`, read directly from
 * `node_modules/expo-audio/build/ExpoAudio.js`/`utils/options.js`) —
 * this app is Android-only (`CLAUDE.md`: "apps/android is Android-only"),
 * so there is no second platform branch to support, and reproducing
 * that merge here avoids depending on a helper the package does not
 * export publicly. Passed straight to `AudioModule.AudioRecorder`'s own
 * constructor (mirroring exactly what `expo-audio`'s `useAudioRecorder`
 * hook does internally: `new AudioModule.AudioRecorder(createRecordingOptions(options))`),
 * then `prepareToRecordAsync()` is called with no arguments, reusing
 * this configuration — the same two-call shape that hook's own doc
 * comment example uses.
 */
const ANDROID_RECORDING_OPTIONS = {
  extension: ".m4a",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: false,
  outputFormat: "mpeg4",
  audioEncoder: "aac",
};

/** The minimal `expo-audio` `AudioRecorder` surface this port actually calls — narrowed for injection, same "narrow surface" pattern as `../composer/permission-recovery.ts`'s `PermissionPort`. */
export interface RecorderHandle {
  prepareToRecordAsync(): Promise<void>;
  record(): void;
  stop(): Promise<void>;
  readonly uri: string | null;
  release(): void;
}

/** The exact fields this port reads off `expo-modules-core`'s `PermissionResponse` — narrowed the same way. */
export interface ExpoPermissionResponse {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}

/** Everything this port needs from `expo-audio`, injectable so `./expo-audio-voice-capture-port.test.ts` never has to load the real native module. */
export interface VoiceCaptureBindings {
  getRecordingPermissionsAsync(): Promise<ExpoPermissionResponse>;
  requestRecordingPermissionsAsync(): Promise<ExpoPermissionResponse>;
  /** Builds one fresh, already-configured `AudioRecorder` — see `ANDROID_RECORDING_OPTIONS` above. */
  createRecorder(): RecorderHandle;
  /** Reads a finished recording's own file (`recorder.uri`) and returns its bytes as base64 — no data-URI prefix. */
  readClipAsBase64(uri: string): Promise<string>;
}

/**
 * `expo-audio`'s public `AudioModule.AudioRecorder` constructor is
 * declared as taking `Partial<RecordingOptions>` — the NESTED
 * `{ android: {...}, ios: {...}, web: {...} }` shape — but the
 * package's own `useAudioRecorder()` hook actually calls it with the
 * FLATTENED, already-platform-merged object `ANDROID_RECORDING_OPTIONS`
 * above matches (see that constant's own comment). The declared type is
 * therefore too narrow for what the library's own code passes; this
 * cast documents that gap rather than hiding it inside a broader
 * `any`.
 */
type AudioRecorderConstructorArg = ConstructorParameters<typeof AudioModule.AudioRecorder>[0];

/**
 * Reads a local file `uri` (as `expo-audio`'s `AudioRecorder.uri`
 * produces — a `file://` URI) and returns its bytes as base64, using
 * only globals React Native itself ships (`fetch`/`Blob`/`FileReader`)
 * — no `expo-file-system` dependency; see this module's header for
 * exactly why that package is not used here.
 */
export async function readClipAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error("Could not read the recorded clip"));
    };
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader result reading the recorded clip"));
        return;
      }
      // `readAsDataURL` produces "data:<mime>;base64,<payload>" — only
      // the payload after the first comma is the base64 this port's
      // contract promises.
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(blob);
  });
}

const DEFAULT_BINDINGS: VoiceCaptureBindings = {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  createRecorder() {
    return new AudioModule.AudioRecorder(
      ANDROID_RECORDING_OPTIONS as unknown as AudioRecorderConstructorArg,
    );
  },
  readClipAsBase64,
};

/** Maps `expo-audio`'s `PermissionResponse` onto this app's own five-state `PermissionState` — same shape `qr-scanner-port.ts`'s header describes for a future real camera port. */
function mapExpoPermission(response: ExpoPermissionResponse): PermissionState {
  if (response.granted) {
    return "granted";
  }
  if (response.status === "denied") {
    return response.canAskAgain === false ? "denied-permanently" : "denied";
  }
  return "undetermined";
}

/**
 * This build's real `VoiceCapturePort` (T276) — `Composer.tsx`'s own
 * default as of this task. See this module's header for the dependency
 * decision, the format disclosure, the preserved one-resolution
 * invariant, and the one disclosed gap (a cancelled clip's file is not
 * deleted).
 */
export function createExpoAudioVoiceCapturePort(
  bindings: VoiceCaptureBindings = DEFAULT_BINDINGS,
): VoiceCapturePort {
  let activeRecorder: RecorderHandle | null = null;

  return {
    async getPermissionStatus() {
      return mapExpoPermission(await bindings.getRecordingPermissionsAsync());
    },
    async requestPermission() {
      return mapExpoPermission(await bindings.requestRecordingPermissionsAsync());
    },
    async start() {
      // Deliberately NO permission read/request here — see this
      // module's header. `voice-model.ts`'s `requestStart()` has
      // already resolved permission (T83's exactly-once invariant)
      // before this is ever called; a check here would reintroduce the
      // double-prompt bug T83 closed.
      const recorder = bindings.createRecorder();
      await recorder.prepareToRecordAsync();
      recorder.record();
      activeRecorder = recorder;
    },
    async stop() {
      const recorder = activeRecorder;
      activeRecorder = null;
      if (recorder === null) {
        // `voice-model.ts`'s own contract already guarantees `stop()`
        // is never called except after a matching `start()` — see
        // `VoiceCapturePort.stop()`'s doc comment — so this is a
        // defensive fallback, never a real production path.
        return { kind: "transcript", text: "" };
      }
      await recorder.stop();
      const uri = recorder.uri;
      recorder.release();
      if (uri === null) {
        return { kind: "transcript", text: "" };
      }
      const audioBase64 = await bindings.readClipAsBase64(uri);
      const outcome: VoiceCaptureOutcome = {
        kind: "audio",
        audioBase64,
        format: RECORDING_FORMAT,
      };
      return outcome;
    },
    async cancel() {
      const recorder = activeRecorder;
      activeRecorder = null;
      if (recorder === null) {
        return;
      }
      // Release the microphone immediately; never read the cancelled
      // clip's bytes (see this module's header for the one gap this
      // still leaves: the file itself is not deleted).
      await recorder.stop().catch(() => undefined);
      recorder.release();
    },
  };
}
