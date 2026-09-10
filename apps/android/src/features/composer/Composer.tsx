import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import type { Clock, StructuredStorage } from "@picompanion/frontend-core";
import { composer as coreComposer } from "@picompanion/frontend-core";

import {
  Button,
  Chip,
  Section,
  Select,
  StatusIndicator,
  type ChipTone,
  type StatusTone,
} from "../../ui/primitives";
import { PromptBar } from "../../ui/recipes";
import { useTheme } from "../../ui/theme/theme-context";
import {
  DEFAULT_ATTACHMENT_LIMITS,
  EMPTY_ATTACHMENTS_STATE,
  attachmentStatusLabel,
  clearAttachments,
  describeAttachmentLimits,
  evaluateAttachmentCandidate,
  formatAttachmentBytes,
  hasPendingUploads as attachmentsHavePendingUploads,
  markAttachmentError,
  markAttachmentUploaded,
  removeAttachment,
  stageAttachment,
  uploadedAttachmentRefs,
  type AttachmentLimits,
  type AttachmentUploadClient,
  type AttachmentsState,
  type ComposerUploadedAttachment,
  type StagedAttachment,
} from "./attachment-model";
import {
  createUnavailableAttachmentSourcePort,
  createUnavailableCameraCapturePort,
  type AttachmentSourcePort,
  type CameraCapturePort,
  type PickedAttachmentFile,
} from "./attachment-source-port";
import { runCapturePress } from "./attachment-capture-model";
import { resolveComposerMinHeight } from "./composer-min-height-model";
import { ComposerIconAction } from "./composer-icon-action";
import { type DaemonEditorTextSource, wireEditorTextResponder } from "./editor-text-model";
import { createInMemoryStructuredStorage, createSystemClock } from "./in-memory-outbox-runtime";
import { runMicPress } from "./mic-press-model";
import {
  INITIAL_MODEL_THINKING_STATE,
  createModelThinkingController,
  type DaemonModelThinkingSource,
} from "./model-thinking-model";
import { ModelThinkingPicker } from "./ModelThinkingPicker";
import { PermissionRecoveryNotice } from "./PermissionRecoveryNotice";
import { resolvePermission, type PermissionState } from "./permission-recovery";
import {
  INITIAL_QUEUE_MODES_STATE,
  createQueueModesController,
  type DaemonQueueModeSource,
  type QueueMode,
} from "./queue-mode-model";
import { QueueModePicker } from "./QueueModePicker";
import {
  INITIAL_SLASH_COMMANDS_STATE,
  createSlashCommandsController,
  slashCommandDraftText,
  type DaemonSlashCommandSource,
  type SlashCommand,
} from "./slash-command-model";
import { SlashCommandPicker } from "./SlashCommandPicker";
import {
  INITIAL_TURN_STATUS_STATE,
  createTurnStatusController,
  type DaemonTurnStatusSource,
} from "./turn-status-model";
import { TurnStatusBanner } from "./TurnStatusBanner";
import {
  applyTranscriptToDraft,
  createExpoAudioVoiceCapturePort,
  createVoiceCaptureController,
  IDLE_VOICE_STATE,
  VoiceCaptureIndicator,
  type VoiceCaptureController,
  type VoiceCancelOutcome,
  type VoiceCapturePort,
  type VoiceState,
  type VoiceStopOutcome,
  type VoiceTranscriptionClient,
} from "../voice";
import {
  ABORT_ACTION_LABEL,
  ATTACH_ACTION_LABEL,
  CAPTURE_ACTION_LABEL,
  COMPOSER_ACCESSIBILITY_LABEL,
  COMPOSER_INPUT_LABEL,
  EMPTY_COMPOSER_STATE,
  FOLLOW_UP_ACTION_LABEL,
  MIC_ACTION_LABEL,
  QUEUE_MODE_LABEL,
  SLASH_COMMANDS_ACTION_LABEL,
  STEER_ACTION_LABEL,
  abortTurn,
  canAbort,
  canFollowUpDraft,
  canSteerDraft,
  canSubmitDraft,
  describeQueueStatus,
  dispatchModeLabel,
  entryStatusLabel,
  finishTurn,
  markEntryFailed,
  markEntrySent,
  markFollowUpFailed,
  markFollowUpSent,
  markSteerFailed,
  markSteerSent,
  pendingCount,
  queueDepth,
  queueDepthLabel,
  recoverFailedDraft,
  revertDispatchMode,
  setDispatchMode,
  startTurn,
  submitDraft,
  submitFollowUp,
  submitSteer,
  type ComposerEntry,
  type ComposerEntryStatus,
  type ComposerState,
  type QueueDispatchMode,
  type TurnService,
} from "./composer-model";

const DISPATCH_MODE_OPTIONS: ReadonlyArray<{ value: QueueDispatchMode; label: string }> = [
  { value: "steer", label: dispatchModeLabel("steer") },
  { value: "follow-up", label: dispatchModeLabel("follow-up") },
];

