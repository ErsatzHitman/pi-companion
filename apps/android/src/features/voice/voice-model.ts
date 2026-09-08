/**
 * Voice-entry model (T36D, plan.md §9.2 "prominent microphone action",
 * §7.1/§12.5 "flows through the core outbox").
 *
 * RN-free, like every other `-model.ts`/`-port.ts` in this workspace
 * (`../composer/composer-model.ts`, `../notifications/push-registration-
 * model.ts`), so the recording lifecycle is unit-testable without a
 * device/emulator or a socket.
 *
 * ## Transcription: daemon-side, not on-device — and why that is a
 * decision this task can state but not finish
 *
 * `packages/protocol/src/messages.ts` already defines a full
 * client-drives-the-daemon voice pipeline: `VoiceAudioChunkMessageSchema`
 * (`type: "voice_audio_chunk"`, base64 `audio` + `format`, an `isLast`
 * flag) is a session-inbound message, and the daemon answers with
 * `TranscriptionResultMessageSchema` (`type: "transcription_result"`,
 * `payload.text`). `packages/client/src/daemon-client.ts` already wraps
 * both directions (`sendVoiceAudioChunk`, `setVoiceMode`). Nothing in
 * this task invents that shape — it already exists, ported with the
 * rest of `packages/client`/`packages/protocol`. So the intended
 * architecture is: capture raw audio on-device, stream it to the
 * daemon, receive text back.
 *
 * This task could not finish that path, for one blocker named in this
 * task's own brief: Android has no live `DaemonClient` wired in
 * anywhere yet (`Composer.tsx`'s own "no client yet" seam, already true
 * for `turnService`), so `sendVoiceAudioChunk` cannot be called from
 * here even as a manual wiring exercise. **T276 (plan.md §9.2) closed
 * the OTHER blocker this paragraph used to name**: a real, on-device
 * audio-capture module now exists
 * (`./expo-audio-voice-capture-port.ts`'s `createExpoAudioVoiceCapturePort`,
 * `Composer.tsx`'s own default `voiceCapture` as of that task), so
 * `port.stop()` really can resolve `{ kind: "audio", audioBase64,
 * format }` today, not merely in shape.
 *
 * So this module is built to the *shape* the daemon-transcription path
 * implies (`VoiceCapturePort.stop()` may resolve `{ kind: "audio", ... }`
 * for a future caller that owns a live `DaemonClient` to stream it
 * through), but the only outcome this module actually *acts on* is
 * `{ kind: "transcript", text }` — see `requestStop` below for what
 * happens to a `"audio"` outcome instead: it is discarded, not
 * persisted, because "never write raw audio to plain storage" (this
 * task's own rule) rules out putting it in the outbox's
 * `StructuredStorage`-backed payload, and there is no live socket to
 * hand it to instead. T276's brief is explicit that closing this dead
 * end (transcribing the real audio T276 now captures) is the NEXT
 * task's job, not this module's — `requestStop`'s `"raw-audio-
 * unsupported"` outcome is deliberately left exactly as it was;
 * `voice-model.test.ts` proves the *pipeline* (permission gate ->
 * capture -> outbox -> submit, and every cancel/background/race rule
 * below) against a scripted fake, not against a real microphone —
 * unchanged by T276, which proves the real port separately, in
 * `expo-audio-voice-capture-port.test.ts`.
 *
 * ## The core-outbox criterion
 *
 * `requestStop` enqueues through `frontend-core`'s
 * `composer/outbox.ts` `OutboxController` — the *same* controller
 * `Composer.tsx`'s `sendWithOutbox` already constructs (`kind:
 * "prompt"`), not a second queue. This module takes an already-built
 * outbox (typed via `Pick<InstanceType<typeof coreComposer.
 * OutboxController>, ...>`, exactly `../share/share-draft-
 * controller.ts`'s pattern) rather than constructing its own, so a
 * caller that mounts both `Composer` and this feature can share one
 * outbox instance and one `StructuredStorage` — **T70 (P5-W21) is that
 * caller**: `Composer.tsx` now builds its `voiceController` with the
 * exact same `outbox`/`resolvedSessionId` its own `sendWithOutbox`
 * uses, so a voice-produced entry and a typed one share one queue.
 *
 * The enqueue always happens *before* any send attempt (mirroring
 * `Composer.tsx`'s `sendWithOutbox` exactly), so a transcript is
 * durably recorded the moment capture finishes — "a captured transcript
 * must never be silently discarded" holds structurally: even if
 * `submitPrompt` throws, the entry is not deleted, only moved to
 * `"awaiting-confirmation"` via `outbox.markFailed` (see
 * `OutboxStopOutcome`'s `"send-failed"` case) — recoverable, not lost.
 *
 * ## Permission recovery
 *
 * `requestStart` calls `resolvePermission` from
 * `../composer/permission-recovery.js` unchanged — the same function,
 * over the same `PermissionState`/`PermissionKind` vocabulary T33B7
 * built (that module's `KIND_LABEL`/`KIND_PURPOSE` already include
 * `"microphone"`: "Microphone access needed... to record a voice
 * message"). This module declares no second copy of that copy/logic;
 * `VoiceStartOutcome`'s `"permission-denied"` case carries the
 * `PermissionState` straight through so a caller renders it via
 * `describePermissionRecovery("microphone", state)` — the exact
 * affordance T33B7 built, reused, not a divergent one.
 *
 * **T60D is unifying `../composer/permission-recovery.ts` with
 * `../connect/qr-scanner-port.ts`'s narrower vocabulary this same
 * wave and may move that module — this import breaks if so; see this
 * task's report.**
 *
 * ## The four "recording in progress" scenarios this proves
 * (`voice-model.test.ts`)
 *
 *  - **A second `requestStart` while one is already running**: returns
 *    `{ outcome: "already-recording" }` and does not touch the running
 *    capture (no second `port.start()` call).
 *  - **The user cancels** (`requestCancel()`, default reason
 *    `"user"`): calls `port.cancel()` (whatever was captured must be
 *    discarded — `VoiceCapturePort.cancel()`'s own contract), returns
 *    to `idle`, and — the thing under test — never calls
 *    `outbox.enqueue`.
 *  - **The app backgrounds mid-recording** (`handleAppBackgrounded()`):
 *    treated as a cancel (`reason: "backgrounded"`), for the same
 *    reason a background app should not go on holding an open
 *    microphone unattended. A no-op (`{ outcome: "not-recording" }`)
 *    when nothing is recording.
 *  - **The connection drops mid-recording** (`handleConnectionLost()`):
 *    a deliberate no-op that leaves `recording` untouched and returns
 *    the unchanged state — recording is local audio capture with no
 *    socket of its own this wave (see above), so a connection event
 *    has nothing to interrupt. The connection only matters once
 *    `requestStop` tries to actually send the transcript, and that is
 *    already covered by the outbox's existing failed/
 *    awaiting-confirmation path (`"send-failed"`), not by this
 *    function.
 */
