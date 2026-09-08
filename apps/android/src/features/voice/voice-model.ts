/**
 * Voice-entry model (T36D, plan.md §9.2 "prominent microphone action" and
 * §9.4 "Groq transcription and draft insertion"; §7.1/§12.5 "flows through the core outbox" —
 * SUPERSEDED for this module by the decision below).
 *
 * RN-free, like every other `-model.ts`/`-port.ts` in this workspace
 * (`../composer/composer-model.ts`, `../notifications/push-registration-
 * model.ts`), so the recording lifecycle is unit-testable without a
 * device/emulator or a socket.
 *
 * ## T277: a finished transcript is now a DRAFT, not a send (behaviour
 * change to a shipped decision — recorded in `plan.md` §9.4)
 *
 * Before this task, `requestStop` enqueued the transcript into
 * `frontend-core`'s outbox and called `submitPrompt` on it immediately —
 * the same durable-send pipeline a typed message uses. That was a
 * deliberate design at the time (see this module's git history), but it is
 * the opposite of what was asked for: a voice entry should land in the
 * composer as editable text the user reviews and can correct BEFORE
 * deciding to send, the same way speech-to-text works in every dictation
 * keyboard. This module no longer touches an outbox at all — `VoiceOutboxLike`
 * and `VoicePromptPayload` are gone, and `requestStop` now resolves an
 * outcome that hands the caller plain text to insert into the draft
 * (`"drafted"`), never a queued/sent/failed send state. `Composer.tsx`
 * applies that text to `state.draft` via `applyTranscriptToDraft` below —
 * see that function's doc comment for the append rule, and this module's
 * own header for why an empty result must never overwrite what the user
 * already typed.
 *
 * ## T277: closing the `"audio"` dead end
 *
 * `packages/protocol/src/messages.ts` now also defines a one-shot
 * `transcribe_voice_clip.request`/`.response` pair (T277) alongside the
 * PCM-streaming voice pipeline this header used to describe as the only
 * option: `VoiceAudioChunkMessageSchema`/`TranscriptionResultMessageSchema`
 * (still real, still ported, still PCM-only two layers down) and
 * `DictationStreamManager`'s own `dictation_stream_*` messages (also
 * PCM-only). Neither of those can carry the AAC/m4a clip
 * `expo-audio-voice-capture-port.ts` actually produces without a resample
 * step this task does not own. The one-shot pair exists specifically
 * because it needs none of that: `packages/client/src/daemon-client.ts`'s
 * new `transcribeVoiceClip` sends the complete clip's bytes once and gets
 * `{ text, error }` back once, and the daemon side
 * (`VoiceSession.handleTranscribeClip`) resolves the SAME dictation STT
 * provider slot as the existing dictation feature, calling its (also new)
 * one-shot `SpeechToTextProvider.transcribeClip`.
 *
 * This module reaches that capability through `VoiceCaptureControllerDeps.
 * transcribe` — an OPTIONAL, narrow, structurally-typed dependency
 * (`VoiceTranscriptionClient`, matching `AttachmentUploadClient`'s own
 * "duck-typed, never imports `@picompanion/client` directly" shape in
 * `../composer/attachment-model.ts`), exactly the same optionality pattern
 * `Composer.tsx`'s `uploadClient` already uses.
 *
 * **T282 (wave P9-W61) wires this at the only production mount.** The
 * session route (`app/h/[serverId]/session/[agentId]/index.tsx`) now
 * resolves the live `DaemonClient` and narrows it to this interface —
 * CORRECTED at the P9-P merge gate, which said it "resolves
 * `client.transcribeVoiceClip.bind(client)`"; no call site binds
 * anything, and the same sentence already described the real mechanism
 * as "the identical fresh-read-and-cast pattern", which a bind is not —
 * off the same `AppCore.connection`-derived `DaemonClient` it already
 * threads through
 * for `queueModeClient`/`turnStatusClient` — see `app-shell/
 * session-route-daemon-clients.ts`'s `resolveTranscribeClient`, the
 * identical fresh-read-and-cast pattern those two functions use — and
 * passes the result as `Composer.tsx`'s `transcribeClient` prop. A real
 * recording made on a real device with a real daemon connection now
 * reaches Groq and comes back as draft text, end to end. CORRECTED at
 * T282: this paragraph used to say **"This task does not wire a live
 * `DaemonClient` into `Composer.tsx`'s new `transcribeClient` prop — that
 * prop's default is `undefined`, same as `uploadClient`'s today"** and
 * **"Left undone deliberately: doing that wiring blind, with no device or
 * live daemon connection available to prove it end to end in this
 * environment, is a worse outcome than a disclosed, honestly un-wired
 * optional prop."** Both were true of T277 and are no longer true. What
 * has NOT changed: when there is no active daemon connection (unpaired,
 * or paired but disconnected), `resolveTranscribeClient` returns
 * `undefined`, `transcribe` is absent here exactly as before, and a
 * `"audio"` port outcome still resolves `{ outcome:
 * "transcription-unavailable" }` — a truthful "this screen has no
 * transcription client connected" state, not the old
 * `"raw-audio-unsupported"` (which read as "audio can never be
 * transcribed", never true once a caller wires the prop) and never a
 * silent no-op.
 *
 * ## Cleanup: deterministic before clever (T277)
 *
 * `cleanTranscript` below does exactly three things, all decided and
 * argued in this task, none of them a rewrite: collapse the doubled/
 * irregular whitespace Whisper-family models emit, trim the ends, and drop
 * ONE leading filler token ("um", "uh", etc.) if the transcript starts with
 * one — together with any run of trailing punctuation/dash/ellipsis
 * characters immediately after that token (T286: widened from "exactly one
 * trailing punctuation character" after the P9-O gate measured that
 * Whisper-family models routinely emit an ellipsis or a dash after a
 * filler — "Um... hello there", "Um—hello" — and the narrower rule left
 * both unchanged; see `cleanTranscript`'s own comment for the exact
 * character set). It does NOT do `D:\Handy`'s `audio_toolkit/text.rs` custom-word
 * repair (Levenshtein distance + Soundex phonetics): that repair needs a
 * user-maintained vocabulary list this product has no UI for yet, and
 * applying fuzzy phonetic matching with nothing to match against would
 * only introduce new errors. It does NOT route text through an LLM: the
 * latency cost (a second network round trip after the transcription round
 * trip already paid) is not worth it for the fixes actually being made
 * here, which are all pure string operations with no ambiguity to
 * resolve. The hallucination guard for a silent/non-speech clip (a known
 * Whisper failure mode) is NOT done here — it is done server-side, in
 * `packages/server/src/server/speech/providers/openai/stt.ts`'s
 * `transcribeClip`, using Groq/OpenAI's `verbose_json` `no_speech_prob`,
 * because that signal only exists on the transcription response, not on
 * the plain string this module receives afterward; a hallucinated clip
 * arrives here as an already-emptied `text: ""`, which flows through the
 * SAME `"empty-transcript"` path as a genuinely silent clip.
 *
 * ## The core-outbox criterion this module NO LONGER satisfies, on purpose
 *
 * Every other paragraph in this section up to T277 described
 * `requestStop` enqueuing through `frontend-core`'s `composer/outbox.ts`
 * `OutboxController`. That is gone. A voice-produced draft is not
 * durable the way a submitted prompt is — if the app is killed before the
 * user presses send, the draft is lost, exactly like it would be if the
 * user had typed the same text by hand and closed the app. That is a
 * deliberate, disclosed trade against durability, not an oversight: this
 * task's brief is explicit that a transcript "lands in the prompt bar as
 * an editable draft, and the user decides whether to send" — a value the
 * user has not yet decided to send is not a value this module's job to
 * make durable.
 *
 * ## Permission recovery (unchanged by T277)
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
 * ## The four "recording in progress" scenarios this proves
 * (`voice-model.test.ts`)
 *
 *  - **A second `requestStart` while one is already running**: returns
 *    `{ outcome: "already-recording" }` and does not touch the running
 *    capture (no second `port.start()` call).
 *  - **The user cancels** (`requestCancel()`, default reason
 *    `"user"`): calls `port.cancel()` (whatever was captured must be
 *    discarded — `VoiceCapturePort.cancel()`'s own contract), returns
 *    to `idle`, and never produces a draft.
 *  - **The app backgrounds mid-recording** (`handleAppBackgrounded()`):
 *    treated as a cancel (`reason: "backgrounded"`), for the same
 *    reason a background app should not go on holding an open
 *    microphone unattended. A no-op (`{ outcome: "not-recording" }`)
 *    when nothing is recording.
 *  - **The connection drops mid-recording** (`handleConnectionLost()`):
 *    a deliberate no-op that leaves `recording` untouched and returns
 *    the unchanged state — recording is local audio capture with no
 *    socket of its own this wave (see above), so a connection event
 *    has nothing to interrupt.
 */