export interface ComposerProps {
  /**
   * Hands the trimmed text of a submitted prompt to the host. Always an
   * injected callback, so this component never decides how a prompt is
   * delivered: resolving it (or returning normally) marks the optimistic
   * entry `sent`; throwing/rejecting marks it `failed` and leaves its
   * text recoverable via the entry's Retry action.
   *
   * Live since T32S13 (P5-W19): the session route
   * (`app/h/[serverId]/session/[agentId]/index.tsx`) passes a
   * `handleSubmit` that calls `AppCore.startTurn` → T63's
   * `startDaemonTurn` over the live `DaemonClient`, and re-throws a
   * `{ status: "failed" }` result so the `markEntryFailed` path above
   * is what surfaces it. With no daemon connected, that failure is
   * "Not connected to a daemon" — a sent prompt is marked `failed`,
   * not `sent`.
   */
  onSubmit: (text: string) => void | Promise<void>;
  /**
   * Fires immediately whenever the microphone icon is pressed — kept
   * exactly as before (T33B1) so an existing caller's contract is
   * unchanged. The permission gate, recovery affordance, and actual
   * recording toggle that run alongside this call live behind
   * `voiceCapture` below (T33B7's original precheck and T70's recorder
   * were unified onto that one port by T83 — see `mic-press-model.ts`).
   */
  onMicPress: () => void;
  /**
   * Fires immediately whenever the attachment icon is pressed — kept
   * exactly as before (T33B1) so an existing caller's contract is
   * unchanged. The actual pick/upload flow (T33B7) runs alongside this
   * call — see `attachmentSource`/`uploadClient` below.
   */
  onAttachPress: () => void;
  /**
   * Whether a Pi turn is currently running. Host-controlled — `Composer`
   * does not decide this for itself. Drives which controls are shown
   * (plain Send is disabled while running; Steer/Follow up/Abort appear)
   * — see `composer-model.ts`'s doc comment for what each one means.
   *
   * Live since T32S13 (P5-W19): the session route passes
   * `submitting || signalRunning`, where `submitting` covers the window
   * between a Send tap and the daemon's first push, and `signalRunning`
   * is T64's real `createTurnRunningSignal` over `agent_stream`
   * (`features/sessions/turn-running-signal.ts`).
   */
  turnRunning: boolean;
  /**
   * Steer / follow-up / abort transport for the running turn, injected
   * for the same "no live client yet" reason as `onSubmit`. T32A1B
   * (P5-W6) provides a real implementation.
   */
  turnService: TurnService;
  /**
   * T33B7: picker + OS-permission port for attachments. Optional and
   * defaults to `createUnavailableAttachmentSourcePort()` — the
   * injection fallback for a caller that wants attachment picking
   * explicitly disabled. **T290**: the session mount's own default is
   * now `createExpoAttachmentSourcePort()` (`./expo-attachment-source-
   * port.ts`), a real `expo-document-picker`-backed picker — see that
   * module's header for why it always resolves `"granted"` (the
   * document picker needs no Android permission). Passing a real
   * implementation is what turns the attach action from an honest
   * "unavailable" notice into a real pick/upload flow; nothing else
   * about this component changes.
   */
  attachmentSource?: AttachmentSourcePort;
  /**
   * T33B7: transport for uploading a picked file (mirrors
   * `packages/client/src/daemon-client.ts`'s `uploadFile`, and
   * `apps/web/src/features/composer/agent-turn-client.ts`'s optional
   * `uploadFile` seam). Omitted or missing `uploadFile` leaves every
   * staged attachment in an explained `"error"` state rather than
   * throwing — the same "no live client yet" seam `turnService` above
   * already uses.
   */
  uploadClient?: AttachmentUploadClient;
  /**
   * T33B7: local, pre-network ceilings on attachment count/size,
   * surfaced *before* the picker opens (`describeAttachmentLimits`).
   * Defaults to `DEFAULT_ATTACHMENT_LIMITS`.
   */
  attachmentLimits?: AttachmentLimits;
  /**
   * T278: capturing a NEW photo with the device camera — a SECOND
   * attachment source, distinct from `attachmentSource` above (see
   * `attachment-source-port.ts`'s `CameraCapturePort` doc comment for
   * why this is a sibling port rather than a second method on
   * `AttachmentSourcePort`). Optional and defaults to
   * `createUnavailableCameraCapturePort()` — the injection fallback for
   * a caller that wants camera capture explicitly disabled. **T290**:
   * the session mount's own default is now
   * `createExpoCameraCapturePort()` (`./expo-camera-capture-port.ts`), a
   * real `expo-image-picker`-backed capture (see that module's header
   * for the one disclosed native-layer permission quirk
   * `attachment-source-port.ts`'s `CameraCapturePort` doc comment
   * documents). A captured photo is staged and uploaded through the
   * exact same `evaluateAttachmentCandidate`/`stageAttachment`/
   * `uploadClient` pipeline as a picked file — see `stageAndUploadFiles`
   * below — so every limit in `attachmentLimits` applies to it
   * identically.
   */
  cameraCapture?: CameraCapturePort;
  /**
   * T70: the actual recorder behind the mic action — T33B7 deliberately
   * left "recording itself" for a later task; T276 is the task that
   * shipped it. When granted, pressing the mic toggles a real
   * `VoiceCaptureController` (`../voice/voice-model.ts`). **T277
   * corrected this comment**: the controller no longer touches an
   * outbox at all — a finished transcript is applied to `state.draft`
   * (see `handleMicPress` below and `../voice/voice-model.ts`'s header
   * for the full behaviour-change writeup) so the user can edit and
   * decide whether to send it, exactly like text they typed themselves.
   * Optional, defaults to `createExpoAudioVoiceCapturePort()` (T276) —
   * a real, `expo-audio`-backed recorder; see that module's own header
   * for the dependency decision, the REQUESTED-vs-MEASURED
   * recording-format disclosure, and the one gap it discloses (a
   * cancelled recording's file is not deleted). `createUnavailableVoice
   * CapturePort` (`../voice/voice-capture-port.ts`) remains available
   * for a caller that wants voice entry explicitly disabled; it is no
   * longer this prop's default.
   *
   * This is now the ONLY OS-permission port the mic action resolves
   * through (T83, `mic-press-model.ts`): `VoiceCapturePort` already
   * extends the same `PermissionPort` shape T33B7's now-removed
   * `MicPermissionPort` prop used, so a denied or unavailable microphone
   * renders through `PermissionRecoveryNotice kind="microphone"` from
   * this ONE port's own `requestStart()`/`requestPermission()` calls —
   * see `mic-press-model.ts`'s header for the double-prompt bug this
   * closed (T70 had filed it as a seam here; T83 is the fix, not just
   * the same object passed to two props, which would still have
   * resolved permission twice). T276's real port never calls either
   * permission method from its own `start()` — see that module's header
   * and `expo-audio-voice-capture-port.test.ts`'s own counting-bindings
   * proof — so this invariant holds for the real recorder exactly as it
   * did for the unavailable one.
   */
  voiceCapture?: VoiceCapturePort;
  /**
   * T277 (plan.md §9.4 "Groq transcription and draft insertion"): transport for turning a
   * captured `{ kind: "audio" }` clip into text — mirrors `uploadClient`
   * above exactly (same "duck-typed, optional method, no live client
   * wired here" shape; `packages/client/src/daemon-client.ts`'s real
   * `transcribeVoiceClip` implements it).
   *
   * **T282 wires this at the mount**: the session route
   * (`app/h/[serverId]/session/[agentId]/index.tsx`) now passes the live
   * `DaemonClient` itself, narrowed to `VoiceTranscriptionClient` by
   * `resolveTranscribeClient` — the same `AppCore.connection`-derived
   * `DaemonClient`
   * `queueModeClient`/`turnStatusClient` below already receive from the
   * route layer — see `app-shell/session-route-daemon-clients.ts`'s
   * `resolveTranscribeClient`. CORRECTED at the P9-P merge gate: this
   * said the route passes `client.transcribeVoiceClip.bind(client)`.
   * Nothing binds anything — `resolveTranscribeClient` casts the whole
   * client, and that distinction is load-bearing rather than stylistic:
   * `voiceController`'s `useMemo` below is keyed on `transcribeClient`,
   * so a freshly-bound function would be a new identity every render and
   * would rebuild the controller mid-recording. A maintainer who "fixed"
   * the code to match the old wording would introduce that bug. The
   * mechanism was copied from T282's own ledger brief, not from the
   * tree. CORRECTED at T282: this comment used to
   * say **"Left undone deliberately in this task"**, reasoning that
   * wiring it blind, with no device or live daemon connection available
   * to prove the round trip end to end, was worse than a disclosed,
   * honestly un-wired optional prop — true of T277, no longer true.
   * Still optional, and still `undefined` with no active daemon
   * connection (a fresh `resolveTranscribeClient` read, same as
   * `queueModeClient`/`turnStatusClient`): a captured `{ kind: "audio"
   * }` clip resolves `VoiceStopOutcome`'s `"transcription-unavailable"`
   * — a truthful "no transcription client connected" state, surfaced
   * through `voiceOutcomeDisplay` below, never a silent no-op.
   */
  transcribeClient?: VoiceTranscriptionClient;
  /**
   * T33B7: the durable outbox every send is recorded through (plan.md
   * §7.1/§12.5). T75: this used to be reached only by an
   * attachment-bearing send — a text-only send, the most common send in
   * the app, bypassed the real `OutboxController` entirely; `handleSend`
   * now routes every send, text-only or not, through `sendWithOutbox`.
   * Defaults to a private `coreComposer.OutboxController` constructed
   * from `structuredStorage`/`clock` below when omitted.
   */
  outbox?: InstanceType<typeof coreComposer.OutboxController>;
  /**
   * T33B7: backing store for the default `outbox` above. Defaults to
   * `createInMemoryStructuredStorage()` (not durable across an app
   * restart — see `in-memory-outbox-runtime.ts`'s doc comment) when
   * neither this nor `outbox` is supplied. Ignored when `outbox` is
   * supplied directly.
   */
  structuredStorage?: StructuredStorage;
  /** T33B7: clock for the default `outbox` above. Defaults to `createSystemClock()`. Ignored when `outbox` is supplied directly. */
  clock?: Clock;
  /**
   * T33B7: the session/agent id outbox entries are scoped to (every
   * send, since T75 — see `ComposerProps.outbox`'s doc comment).
   * Defaults to `"local"` only when omitted; the session
   * route (`app/h/[serverId]/session/[agentId]/index.tsx`) passes its
   * own `agentId`, so real sends are scoped per agent rather than
   * colliding under one shared key. T33B7 filed that as a seam for
   * `app/` and the P5-W13 merge gate took it, since T33B7's commit
   * landed after T32S9's and neither could reach the other's file.
   */
  sessionId?: string;
  /**
   * T39B: model/thinking-level transport, mirrors
   * `packages/client/src/daemon-client.ts`'s real `fetchAgent`/
   * `listProviderModels`/`setAgentModel`/`setAgentThinkingOption` — see
   * `model-thinking-model.ts`'s module doc for exactly why those are
   * the right names (not `listAgentModels`/`listAgentThinkingOptions`,
   * which do not exist on `DaemonClient`). Optional, and still
   * unwired at every mount — which is NOT the same claim as "no
   * Android route wires a live `DaemonClient` into this feature
   * yet". That was true when T39B wrote it and T132 falsified it:
   * the production session route
   * (`app/h/[serverId]/session/[agentId]/index.tsx`) now passes
   * `queueModeClient`/`turnStatusClient` off a live
   * `AppCore.connection`-derived `DaemonClient` (see those props'
   * doc comments). It simply has no `modelThinkingClient` on its
   * `<Composer .../>` yet, so omitted stays today's only real shape
   * and renders `ModelThinkingPicker`'s truthful "Connect to a
   * daemon…" unavailable state instead of an enabled control that
   * can only fail. Wiring it means proving a real `DaemonClient`
   * satisfies `DaemonModelThinkingSource`, the way
   * `app-shell/session-route-daemon-clients.ts` proved it for the
   * other two; nobody has done that yet.
   */
  modelThinkingClient?: DaemonModelThinkingSource;
  /**
   * T39C: session-wide steer/follow-up queue-mode transport, mirrors
   * `packages/client/src/daemon-client.ts`'s real `getQueueModes`/
   * `setSteeringMode`/`setFollowUpMode` — see `queue-mode-model.ts`'s
   * module doc for exactly why those are the right names, and for how
   * this differs from `composer-model.ts`'s own per-message
   * `QueueDispatchMode`. Optional — still the right shape for a test
   * harness or a build with no connection, in which case omitting this
   * renders `QueueModePicker`'s truthful "Connect to a daemon…"
   * unavailable state instead of an enabled control that can only fail.
   * **T132**: the production session route
   * (`app/h/[serverId]/session/[agentId]/index.tsx`, via that
   * `app-shell/session-route-daemon-clients.ts`) now supplies the
   * real `AppCore.connection`-derived `DaemonClient` here, so this is no
   * longer the "no live client yet" seam it used to be — see that
   * route's own "T132 mount" doc comment.
   */
  queueModeClient?: DaemonQueueModeSource;
  /**
   * T39C: retry/compaction live-status transport, mirrors
   * `packages/client/src/daemon-client.ts`'s real
   * `on("agent_stream", handler)` — see `turn-status-model.ts`'s module
   * doc for why this reads the raw stream directly rather than going
   * through `frontend-core`'s timeline domain (which drops `pi_retry`
   * silently today). Optional, same shape as `queueModeClient` above:
   * omitted renders nothing at all (see `TurnStatusBanner.tsx`'s own
   * "renders nothing when there is nothing to say" doc comment) rather
   * than a banner that can never receive a real event. **T132** wires
   * the same real client through as `queueModeClient` above — see that
   * prop's own doc comment.
   */
  turnStatusClient?: DaemonTurnStatusSource;
  /**
   * T292 (owner request): slash-command palette transport, mirrors
   * `packages/client/src/daemon-client.ts`'s real `listCommands(agentId,
   * requestId?)` — see `slash-command-model.ts`'s module doc for why
   * this is a real, wire-connected method (never a hard-coded set) and
   * why this feature deliberately carries no availability enum the way
   * `modelThinkingClient`/`queueModeClient` do. Optional, same "no
   * client yet" seam as every sibling client prop on this component: an
   * omitted prop (or one whose `listCommands` is itself missing) leaves
   * `SlashCommandPicker` unrendered — commands stay at `[]`, so the
   * palette's own `isOpen` can never become `true` — rather than an
   * enabled control with nothing to show.
   */
  slashCommandsClient?: DaemonSlashCommandSource;
  /**
   * T293: real `DaemonClient` wiring for Pi's `getEditorText`/
   * `pasteToEditor` tier-2 read bridge (plan.md §4.2), closing the seam
   * T292's own `handleValueChange` doc comment named. Unlike every other
   * client prop above, this has no visible UI of its own — it only
   * answers a daemon push with the composer's current draft, mirrored
   * into a ref so the answer is always fresh without re-subscribing on
   * every keystroke (see the wiring `useEffect` below). Optional, same
   * "no client yet" seam as every sibling prop: omitted, nothing answers
   * a `getEditorText` extension call, and the daemon's own bounded
   * timeout covers that exactly as it covers a second, unanswered client.
   */
  editorTextClient?: DaemonEditorTextSource;
  placeholder?: string;
  testId?: string;
}