import type { composer as coreComposer } from "@picompanion/frontend-core";
import { security } from "@picompanion/frontend-core";

import { resolvePermission, type PermissionState } from "../composer/permission-recovery.js";
import type { VoiceCapturePort } from "./voice-capture-port.js";

/** The narrow outbox surface this module needs — same pattern as `../share/share-draft-controller.ts`'s `OutboxLike`. */
export type VoiceOutboxLike = Pick<
  InstanceType<typeof coreComposer.OutboxController>,
  "enqueue" | "markSending" | "markSent" | "markFailed"
>;

/** One outbox entry's payload shape for a voice-produced prompt — round-trips through `OutboxEntry<VoicePromptPayload>.payload`. */
export interface VoicePromptPayload {
  source: "voice";
  text: string;
}

export type VoiceRecordingStatus = "idle" | "recording" | "processing";

export interface VoiceState {
  status: VoiceRecordingStatus;
  /** Epoch milliseconds `requestStart` succeeded, or `null` while idle. */
  startedAt: number | null;
}

export const IDLE_VOICE_STATE: VoiceState = { status: "idle", startedAt: null };

export type VoiceStartOutcome =
  | { outcome: "started" }
  | { outcome: "already-recording" }
  | { outcome: "permission-denied"; state: PermissionState };

export type VoiceStopOutcome =
  | {
      outcome: "queued";
      outboxEntryId: string;
      text: string;
      /** `security.isSecretShaped(text)` — annotated, never blocked; see this module's header and `../share/share-intent-model.ts`'s identical `looksSecretShaped` field for the precedent this follows. */
      looksSecretShaped: boolean;
    }
  | {
      outcome: "send-failed";
      outboxEntryId: string;
      text: string;
      message: string;
    }
  | { outcome: "empty-transcript" }
  | { outcome: "raw-audio-unsupported" }
  | { outcome: "not-recording" };

export type VoiceCancelReason = "user" | "backgrounded";

export type VoiceCancelOutcome =
  | { outcome: "cancelled"; reason: VoiceCancelReason }
  | { outcome: "not-recording" };