import { security } from "@picompanion/frontend-core";

import { resolvePermission, type PermissionState } from "../composer/permission-recovery.js";
import type { VoiceCapturePort } from "./voice-capture-port.js";

/**
 * The narrow speech-transcription surface a voice draft needs — same
 * "duck-typed, never import `@picompanion/client` directly" pattern
 * `../composer/attachment-model.ts`'s `AttachmentUploadClient` uses for
 * `DaemonClient.uploadFile`. Optional method, same reason: a client that
 * omits it (or the whole dependency being `undefined`) leaves a captured
 * `{ kind: "audio" }` clip in an explained `"transcription-unavailable"`
 * state rather than throwing.
 */
export interface VoiceTranscriptionClient {
  transcribeVoiceClip?(input: {
    audioBase64: string;
    format: string;
    language?: string;
  }): Promise<{ text: string | null; error: string | null }>;
}

const LEADING_FILLER_WORDS = new Set(["um", "umm", "ummm", "uh", "uhh", "erm", "hmm", "mm"]);

/**
 * Deterministic transcript cleanup — see this module's header for the
 * scope argument (no phonetic repair, no LLM pass). Three steps, in
 * order: collapse any run of whitespace (Whisper-family models sometimes
 * emit doubled spaces or a stray newline) to a single space; trim the
 * ends; then, if the FIRST word is a bare filler token, drop that one
 * word — only the leading one, never a filler appearing mid-sentence,
 * since removing those would change the speaker's actual words rather
 * than clean up capture noise — together with any RUN of trailing
 * punctuation/dash/ellipsis characters immediately after it (comma,
 * period, colon, semicolon, `!`, `?`, the unicode ellipsis `…`, a
 * repeated run of periods such as `...`, a hyphen, an en dash `–`, or an
 * em dash `—`, in any combination). T286 widened this from "exactly one
 * trailing punctuation character" — that narrower rule left "Um... hello
 * there" and "Um—hello" unchanged, which is the two forms Whisper-family
 * models emit after a filler most often; see `voice-model.test.ts`'s
 * "T286" cases for both, pinned individually alongside the two forms
 * that already worked (a single comma, and no punctuation at all).
 */