const TONE_BY_STATUS: Record<ComposerEntryStatus, ChipTone> = {
  pending: "info",
  sent: "success",
  failed: "danger",
};

/**
 * T70: visible text (plan.md §10.5 — status is never colour alone) for
 * the last `requestStop()`/`requestCancel()` result. `null` for the one
 * outcome that means "nothing changed": `"not-recording"`, the button
 * pressed while already idle. (`"already-recording"` is deliberately NOT
 * handled here — it belongs to `VoiceStartOutcome`, which this function
 * does not accept; `handleMicPress` routes a start outcome separately.)
 */
function voiceOutcomeDisplay(
  outcome: VoiceStopOutcome | VoiceCancelOutcome,
): { text: string; tone: StatusTone } | null {
  switch (outcome.outcome) {
    // T277: a finished transcript is added to the draft, never sent —
    // see ../voice/voice-model.ts's header for the behaviour change.
    case "drafted":
      return { text: "Voice message added to draft", tone: "success" };
    case "transcription-failed":
      return { text: `Voice transcription failed: ${outcome.message}`, tone: "danger" };
    case "empty-transcript":
      return { text: "No speech detected", tone: "neutral" };
    case "transcription-unavailable":
      return { text: "Voice transcription isn't available yet", tone: "neutral" };
    case "cancelled":
      return { text: "Recording cancelled", tone: "neutral" };
    case "not-recording":
      return null;
    default:
      return null;
  }
}

/**
 * The Android bottom composer (plan.md §9.2; T33B1; steer/follow-up/
 * abort T33B2) — built on the shared `PromptBar` recipe plus the
 * microphone/attachment actions §9.2 calls out as "prominent". All state
 * shaping (the optimistic pending -> sent -> failed lifecycle, draft
 * recovery on failure, the steer/follow-up queue transitions, abort)
 * lives in `composer-model.ts` and is unit tested there; this component
 * is a thin view that wires that model to `useState` and to the
 * primitives.
 *
 * Optimistic appearance: `handleSend`/`handleSteer`/`handleFollowUp`/
 * `handleAbort` all call their `composer-model.ts` "submit"/"abort"
 * function synchronously first — the new entry (or the stopped-turn
 * state) is reflected immediately, before the injected `onSubmit`/
 * `turnService` call is even invoked, let alone before it resolves.
 * Resolving or rejecting only ever *reconciles* that already-visible
 * state, via `markEntrySent`/`markEntryFailed` (plain send) or
 * `markSteerSent`/`markSteerFailed`/`markFollowUpSent`/
 * `markFollowUpFailed` (steer/follow-up).
 *
 * While `turnRunning` is true, plain `PromptBar` `Send` is disabled
 * (`canSend={... && !state.turnRunning}`) — during a turn, sending is
 * ambiguous, so the user must choose explicitly between the "Redirect
 * current response" (steer), "Queue follow-up message" (follow-up), and
 * "Stop current response" (abort) controls that appear in their place.
 * See `composer-model.ts`'s doc comment for the product distinction
 * between the three.
 *
 * TalkBack: `Section` gives the whole control a `"header"`-role name
 * ("Message composer") without collapsing its interactive children into
 * one node (see that primitive's own note on why plain
 * `accessible`/`accessibilityLabel` grouping doesn't work here); the
 * text field's accessible name comes from `PromptBar`'s own `label`
 * prop; the microphone/attachment controls are real 48dp `Pressable`
 * buttons with mandatory accessible names (`composer-icon-action.tsx`).
 * Each outgoing entry renders its text plus a status `Chip` whose label
 * is always visible text (`entryStatusLabel` — "Sending…"/"Sent"/
 * "Failed", never colour alone, plan.md §10.5) and, only once failed, a
 * separate, individually focusable "Retry" `Button` — deliberately kept
 * out of any collapsing `accessible` wrapper so TalkBack can still reach
 * that button on its own rather than only hearing a merged row summary.
 * The entries list carries `accessibilityLiveRegion="polite"` so a
 * status change (or a new optimistic entry appearing) is announced
 * without moving focus.
 *
 * Keyboard ownership (plan.md §9.3; T33B4): this component renders no
 * `Modal` or bottom sheet of its own — just plain `View`/`Pressable`
 * siblings around `PromptBar`'s `TextInput` — so nothing here competes
 * for keyboard ownership with an extension sheet mounted elsewhere in
 * the tree. The plan rule itself ("the composer must retain keyboard
 * ownership when an extension sheet opens") is encoded as an RN-free
 * decision in `composer-focus-model.ts` (`resolveFocusOwner` and its
 * open/close/rotate transitions — see that module's tests) rather than
 * here, because there is nothing this component can itself observe or
 * decide today: `PromptBar`'s `TextInput` exposes no `onFocus`/`onBlur`
 * for this component to read real focus state from (a gap in a `ui/
 * recipes/` file this task does not own), and the sheet primitive that
 * would need to cooperate (`ui/primitives/Sheet.tsx`) currently renders
 * its panel inside React Native's `Modal` — which opens a separate
 * native Android window and *would* take IME focus away from whatever
 * `TextInput` was focused underneath it, the exact failure plan.md
 * §9.3's "use Portal rather than a detached Modal" is warning against
 * (also not owned by this task; see this task's report).
 *
 * What this component *does* control, and does here: `PromptBar` — the
 * input and the send button — sits last inside the `Section`, OUTSIDE
 * the `ScrollView` every other control lives in, and the root, the
 * `Section` and that `ScrollView` all shrink (`flexShrink: 1`) while
 * `PromptBar` keeps its intrinsic height. So when the shell hands this
 * component less height than its controls want (the queue-mode and
 * model pickers alone outgrow a phone with the keyboard open), the
 * pickers scroll and the prompt bar stays put above the IME — the
 * `reservesOwnHeight` half of `composer-focus-model.ts`'s
 * `COMPOSER_LAYOUT_CONTRACT`, which is about the prompt bar, not the
 * controls above it. (CORRECTED at T338: this said the root container
 * "never shrinks (`flexShrink: 0`), so it cannot be compressed out of
 * view". Maestro run 34470287372 measured the opposite outcome on a
 * real session: the un-shrinkable root overflowed the keyboard-shrunk
 * shell, and `composer-send` was the part pushed off screen — pruned
 * from the accessibility tree on both shard-4 flows, right after the
 * prompt had been typed.) The `ScrollView` takes
 * `keyboardShouldPersistTaps="handled"` for T329's reason: a default
 * ScrollView spends the first tap after typing on dismissing the
 * keyboard and never delivers it to the control underneath. The other
 * half, `consumesKeyboardInset`,
 * is the session shell's own doing: `app-shell/compact-shell.tsx` pads
 * its bottom by the live keyboard height (`app-shell/keyboard-inset.ts`,
 * T329), so this component ends above the IME rather than under it.
 * (CORRECTED at T329: this said that half "is Android's own
 * `windowSoftInputMode="adjustResize"` resizing the window around the
 * IME rather than drawing under it". Under edge-to-edge the window is
 * never resized around the IME; Maestro run 34444464068 found this
 * component's input and send button underneath the keyboard on every
 * session-screen flow.) Real focus retention through a live
 * `Modal`/`Portal` sheet remains for T59 (real device) to prove; this
 * component does not claim it.
 */