export interface VoiceCaptureControllerDeps {
  port: VoiceCapturePort;
  outbox: VoiceOutboxLike;
  /** Session/agent id voice-produced outbox entries are scoped to — same role as `ComposerProps.sessionId`. */
  sessionId: string;
  /**
   * Hands the transcribed text to the host, exactly
   * `ComposerProps.onSubmit`'s contract: resolving marks the entry
   * sent; throwing/rejecting marks it failed (`"send-failed"`) without
   * losing the text.
   */
  submitPrompt: (text: string) => void | Promise<void>;
  now?: () => number;
}

export interface VoiceCaptureController {
  getState(): VoiceState;
  /** Begins recording, gated on the microphone permission (see this module's header). */
  requestStart(): Promise<VoiceStartOutcome>;
  /** Stops recording and, for a non-empty transcript, enqueues + submits it. */
  requestStop(): Promise<VoiceStopOutcome>;
  /** Cancels a running recording, discarding it. `reason` defaults to `"user"`. */
  requestCancel(reason?: VoiceCancelReason): Promise<VoiceCancelOutcome>;
  /** Cancels a running recording with `reason: "backgrounded"`; a no-op when idle. */
  handleAppBackgrounded(): Promise<VoiceCancelOutcome>;
  /** Deliberate no-op — see this module's header. Returns the unchanged state for the caller to assert against. */
  handleConnectionLost(): VoiceState;
}

/**
 * Builds a `VoiceCaptureController`. One instance per composer/session
 * surface — mirrors `createPushRegistrationController`'s shape
 * (`../notifications/push-registration-model.ts`): a plain closure over
 * mutable state, no React, driven entirely by its returned methods.
 */
export function createVoiceCaptureController(
  deps: VoiceCaptureControllerDeps,
): VoiceCaptureController {
  const { port, outbox, sessionId, submitPrompt } = deps;
  const now = deps.now ?? (() => Date.now());

  let state: VoiceState = IDLE_VOICE_STATE;

  async function requestStart(): Promise<VoiceStartOutcome> {
    if (state.status !== "idle") {
      // A second start while one is already running: no-op, the
      // running capture is left completely untouched (no second
      // `port.start()`).
      return { outcome: "already-recording" };
    }
    const permissionState = await resolvePermission(port);
    if (permissionState !== "granted") {
      return { outcome: "permission-denied", state: permissionState };
    }
    await port.start();
    state = { status: "recording", startedAt: now() };
    return { outcome: "started" };
  }

  async function requestStop(): Promise<VoiceStopOutcome> {
    if (state.status !== "recording") {
      return { outcome: "not-recording" };
    }
    state = { status: "processing", startedAt: state.startedAt };
    const result = await port.stop();
    state = IDLE_VOICE_STATE;

    if (result.kind === "audio") {
      // See this module's header: no live DaemonClient to stream this
      // to, and raw audio must never be written to plain storage — so
      // it is discarded here, not silently persisted anywhere, and
      // this outcome says so explicitly rather than pretending success.
      return { outcome: "raw-audio-unsupported" };
    }

    const text = result.text.trim();
    if (text.length === 0) {
      return { outcome: "empty-transcript" };
    }

    const looksSecretShaped = security.isSecretShaped(text);
    const payload: VoicePromptPayload = { source: "voice", text };
    const entry = await outbox.enqueue<VoicePromptPayload>({
      sessionId,
      kind: "prompt",
      payload,
    });

    try {
      await outbox.markSending(entry.id);
      await submitPrompt(text);
      await outbox.markSent(entry.id);
      return { outcome: "queued", outboxEntryId: entry.id, text, looksSecretShaped };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await outbox.markFailed(entry.id, message).catch(() => undefined);
      return { outcome: "send-failed", outboxEntryId: entry.id, text, message };
    }
  }

  async function requestCancel(reason: VoiceCancelReason = "user"): Promise<VoiceCancelOutcome> {
    if (state.status === "idle") {
      return { outcome: "not-recording" };
    }
    await port.cancel();
    state = IDLE_VOICE_STATE;
    return { outcome: "cancelled", reason };
  }

  async function handleAppBackgrounded(): Promise<VoiceCancelOutcome> {
    return requestCancel("backgrounded");
  }

  function handleConnectionLost(): VoiceState {
    // Deliberate no-op — see this module's header's "connection drops
    // mid-recording" section.
    return state;
  }

  return {
    getState: () => state,
    requestStart,
    requestStop,
    requestCancel,
    handleAppBackgrounded,
    handleConnectionLost,
  };
}