export function cleanTranscript(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return collapsed;
  }

  const match = /^([A-Za-z]+)[,.:;!?…\-–—]*(?:\s*(.*))?$/s.exec(collapsed);
  if (!match) {
    return collapsed;
  }
  const [, firstWord, rest] = match;
  if (!LEADING_FILLER_WORDS.has(firstWord.toLowerCase())) {
    return collapsed;
  }
  return (rest ?? "").trim();
}

/**
 * How a voice-produced transcript joins whatever the user already typed —
 * the decision this task's own brief calls "the decision most likely to
 * be made by accident". Chosen: APPEND, never replace or insert at a
 * cursor position — this model layer has no cursor/selection state to
 * insert at (that lives in the native `TextInput`, not here), and append
 * is the one option that can never silently discard text the user already
 * wrote. An empty `transcript` returns `currentDraft` completely
 * unchanged — belt-and-braces alongside `requestStop` below already never
 * calling this for an empty result at all, so a caller that reuses this
 * function directly gets the same guarantee.
 */
export function applyTranscriptToDraft(currentDraft: string, transcript: string): string {
  if (transcript.length === 0) {
    return currentDraft;
  }
  if (currentDraft.length === 0) {
    return transcript;
  }
  if (/\s$/.test(currentDraft)) {
    return currentDraft + transcript;
  }
  return `${currentDraft} ${transcript}`;
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
      outcome: "drafted";
      text: string;
      /** `security.isSecretShaped(text)` — annotated, never blocked; see `../share/share-intent-model.ts`'s identical `looksSecretShaped` field for the precedent this follows. */
      looksSecretShaped: boolean;
    }
  | { outcome: "empty-transcript" }
  | { outcome: "transcription-unavailable" }
  | { outcome: "transcription-failed"; message: string }
  | { outcome: "not-recording" };

export type VoiceCancelReason = "user" | "backgrounded";

export type VoiceCancelOutcome =
  | { outcome: "cancelled"; reason: VoiceCancelReason }
  | { outcome: "not-recording" };

export interface VoiceCaptureControllerDeps {
  port: VoiceCapturePort;
  /**
   * Optional — see this module's header. Absent (the default, today, in
   * every real mount) means a `{ kind: "audio" }` port outcome resolves
   * `"transcription-unavailable"` rather than throwing or silently
   * dropping the recording.
   */
  transcribe?: VoiceTranscriptionClient;
  /** BCP-47-ish language hint passed to `transcribe.transcribeVoiceClip`, e.g. `"en"`. Omitted entirely when unset — the daemon falls back to its own configured dictation language. */
  language?: string;
  now?: () => number;
}

export interface VoiceCaptureController {
  getState(): VoiceState;
  /** Begins recording, gated on the microphone permission (see this module's header). */
  requestStart(): Promise<VoiceStartOutcome>;
  /** Stops recording and resolves the transcript as a draft — see this module's header for why this no longer sends anything. */
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
  const { port, transcribe, language } = deps;
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

    let rawText: string;
    if (result.kind === "audio") {
      if (!transcribe?.transcribeVoiceClip) {
        return { outcome: "transcription-unavailable" };
      }
      let response: { text: string | null; error: string | null };
      try {
        response = await transcribe.transcribeVoiceClip({
          audioBase64: result.audioBase64,
          format: result.format,
          ...(language ? { language } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { outcome: "transcription-failed", message };
      }
      if (response.error !== null || response.text === null) {
        return {
          outcome: "transcription-failed",
          message: response.error ?? "Transcription failed.",
        };
      }
      rawText = response.text;
    } else {
      rawText = result.text;
    }

    const cleaned = cleanTranscript(rawText);
    if (cleaned.length === 0) {
      return { outcome: "empty-transcript" };
    }

    return {
      outcome: "drafted",
      text: cleaned,
      looksSecretShaped: security.isSecretShaped(cleaned),
    };
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