export function Composer({
  onSubmit,
  onMicPress,
  onAttachPress,
  turnRunning,
  turnService,
  attachmentSource,
  uploadClient,
  attachmentLimits,
  cameraCapture,
  voiceCapture,
  transcribeClient,
  outbox: outboxProp,
  structuredStorage: structuredStorageProp,
  clock: clockProp,
  sessionId,
  modelThinkingClient,
  queueModeClient,
  turnStatusClient,
  slashCommandsClient,
  editorTextClient,
  placeholder,
  testId,
}: ComposerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState(EMPTY_COMPOSER_STATE);
  const sequenceRef = useRef(0);

  // --- T33B7: attachments + mic permission -------------------------------
  const resolvedAttachmentSource = useMemo(
    () => attachmentSource ?? createUnavailableAttachmentSourcePort(),
    [attachmentSource],
  );
  const resolvedVoiceCapture = useMemo(
    () => voiceCapture ?? createExpoAudioVoiceCapturePort(),
    [voiceCapture],
  );
  const resolvedCameraCapture = useMemo(
    () => cameraCapture ?? createUnavailableCameraCapturePort(),
    [cameraCapture],
  );
  const limits = attachmentLimits ?? DEFAULT_ATTACHMENT_LIMITS;
  const resolvedSessionId = sessionId ?? "local";

  // --- T39B: model/thinking-level selection -------------------------------
  // One controller per (client, agentId) identity, same rationale as
  // `voiceController`'s own `useMemo` above. `load()` re-fetches the
  // authoritative snapshot on mount and whenever either changes; every
  // subsequent read of the controller's state goes through
  // `modelThinkingState`, mirrored from `controller.getState()` after
  // each call — see `model-thinking-model.ts`'s module doc for why the
  // controller itself holds no React state of its own.
  const modelThinkingController = useMemo(
    () =>
      createModelThinkingController({ agentId: resolvedSessionId, client: modelThinkingClient }),
    [modelThinkingClient, resolvedSessionId],
  );
  const [modelThinkingState, setModelThinkingState] = useState(INITIAL_MODEL_THINKING_STATE);
  useEffect(() => {
    let cancelled = false;
    void modelThinkingController.load().then(() => {
      if (!cancelled) setModelThinkingState(modelThinkingController.getState());
    });
    return () => {
      cancelled = true;
    };
  }, [modelThinkingController]);
  const handleSelectModel = useCallback(
    (modelId: string) => {
      void modelThinkingController
        .setModel(modelId)
        .then(() => setModelThinkingState(modelThinkingController.getState()));
    },
    [modelThinkingController],
  );
  const handleSelectThinking = useCallback(
    (thinkingOptionId: string | null) => {
      void modelThinkingController
        .setThinkingOption(thinkingOptionId)
        .then(() => setModelThinkingState(modelThinkingController.getState()));
    },
    [modelThinkingController],
  );

  // --- T39C: session-wide steer/follow-up queue mode ----------------------
  // Same one-controller-per-(client, agentId)-identity shape as
  // `modelThinkingController` above — see `queue-mode-model.ts`'s module
  // doc for why this is a *different* setting from `mode`/`setMode`
  // (the per-message `QueueDispatchMode` chip) below.
  const queueModesController = useMemo(
    () => createQueueModesController({ agentId: resolvedSessionId, client: queueModeClient }),
    [queueModeClient, resolvedSessionId],
  );
  const [queueModesState, setQueueModesState] = useState(INITIAL_QUEUE_MODES_STATE);
  useEffect(() => {
    let cancelled = false;
    void queueModesController.load().then(() => {
      if (!cancelled) setQueueModesState(queueModesController.getState());
    });
    return () => {
      cancelled = true;
    };
  }, [queueModesController]);
  const handleSelectSteeringMode = useCallback(
    (mode: QueueMode) => {
      void queueModesController
        .setSteeringMode(mode)
        .then(() => setQueueModesState(queueModesController.getState()));
    },
    [queueModesController],
  );
  const handleSelectFollowUpMode = useCallback(
    (mode: QueueMode) => {
      void queueModesController
        .setFollowUpMode(mode)
        .then(() => setQueueModesState(queueModesController.getState()));
    },
    [queueModesController],
  );

  // --- T292: slash-command palette -----------------------------------------
  // Same one-controller-per-(client, agentId)-identity shape as
  // `modelThinkingController`/`queueModesController` above — see
  // `slash-command-model.ts`'s module doc for why this controller
  // carries no availability enum the way those two do. `load()` fetches
  // the list once per identity; every keystroke additionally calls
  // `notifyDraftChanged` (see `handleValueChange` below) so the palette
  // can auto-open the instant the draft becomes a bare "/" prefix
  // without waiting on a network round trip.
  const slashCommandsController = useMemo(
    () =>
      createSlashCommandsController({ agentId: resolvedSessionId, client: slashCommandsClient }),
    [slashCommandsClient, resolvedSessionId],
  );
  const [slashCommandsState, setSlashCommandsState] = useState(INITIAL_SLASH_COMMANDS_STATE);
  useEffect(() => {
    let cancelled = false;
    void slashCommandsController.load().then(() => {
      if (!cancelled) setSlashCommandsState(slashCommandsController.getState());
    });
    return () => {
      cancelled = true;
    };
  }, [slashCommandsController]);

  // --- T293: getEditorText / pasteToEditor composer read -------------------
  // Mirrors `state.draft` into a ref rather than re-wiring the daemon
  // subscription on every keystroke — `wireEditorTextResponder` reads
  // `draftRef.current` fresh each time a request actually arrives, so the
  // effect below only re-runs when the daemon connection or session
  // identity changes. Reading `state.draft` (rather than only
  // `handleValueChange`'s `value` argument) means this stays correct for
  // EVERY way the draft can change — typing, a selected slash command
  // (`handleSelectSlashCommand`), and a completed voice transcript
  // (`applyTranscriptToDraft`) — without duplicating this ref-update at
  // each of those call sites.
  const draftRef = useRef(state.draft);
  useEffect(() => {
    draftRef.current = state.draft;
  }, [state.draft]);
  useEffect(() => {
    if (!editorTextClient) {
      return;
    }
    return wireEditorTextResponder(editorTextClient, {
      agentId: resolvedSessionId,
      getDraftText: () => draftRef.current,
    });
  }, [editorTextClient, resolvedSessionId]);

  const handleOpenSlashCommands = useCallback(() => {
    slashCommandsController.open();
    setSlashCommandsState(slashCommandsController.getState());
  }, [slashCommandsController]);
  const handleDismissSlashCommands = useCallback(() => {
    slashCommandsController.dismiss();
    setSlashCommandsState(slashCommandsController.getState());
  }, [slashCommandsController]);
  // Replaces the draft with the selected command's own trigger text and
  // closes the palette — never calls onSubmit, so this can never itself
  // send anything (see `SlashCommandPicker.tsx`'s doc comment).
  const handleSelectSlashCommand = useCallback(
    (command: SlashCommand) => {
      setState((current) => ({ ...current, draft: slashCommandDraftText(command) }));
      slashCommandsController.dismiss();
      setSlashCommandsState(slashCommandsController.getState());
    },
    [slashCommandsController],
  );

  // --- T39C: retry/compaction live status ---------------------------------
  // Unlike the two controllers above, this one is a pure subscription:
  // `subscribe()` synchronously flips `availability` and (when supported)
  // registers the live handler; every event after that mutates the
  // controller's own state, mirrored into `turnStatusState` by re-reading
  // `getState()` inside the handler passed to `subscribe()` — there is no
  // request/response to `.then()` off, so this polls the controller's
  // state via a dedicated re-render trigger instead (`turnStatusTick`).
  const turnStatusController = useMemo(
    () => createTurnStatusController({ agentId: resolvedSessionId, client: turnStatusClient }),
    [turnStatusClient, resolvedSessionId],
  );
  const [turnStatusState, setTurnStatusState] = useState(INITIAL_TURN_STATUS_STATE);
  useEffect(() => {
    turnStatusController.subscribe(() => setTurnStatusState(turnStatusController.getState()));
    setTurnStatusState(turnStatusController.getState());
    return () => {
      turnStatusController.unsubscribe();
    };
  }, [turnStatusController]);

  // One outbox per (outboxProp | structuredStorage, clock) identity —
  // same rationale as `apps/web/src/features/composer/use-composer.ts`'s
  // own `useMemo` around `coreComposer.OutboxController`. When no real
  // `structuredStorage`/`clock` is injected, both default to the
  // in-memory adapters in `in-memory-outbox-runtime.ts` — see
  // `ComposerProps.outbox`'s doc comment for what that means.
  const structuredStorage = useMemo(
    () => structuredStorageProp ?? createInMemoryStructuredStorage(),
    [structuredStorageProp],
  );
  const clockImpl = useMemo(() => clockProp ?? createSystemClock(), [clockProp]);
  const outbox = useMemo(
    () => outboxProp ?? new coreComposer.OutboxController(structuredStorage, clockImpl),
    [outboxProp, structuredStorage, clockImpl],
  );

  // T75: composer entry id -> outbox entry id, for an entry whose send
  // is currently recorded in the durable outbox. Populated by
  // `sendWithOutbox` on enqueue; cleared once that entry is confirmed
  // `sent` (already removed from the outbox by `outbox.markSent`) or
  // once `handleRetry` has reconciled a failed entry's record via
  // `outbox.remove` — see that callback below.
  const outboxEntryIdRef = useRef<Map<string, string>>(new Map());

  // --- T70/T277: voice entry -----------------------------------------------
  // One controller per (port, transcribeClient) identity. T277: no longer
  // built over `outbox`/`resolvedSessionId`/`onSubmit` — a finished
  // transcript is applied to `state.draft` (`handleMicPress` below), never
  // sent, so this controller needs none of the send machinery any more. See
  // `voiceCapture`'s and `transcribeClient`'s doc comments above, and
  // `../voice/voice-model.ts`'s header for the full behaviour-change
  // writeup.
  const voiceController = useMemo<VoiceCaptureController>(
    () =>
      createVoiceCaptureController({
        port: resolvedVoiceCapture,
        ...(transcribeClient ? { transcribe: transcribeClient } : {}),
      }),
    [resolvedVoiceCapture, transcribeClient],
  );
  const [voiceState, setVoiceState] = useState<VoiceState>(IDLE_VOICE_STATE);
  const [voiceOutcome, setVoiceOutcome] = useState<VoiceStopOutcome | VoiceCancelOutcome | null>(
    null,
  );

  const [attachmentsState, setAttachmentsState] =
    useState<AttachmentsState>(EMPTY_ATTACHMENTS_STATE);
  const attachmentsStateRef = useRef(attachmentsState);
  useEffect(() => {
    attachmentsStateRef.current = attachmentsState;
  }, [attachmentsState]);
  const attachmentSequenceRef = useRef(0);
  const generateAttachmentId = useCallback((): string => {
    attachmentSequenceRef.current += 1;
    return `composer-attachment-${Date.now().toString(36)}-${attachmentSequenceRef.current}`;
  }, []);

  const [attachmentPermissionState, setAttachmentPermissionState] =
    useState<PermissionState | null>(null);
  const [micPermissionState, setMicPermissionState] = useState<PermissionState | null>(null);
  const [capturePermissionState, setCapturePermissionState] = useState<PermissionState | null>(
    null,
  );

  // `turnRunning` is host-controlled (since T32S13 it is fed by a live
  // signal — see `ComposerProps.turnRunning`'s doc comment). Mirror it into
  // the model on change rather than reading it directly, since
  // `abortTurn`/`submitSteer`/`submitFollowUp` all key off
  // `state.turnRunning`. A normal (non-abort) transition to `false`
  // goes through `finishTurn`, which deliberately never clears a queued
  // follow-up — see that function's doc comment.
  useEffect(() => {
    setState((current) =>
      current.turnRunning === turnRunning
        ? current
        : turnRunning
          ? startTurn(current)
          : finishTurn(current),
    );
  }, [turnRunning]);

  const generateId = useCallback(() => {
    sequenceRef.current += 1;
    return `composer-entry-${Date.now().toString(36)}-${sequenceRef.current}`;
  }, []);

  // T292: this is the ONE call site where the composer's draft text
  // changes from user typing (a selected slash command instead goes
  // through `handleSelectSlashCommand` above, which also updates
  // `slashCommandsState` itself). `notifyDraftChanged` recomputes the
  // palette's auto-open trigger on every keystroke; the `setState`
  // still runs unconditionally regardless of what the controller
  // decides.
  //
  // CLOSED by T293 (`getEditorText`, reading the composer's current draft
  // for an extension) — this said the seam was not yet closed, naming a
  // hypothetical `onDraftChange` prop. T293 mirrored `state.draft` (not
  // this callback's `value` argument) into `draftRef` above instead, via
  // its own `useEffect` on `state.draft` — that covers every way the
  // draft changes (typing here, a selected slash command, a completed
  // voice transcript) in one place, rather than adding a prop this
  // callback would have to remember to call alongside the two lines
  // below, and alongside `handleSelectSlashCommand`'s own draft write.
  const handleValueChange = useCallback(
    (value: string) => {
      setState((current) => ({ ...current, draft: value }));
      slashCommandsController.notifyDraftChanged(value);
      setSlashCommandsState(slashCommandsController.getState());
    },
    [slashCommandsController],
  );

  // Uploads one already-picked file. `uploadClient?.uploadFile` is
  // optional — see `ComposerProps.uploadClient`'s doc comment — so a
  // missing/omitted transport lands the staged entry in an explained
  // `"error"` state rather than throwing, mirroring
  // `apps/web/src/features/composer/use-attachments.ts`'s `upload`.
  const uploadPickedFile = useCallback(
    async (id: string, file: PickedAttachmentFile): Promise<void> => {
      if (!uploadClient?.uploadFile) {
        setAttachmentsState((current) =>
          markAttachmentError(current, id, "Attachments are unavailable: no live connection."),
        );
        return;
      }
      try {
        const bytes = await file.readAsBytes();
        const uploaded = await uploadClient.uploadFile({
          fileName: file.name,
          mimeType: file.mimeType || "application/octet-stream",
          bytes,
        });
        setAttachmentsState((current) => markAttachmentUploaded(current, id, uploaded));
      } catch (error) {
        setAttachmentsState((current) =>
          markAttachmentError(current, id, error instanceof Error ? error.message : String(error)),
        );
      }
    },
    [uploadClient],
  );

  // Shared by `handleAttachPress` (picked files) and `handleCapturePress`
  // (a single captured photo) below — T278 pulled this out of
  // `handleAttachPress` so both sources run through the IDENTICAL
  // evaluate/stage/upload pipeline (and therefore the identical
  // `limits`), rather than a second, easily-drifting copy of the loop.
  // A picked or captured file whose `mimeType` starts with `"image/"`
  // carries its `uri` through as `previewUri` (`attachment-model.ts`'s
  // `AttachmentCandidate.previewUri`) — `stageAttachment` itself drops
  // it for anything else, so this call site does not need its own
  // image check to keep that rule.
  const stageAndUploadFiles = useCallback(
    (files: readonly PickedAttachmentFile[]) => {
      if (files.length === 0) return;

      let working = attachmentsStateRef.current;
      const toUpload: Array<{ id: string; file: PickedAttachmentFile }> = [];
      for (const file of files) {
        const mimeType = file.mimeType || "application/octet-stream";
        const size = file.size ?? 0;
        const id = generateAttachmentId();
        const acceptance = evaluateAttachmentCandidate(
          working,
          { name: file.name, mimeType, size },
          limits,
        );
        working = stageAttachment(working, id, {
          name: file.name,
          mimeType,
          size,
          previewUri: file.uri,
        });
        if (acceptance.accepted) {
          toUpload.push({ id, file });
        } else {
          working = markAttachmentError(working, id, acceptance.message);
        }
      }
      attachmentsStateRef.current = working;
      setAttachmentsState(working);
      for (const { id, file } of toUpload) {
        void uploadPickedFile(id, file);
      }
    },
    [limits, generateAttachmentId, uploadPickedFile],
  );

  // Fires `onAttachPress` immediately (unchanged T33B1 contract — see
  // `ComposerProps.onAttachPress`'s doc comment), then runs the T33B7
  // permission + pick + stage + upload flow. `resolvePermission` mirrors
  // `../connect/qr-scan-model.ts`'s "read; prompt only if undetermined;
  // never re-prompt a denial" rule, so a user who already declined sees
  // `PermissionRecoveryNotice` immediately rather than a repeated OS
  // dialog. Every candidate is checked against `limits` — surfaced to
  // the user up front via `describeAttachmentLimits`'s caption below —
  // *before* it is staged, so an over-limit file becomes a visible,
  // explained `"error"` entry rather than a silent drop or a failure
  // only discovered after upload.
  const handleAttachPress = useCallback(() => {
    onAttachPress();
    void (async () => {
      const status = await resolvePermission(resolvedAttachmentSource);
      setAttachmentPermissionState(status);
      if (status !== "granted") return;

      const picked = await resolvedAttachmentSource.pickFiles({ multiple: true });
      stageAndUploadFiles(picked);
    })();
  }, [onAttachPress, resolvedAttachmentSource, stageAndUploadFiles]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachmentsState((current) => removeAttachment(current, id));
  }, []);

  const handleRequestAttachmentPermission = useCallback(() => {
    void (async () => {
      const status = await resolvedAttachmentSource.requestPermission();
      setAttachmentPermissionState(status);
    })();
  }, [resolvedAttachmentSource]);

  const handleDismissAttachmentNotice = useCallback(() => {
    setAttachmentPermissionState(null);
  }, []);

  // T278: the camera-capture press — delegates the whole
  // permission-resolve-then-capture decision to `runCapturePress`
  // (`attachment-capture-model.ts`), exactly one resolution per press,
  // mirroring `handleAttachPress` above rather than
  // `mic-press-model.ts`'s internal-resolve shape (see that model's
  // header for why both shapes satisfy the same invariant). A captured
  // photo runs through the SAME `stageAndUploadFiles` pipeline as a
  // picked file — camera is a second SOURCE, not a second acceptance
  // path.
  const handleCapturePress = useCallback(() => {
    void (async () => {
      const result = await runCapturePress(resolvedCameraCapture);
      setCapturePermissionState(result.permissionState);
      if (result.file === null) return;
      stageAndUploadFiles([result.file]);
    })();
  }, [resolvedCameraCapture, stageAndUploadFiles]);

  const handleRequestCapturePermission = useCallback(() => {
    void (async () => {
      const status = await resolvedCameraCapture.requestPermission();
      setCapturePermissionState(status);
    })();
  }, [resolvedCameraCapture]);

  const handleDismissCaptureNotice = useCallback(() => {
    setCapturePermissionState(null);
  }, []);

  // Fires `onMicPress` immediately (unchanged T33B1 contract — see
  // `ComposerProps.onMicPress`'s doc comment). Then delegates the whole
  // start/stop decision to `runMicPress` (`mic-press-model.ts`, T83): it
  // starts a new recording when idle, or stops (transcribes) one already
  // running, over the real `voiceController` — toggling on the
  // controller's OWN state, never a flag tracked here. T83 closed the
  // double-prompt bug this used to have: permission is now resolved
  // EXACTLY ONCE per press, entirely inside `voiceController.
  // requestStart()` (over `resolvedVoiceCapture` — see
  // `mic-press-model.ts`'s header for the removed second call, and that
  // file's test for the counting-fake proof).
  //
  // T277: a `"drafted"` stop outcome is applied to `state.draft` here —
  // via the functional `setState` updater, so it composes with whatever
  // the user had already typed rather than racing a stale closure over
  // `state`, exactly the way `applyTranscriptToDraft`'s own doc comment
  // (`../voice/voice-model.ts`) argues an empty result must never
  // overwrite existing text: `cleanTranscript`/`requestStop` already
  // guarantee `text` is non-empty for a `"drafted"` outcome, so this call
  // site does not need its own emptiness check to keep that rule.
  const handleMicPress = useCallback(() => {
    onMicPress();
    void (async () => {
      const result = await runMicPress(voiceController);
      setVoiceState(result.voiceState);
      if (result.voiceOutcome !== null) {
        setVoiceOutcome(result.voiceOutcome);
        if (result.voiceOutcome.outcome === "drafted") {
          const transcript = result.voiceOutcome.text;
          setState((current) => ({
            ...current,
            draft: applyTranscriptToDraft(current.draft, transcript),
          }));
        }
      }
      if (result.micPermissionState !== null) {
        setMicPermissionState(result.micPermissionState);
      }
    })();
  }, [onMicPress, voiceController]);

  // Cancels a running recording, discarding it — only reachable while
  // `voiceState.status === "recording"` below (never while `"processing"`,
  // to avoid racing an in-flight `requestStop()`).
  const handleVoiceCancel = useCallback(() => {
    void (async () => {
      const outcome = await voiceController.requestCancel();
      setVoiceState(voiceController.getState());
      setVoiceOutcome(outcome);
    })();
  }, [voiceController]);

  // "Try again" from the mic notice — resolves through the SAME
  // (only) port `runMicPress` above uses, T83's whole point: no second,
  // separate `MicPermissionPort` to keep in sync with this one.
  const handleRequestMicPermission = useCallback(() => {
    void (async () => {
      const status = await resolvedVoiceCapture.requestPermission();
      setMicPermissionState(status);
    })();
  }, [resolvedVoiceCapture]);

  const handleDismissMicNotice = useCallback(() => {
    setMicPermissionState(null);
  }, []);

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  // Records the send in the durable outbox (plan.md §7.1/§12.5) before
  // calling `onSubmit`, and reconciles afterwards — this is the "flows
  // through the core outbox" half of this task's brief. T75: every send
  // reaches this now, text-only or not — `attachmentsToSend` is simply
  // `[]` for a plain text send. (Before T75, this was reached only when
  // `attachmentsToSend` was non-empty, so a text-only send — the most
  // common send in the app — bypassed the real `OutboxController`
  // entirely; see `ComposerProps.outbox`'s doc comment.)
  const sendWithOutbox = useCallback(
    async (
      entryId: string,
      text: string,
      attachmentsToSend: readonly ComposerUploadedAttachment[],
    ): Promise<void> => {
      let outboxEntryId: string | undefined;
      try {
        const outboxEntry = await outbox.enqueue({
          sessionId: resolvedSessionId,
          kind: "prompt",
          payload: { text, attachments: attachmentsToSend },
        });
        outboxEntryId = outboxEntry.id;
        outboxEntryIdRef.current.set(entryId, outboxEntryId);
        await outbox.markSending(outboxEntry.id);
        await onSubmit(text);
        await outbox.markSent(outboxEntry.id);
        outboxEntryIdRef.current.delete(entryId);
        setState((current) => markEntrySent(current, entryId));
      } catch (error) {
        if (outboxEntryId) {
          const message = error instanceof Error ? error.message : String(error);
          await outbox.markFailed(outboxEntryId, message).catch(() => undefined);
        }
        setState((current) => markEntryFailed(current, entryId));
      }
    },
    [outbox, resolvedSessionId, onSubmit],
  );

  const handleSend = useCallback(() => {
    const result = submitDraft(state, { generateId, now: Date.now });
    if (!result.entry) return;

    // T75: every send — text-only or attachment-bearing — is recorded
    // through the real outbox via `sendWithOutbox`. A send with at
    // least one uploaded attachment additionally gains the attachment
    // refs on its entry and clears the staged attachments once handed
    // off; a text-only send leaves `entry`/`nextState` exactly as
    // `submitDraft` produced them and passes an empty attachments list.
    const attachmentsToSend = uploadedAttachmentRefs(attachmentsStateRef.current);
    let entry: ComposerEntry = result.entry;
    let nextState: ComposerState = result.state;
    if (attachmentsToSend.length > 0) {
      entry = { ...result.entry, attachments: attachmentsToSend };
      nextState = {
        ...result.state,
        entries: result.state.entries.map((candidate) =>
          candidate.id === entry.id ? entry : candidate,
        ),
      };
      attachmentsStateRef.current = clearAttachments();
      setAttachmentsState(attachmentsStateRef.current);
    }
    setState(nextState);
    void sendWithOutbox(entry.id, entry.text, attachmentsToSend);
  }, [state, generateId, sendWithOutbox]);

  const handleSteer = useCallback(() => {
    const result = submitSteer(state, { generateId, now: Date.now });
    if (!result.entry) return;
    setState(result.state);
    const entryId = result.entry.id;
    const entryText = result.entry.text;

    Promise.resolve()
      .then(() => turnService.steer(entryText))
      .then(() => {
        setState((current) => markSteerSent(current, entryId));
      })
      .catch(() => {
        setState((current) => markSteerFailed(current, entryId));
      });
  }, [state, generateId, turnService]);

  const handleFollowUp = useCallback(() => {
    const result = submitFollowUp(state, { generateId, now: Date.now });
    if (!result.entry) return;
    setState(result.state);
    const entryId = result.entry.id;
    const entryText = result.entry.text;

    Promise.resolve()
      .then(() => turnService.followUp(entryText))
      .then(() => {
        setState((current) => markFollowUpSent(current, entryId));
      })
      .catch(() => {
        setState((current) => markFollowUpFailed(current, entryId));
      });
  }, [state, generateId, turnService]);

  const handleAbort = useCallback(() => {
    // Optimistic, like `handleSend`/`handleSteer`/`handleFollowUp`:
    // `abortTurn` flips `turnRunning` and drops any queued follow-up (and
    // steer) immediately, before `turnService.abort()` is even awaited —
    // see `abortTurn`'s doc comment for why a late resolution of an
    // already-dropped queue entry can never resurrect it.
    const result = abortTurn(state);
    if (!result.aborted) return;
    setState(result.state);
    Promise.resolve()
      .then(() => turnService.abort())
      .catch(() => {
        // Best-effort: the daemon may not have actually stopped the
        // turn. There is no live client yet to reconcile this against
        // (plan.md §12.4), so this is left as a no-op rather than
        // guessing at recovery here.
      });
  }, [state, turnService]);

  // T75: reconciles the failed entry's outbox-side record — when this
  // send actually reached `sendWithOutbox` (every send, since T75) that
  // record is parked `awaiting-confirmation` (`outbox.markFailed`'s
  // default) and nothing else in this component's call graph ever
  // reaches it again. Tapping Retry IS the user's explicit confirmation
  // (plan.md §12.5: "the user confirms uncertain sends"), so this
  // removes that record before restoring the entry's text to the draft
  // — the resend that follows (`handleSend` -> `sendWithOutbox`) mints a
  // fresh outbox entry, and the original is gone rather than orphaned.
  // `outboxEntryIdRef` has no entry for an id this component never sent
  // through the outbox (there is none today, since T75), so the lookup
  // is a safe no-op in that case.
  const handleRetry = useCallback(
    (id: string) => {
      const outboxEntryId = outboxEntryIdRef.current.get(id);
      if (outboxEntryId !== undefined) {
        outboxEntryIdRef.current.delete(id);
        void outbox.remove(outboxEntryId).catch(() => undefined);
      }
      setState((current) => recoverFailedDraft(current, id).state);
    },
    [outbox],
  );

  // Optimistic, like `handleSend`/`handleSteer`/`handleFollowUp`/
  // `handleAbort`: `setDispatchMode` flips `state.mode` immediately,
  // before `turnService.setMode` is even awaited. A rejection reverts to
  // whatever mode was in effect before this call (`previousMode`) rather
  // than leaving the model stuck on the requested mode — see
  // `revertDispatchMode`'s doc comment.
  const handleModeChange = useCallback(
    (mode: QueueDispatchMode) => {
      const result = setDispatchMode(state, mode);
      if (!result.changed) return;
      setState(result.state);
      const previousMode = result.previousMode;
      Promise.resolve()
        .then(() => turnService.setMode(mode))
        .catch(() => {
          setState((current) => revertDispatchMode(current, previousMode));
        });
    },
    [state, turnService],
  );

  // T70: what the voice status row (below) shows, or `null` to render
  // nothing — computed once here rather than three times inline in JSX.
  // T276: while a capture is actually in progress, this is no longer
  // text at all — see `VoiceCaptureIndicator`'s own doc comment for why
  // "recording" and "processing" get two different, wordless glyphs
  // instead. The settled-outcome case (idle, with something to report —
  // sent/failed/empty/unsupported/cancelled) is unchanged: that is an
  // announcement of what already happened, not a continuous status
  // label, so it keeps rendering through `StatusIndicator` exactly as
  // before.
  const voiceOutcomeDisplayValue: { text: string; tone: StatusTone } | null =
    voiceOutcome !== null ? voiceOutcomeDisplay(voiceOutcome) : null;
  const voiceStatusDisplay:
    | { kind: "indicator"; status: "recording" | "processing" }
    | { kind: "outcome"; text: string; tone: StatusTone }
    | null =
    voiceState.status === "recording" || voiceState.status === "processing"
      ? { kind: "indicator", status: voiceState.status }
      : voiceOutcomeDisplayValue !== null
        ? {
            kind: "outcome",
            text: voiceOutcomeDisplayValue.text,
            tone: voiceOutcomeDisplayValue.tone,
          }
        : null;

  const composerTestId = testId ?? "composer";

  // T343: the root never shrinks below its un-scrolling chrome (heading,
  // gaps, prompt bar), measured from the section and its controls — see
  // `composer-min-height-model.ts`. Without this, a shrinkable pinned
  // area above plus the keyboard below squeezed the whole composer to its
  // heading (Maestro run 34493338438: `composer-send` not found).
  const sectionHeightRef = useRef(0);
  const controlsHeightRef = useRef(0);
  const [minHeight, setMinHeight] = useState(0);
  const remeasureMinHeight = useCallback(() => {
    setMinHeight((previous) =>
      resolveComposerMinHeight(
        { sectionHeight: sectionHeightRef.current, controlsHeight: controlsHeightRef.current },
        previous,
      ),
    );
  }, []);
  const handleSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      sectionHeightRef.current = event.nativeEvent.layout.height;
      remeasureMinHeight();
    },
    [remeasureMinHeight],
  );
  const handleControlsLayout = useCallback(
    (event: LayoutChangeEvent) => {
      controlsHeightRef.current = event.nativeEvent.layout.height;
      remeasureMinHeight();
    },
    [remeasureMinHeight],
  );

  return (
    <View style={[styles.root, { minHeight }]} testID={`${composerTestId}-root`}>
      <Section
        title={COMPOSER_ACCESSIBILITY_LABEL}
        testId={composerTestId}
        style={styles.section}
        onLayout={handleSectionLayout}
      >
        {/* T338: everything but the prompt bar scrolls; see the module doc's
            "What this component *does* control" paragraph. */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onLayout={handleControlsLayout}
          testID={`${composerTestId}-controls`}
        >
          {state.entries.length > 0 ? (
            <View
              style={styles.entries}
              accessibilityRole="none"
              accessibilityLiveRegion="polite"
              testID={`${composerTestId}-entries`}
            >
              {state.entries.map((entry) => (
                <ComposerEntryRow
                  key={entry.id}
                  entry={entry}
                  onRetry={handleRetry}
                  testId={`${composerTestId}-entry-${entry.id}`}
                />
              ))}
            </View>
          ) : null}
          {attachmentsState.entries.length > 0 ? (
            <View
              style={styles.entries}
              accessibilityLiveRegion="polite"
              testID={`${composerTestId}-attachments`}
            >
              {attachmentsState.entries.map((attachment) => (
                <StagedAttachmentRow
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={handleRemoveAttachment}
                  testId={`${composerTestId}-attachment-${attachment.id}`}
                />
              ))}
            </View>
          ) : null}
          <View style={styles.actionsRow}>
            <ComposerIconAction
              glyph={"\u{1F3A4}"}
              accessibleName={MIC_ACTION_LABEL}
              onPress={handleMicPress}
              testId={`${composerTestId}-mic`}
            />
            <ComposerIconAction
              glyph={"\u{1F4CE}"}
              accessibleName={ATTACH_ACTION_LABEL}
              onPress={handleAttachPress}
              testId={`${composerTestId}-attach`}
            />
            <ComposerIconAction
              glyph={"\u{1F4F7}"}
              accessibleName={CAPTURE_ACTION_LABEL}
              onPress={handleCapturePress}
              testId={`${composerTestId}-capture`}
            />
            <ComposerIconAction
              glyph={"/"}
              accessibleName={SLASH_COMMANDS_ACTION_LABEL}
              onPress={handleOpenSlashCommands}
              testId={`${composerTestId}-commands`}
            />
            <Text style={styles.attachmentLimits} testID={`${composerTestId}-attachment-limits`}>
              {describeAttachmentLimits(limits)}
            </Text>
          </View>
          <ModelThinkingPicker
            state={modelThinkingState}
            onSelectModel={handleSelectModel}
            onSelectThinking={handleSelectThinking}
            testId={`${composerTestId}-model-thinking`}
          />
          <QueueModePicker
            state={queueModesState}
            onSelectSteeringMode={handleSelectSteeringMode}
            onSelectFollowUpMode={handleSelectFollowUpMode}
            testId={`${composerTestId}-queue-mode`}
          />
          <TurnStatusBanner state={turnStatusState} testId={`${composerTestId}-turn-status`} />
          {attachmentPermissionState !== null ? (
            <PermissionRecoveryNotice
              kind="photos"
              state={attachmentPermissionState}
              onRequest={handleRequestAttachmentPermission}
              onOpenSettings={openSystemSettings}
              onDismiss={handleDismissAttachmentNotice}
              testId={`${composerTestId}-attachment-permission-notice`}
            />
          ) : null}
          {micPermissionState !== null ? (
            <PermissionRecoveryNotice
              kind="microphone"
              state={micPermissionState}
              onRequest={handleRequestMicPermission}
              onOpenSettings={openSystemSettings}
              onDismiss={handleDismissMicNotice}
              testId={`${composerTestId}-mic-permission-notice`}
            />
          ) : null}
          {capturePermissionState !== null ? (
            <PermissionRecoveryNotice
              kind="photo-capture"
              state={capturePermissionState}
              onRequest={handleRequestCapturePermission}
              onOpenSettings={openSystemSettings}
              onDismiss={handleDismissCaptureNotice}
              testId={`${composerTestId}-capture-permission-notice`}
            />
          ) : null}
          {/* T70: a value of the voice-entry kind — this row is the only
            place a capture-in-progress or its outcome ever becomes
            visible, so it renders whenever there is anything to say and
            stays gone otherwise (no clutter on an app that never
            presses the mic). */}
          {voiceStatusDisplay !== null ? (
            <View style={styles.turnControlsRow} testID={`${composerTestId}-voice-status`}>
              {voiceStatusDisplay.kind === "indicator" ? (
                <VoiceCaptureIndicator
                  status={voiceStatusDisplay.status}
                  testId={`${composerTestId}-voice-status-indicator`}
                />
              ) : (
                <StatusIndicator
                  label="Voice"
                  tone={voiceStatusDisplay.tone}
                  statusText={voiceStatusDisplay.text}
                  testId={`${composerTestId}-voice-status-indicator`}
                />
              )}
              {voiceState.status === "recording" ? (
                <Button
                  kind="danger"
                  label="Cancel recording"
                  onPress={handleVoiceCancel}
                  testId={`${composerTestId}-voice-cancel`}
                />
              ) : null}
            </View>
          ) : null}
          {state.turnRunning ? (
            <>
              <View
                style={styles.queueStatusRow}
                testID={`${composerTestId}-queue-status`}
                accessibilityLiveRegion="polite"
                accessibilityLabel={describeQueueStatus(state)}
              >
                <StatusIndicator
                  label="Queue"
                  tone={queueDepth(state).total > 0 ? "info" : "neutral"}
                  statusText={queueDepthLabel(queueDepth(state))}
                  testId={`${composerTestId}-queue-depth`}
                />
                <Select
                  label={QUEUE_MODE_LABEL}
                  options={DISPATCH_MODE_OPTIONS}
                  value={state.mode}
                  onValueChange={(value) => handleModeChange(value as QueueDispatchMode)}
                  testId={`${composerTestId}-queue-mode`}
                />
              </View>
              <View style={styles.turnControlsRow} testID={`${composerTestId}-turn-controls`}>
                <Button
                  kind="secondary"
                  label={STEER_ACTION_LABEL}
                  disabled={!canSteerDraft(state)}
                  onPress={handleSteer}
                  testId={`${composerTestId}-steer`}
                />
                <Button
                  kind="secondary"
                  label={FOLLOW_UP_ACTION_LABEL}
                  disabled={!canFollowUpDraft(state)}
                  onPress={handleFollowUp}
                  testId={`${composerTestId}-follow-up`}
                />
                <Button
                  kind="danger"
                  label={ABORT_ACTION_LABEL}
                  disabled={!canAbort(state)}
                  onPress={handleAbort}
                  testId={`${composerTestId}-abort`}
                />
              </View>
            </>
          ) : null}
          <SlashCommandPicker
            state={slashCommandsState}
            onSelect={handleSelectSlashCommand}
            onDismiss={handleDismissSlashCommands}
            testId={`${composerTestId}-commands-picker`}
          />
        </ScrollView>
        <PromptBar
          label={COMPOSER_INPUT_LABEL}
          placeholder={placeholder ?? "Message"}
          value={state.draft}
          canSend={
            canSubmitDraft(state.draft) &&
            !state.turnRunning &&
            !attachmentsHavePendingUploads(attachmentsState)
          }
          queuedCount={pendingCount(state)}
          onValueChange={handleValueChange}
          onSend={handleSend}
          testId={composerTestId}
        />
      </Section>
    </View>
  );
}

function ComposerEntryRow({
  entry,
  onRetry,
  testId,
}: {
  entry: ComposerEntry;
  onRetry: (id: string) => void;
  testId: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Deliberately not wrapped in an `accessible` View: that would collapse
  // every child (including the failed-state Retry button) into a single
  // TalkBack node, making the button unreachable on its own. Each piece
  // below is its own accessible element instead.
  return (
    <View style={styles.entryRow} testID={testId}>
      <View style={styles.entryTextColumn}>
        <Text style={styles.entryText} numberOfLines={2}>
          {entry.text}
        </Text>
        {/* T33B7: "An attachment uploads and appears on the message" — every attachment carried by this entry (`handleSend`'s `submitDraft` + attach step) is named here, next to the entry's own text. */}
        {entry.attachments && entry.attachments.length > 0 ? (
          <Text style={styles.entryAttachments} testID={`${testId}-attachments`}>
            {entry.attachments.map((attachment) => attachment.fileName).join(", ")}
          </Text>
        ) : null}
      </View>
      <Chip label={entryStatusLabel(entry.status)} tone={TONE_BY_STATUS[entry.status]} />
      {entry.status === "failed" ? (
        <Button
          kind="secondary"
          label="Retry"
          onPress={() => onRetry(entry.id)}
          testId={`${testId}-retry`}
        />
      ) : null}
    </View>
  );
}
/**
 * T278: one staged attachment row. Renders an image THUMBNAIL when
 * `attachment.previewUri` is set (image types only —
 * `attachment-model.ts`'s `stageAttachment` is what enforces that, not
 * this component); every other type keeps the plain name/size/remove
 * chip this row always rendered — **no preview for non-image types, by
 * decision** (see `attachment-model.ts`'s "T278: the preview channel"
 * doc comment for the full argument). `formatAttachmentBytes(
 * attachment.size)` is shown for a non-image entry so the chip still
 * carries the one extra fact a thumbnail would otherwise have implied
 * (roughly how big the file is) — an image entry omits it since the
 * thumbnail itself is the size-relevant signal a user actually wants
 * (what it looks like), matching `D:\beautiful-ui`'s own attachment
 * chip, which never prints a byte count either.
 *
 * Entrance uses the same Reanimated fade/scale-up `Toast.tsx` already
 * uses (`motion.duration.moderate` + `motion.easing.easeOutStrong`,
 * `[0.23, 1, 0.32, 1]`) — this IS `D:\beautiful-ui\components\
 * primitives\PromptBar.tsx`'s `.att`-chip entrance
 * (`animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both"`,
 * `opacity 0→1` + `scale(0.95)→scale(1)`), reimplemented with
 * `react-native-reanimated` since there is no CSS `@keyframes` on
 * native.
 */
function StagedAttachmentRow({
  attachment,
  onRemove,
  testId,
}: {
  attachment: StagedAttachment;
  onRemove: (id: string) => void;
  testId: string;
}) {
  const { theme, motion } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const tone: ChipTone =
    attachment.status === "uploaded"
      ? "success"
      : attachment.status === "error"
        ? "danger"
        : "info";

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, {
      duration: motion.duration.moderate,
      easing: Easing.bezier(...motion.easing.easeOutStrong),
    });
    // Runs once per mounted row — a staged attachment's identity (its
    // `id`) never changes underneath this component, so there is
    // nothing to re-trigger the entrance for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.95 + 0.05 * progress.value }],
  }));

  const remove = (
    <Button
      kind="secondary"
      label="Remove"
      onPress={() => onRemove(attachment.id)}
      testId={`${testId}-remove`}
    />
  );
  const errorText =
    attachment.status === "error" && attachment.error ? (
      <Text style={styles.entryAttachments}>{attachment.error}</Text>
    ) : null;

  if (attachment.previewUri) {
    return (
      <Animated.View style={[styles.entryRow, animatedStyle]} testID={testId}>
        <Image
          source={{ uri: attachment.previewUri }}
          style={styles.thumbnail}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={`${testId}-thumbnail`}
        />
        <View style={styles.entryTextColumn}>
          <Text style={styles.entryText} numberOfLines={1}>
            {attachment.name}
          </Text>
          {errorText}
        </View>
        <Chip label={attachmentStatusLabel(attachment.status)} tone={tone} />
        {remove}
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.entryRow, animatedStyle]} testID={testId}>
      <View style={styles.entryTextColumn}>
        <Text style={styles.entryText} numberOfLines={1}>
          {attachment.name}
        </Text>
        <Text style={styles.entryAttachments}>{formatAttachmentBytes(attachment.size)}</Text>
        {errorText}
      </View>
      <Chip label={attachmentStatusLabel(attachment.status)} tone={tone} />
      {remove}
    </Animated.View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    // T33B4 / plan.md §9.3: never shrink to make room for a sheet or the
    // IME — see `composer-focus-model.ts`'s `COMPOSER_LAYOUT_CONTRACT`
    // (`reservesOwnHeight`) and this file's doc comment.
    // T338: root, section and scroll all give way; the prompt bar (outside
    // the ScrollView, default `flexShrink: 0`) does not.
    root: { flexShrink: 1, minHeight: 0 },
    section: { flexShrink: 1, minHeight: 0 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { gap: theme.spacing[3] },
    entries: { gap: theme.spacing[2], marginBottom: theme.spacing[2] },
    entryRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingVertical: theme.spacing[1],
    },
    entryTextColumn: { flex: 1, gap: theme.spacing[1] },
    // T278: the image-thumbnail chip — `radii.chip` matches
    // `D:\beautiful-ui`'s `rounded-chip` attachment-chip radius.
    thumbnail: {
      width: 40,
      height: 40,
      borderRadius: theme.radii.chip,
      backgroundColor: theme.colors.inset,
    },
    entryText: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    entryAttachments: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    actionsRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.spacing[2],
      marginBottom: theme.spacing[2],
    },
    attachmentLimits: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    turnControlsRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.spacing[2],
      marginBottom: theme.spacing[2],
    },
    queueStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.spacing[2],
      marginBottom: theme.spacing[2],
    },
  });
}

export default Composer;
