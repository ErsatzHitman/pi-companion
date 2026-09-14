import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { composer as coreComposer } from "@picompanion/frontend-core";
import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";

import {
  Button,
  Chip,
  ChipGroup,
  IconButton,
  Popover,
  Sheet,
  StatusIndicator,
} from "../../ui/primitives/index.js";
import type { ChipTone } from "../../ui/primitives/index.js";
import { CommandSearch, PromptBar } from "../../ui/recipes/index.js";
import type { CommandSearchItem } from "../../ui/recipes/index.js";
import type { AgentSlashCommand, PromptStreamingBehavior } from "./agent-turn-client.js";
import "./composer.css";
import { ContextRing } from "./ContextRing.js";
import type { DaemonEditorTextSource } from "./daemon-editor-text-client.js";
import { wireEditorTextResponder } from "./daemon-editor-text-client.js";
import { ModelThinkingPicker } from "./ModelThinkingPicker.js";
import { PromptRoutingPicker } from "./PromptRoutingPicker.js";
import { QueueModePicker } from "./QueueModePicker.js";
import { ReferenceSuggestions } from "./ReferenceSuggestions.js";
import { ContextMeter } from "../rail/context-meter.js";
import type { DaemonSessionCostClient } from "../telemetry/daemon-session-cost-client.js";
import { SessionCostMeterContainer } from "../telemetry/SessionCostMeterContainer.js";
import type { UseComposerOptions } from "./use-composer.js";
import { useComposer } from "./use-composer.js";
import { useAgentTurnStatus } from "./use-agent-turn-status.js";
import { useComposerReferences } from "./use-composer-references.js";
import type { ComposerAttachment } from "./use-attachments.js";
import { formatAttachmentSize } from "./use-attachments.js";
import { useComposerPaste } from "./use-clipboard-paste.js";
import { useDragAndDrop } from "./use-drag-and-drop.js";
import type { ModelThinkingState } from "./use-model-thinking.js";
import { useModelThinking } from "./use-model-thinking.js";
import type { QueueModesState } from "./use-queue-modes.js";
import { useQueueModes } from "./use-queue-modes.js";
import { useSlashCommands } from "./use-slash-commands.js";
import type { VoiceTranscriptionClient } from "./voice-transcribe-client.js";

/** Text summary of the live queue (T28B3): depth and its steer/follow-up split, never colour alone. */
function describeQueue(steeringCount: number, followUpCount: number): string {
  if (steeringCount === 0 && followUpCount === 0) return "Queue empty";
  const parts: string[] = [];
  if (steeringCount > 0) {
    parts.push(`${steeringCount} to steer`);
  }
  if (followUpCount > 0) {
    parts.push(`${followUpCount} to follow up`);
  }
  const total = steeringCount + followUpCount;
  return `${total} queued (${parts.join(", ")})`;
}

/**
 * The composer footer's state sentence (the mockup's `.composer-foot`
 * left-hand `Steering — this goes to the turn already running`).
 *
 * It reads straight off the same per-message routing control T38B1b
 * already ships: an explicit Steer/Follow-up choice names exactly what
 * that submission will do, and the un-chosen default describes the
 * daemon's own turn-state-derived behaviour ("a message while a turn is
 * already producing output steers it, while sending one before the turn
 * has started queues a follow-up" — `agent-turn-client.ts`'s header
 * comment). Auto does not claim to know which of the two is about to
 * happen: the composer has no live turn-state signal to read, and a
 * sentence that guessed would be wrong half the time.
 */
function describeRouting(routing: PromptStreamingBehavior | null): string {
  if (routing === "steer") return "Steering — this goes to the turn already running";
  if (routing === "followUp") return "Follow-up — sent once the running turn finishes";
  return "Auto — steers the turn in flight, or starts a new one when idle";
}

/**
 * Compact metadata-chip labels (T388). Each is a short, glanceable
 * summary of what its popover holds — never a substitute for the full
 * picker (which still carries every explained-unavailable state), just
 * the collapsed value shown without opening anything, matching the
 * mockup's `.chip` treatment.
 */
function describeModelChipLabel(state: ModelThinkingState): string {
  if (state.availability === "no-client" || state.availability === "unsupported") {
    return "Model — unavailable";
  }
  if (state.availability === "loading") return "Model — loading…";
  if (state.availability === "error") return "Model — error";
  const model = state.models.find((option) => option.id === state.modelId);
  const modelName = model?.label ?? state.modelId ?? "None";
  const effectiveId = state.thinkingOptionId ?? state.effectiveThinkingOptionId;
  const thinking = state.thinkingOptions.find((option) => option.id === effectiveId);
  return thinking ? `${modelName} · ${thinking.label}` : modelName;
}

function describeRoutingChipLabel(routing: PromptStreamingBehavior | null): string {
  if (routing === "steer") return "Routing: Steer";
  if (routing === "followUp") return "Routing: Follow-up";
  return "Routing: Auto";
}

/** `QueueMode` -> short label. A plain string parameter (not the `QueueMode` type) so this needs no extra type-only import. */
function queueModeChipLabel(mode: string | null): string {
  if (mode === "all") return "All";
  if (mode === "one-at-a-time") return "One at a time";
  return mode ?? "—";
}

function describeQueueChipLabel(state: QueueModesState): string {
  if (state.availability === "no-client" || state.availability === "unsupported") {
    return "Queue — unavailable";
  }
  if (state.availability === "loading") return "Queue — loading…";
  if (state.availability === "error") return "Queue — error";
  return `Queue: ${queueModeChipLabel(state.steeringMode)} steer · ${queueModeChipLabel(state.followUpMode)} follow-up`;
}

/** The ring's Sheet body (T388): the same known/unknown split `ContextRing` itself draws, in words. */
function describeContextSummary(
  telemetry: coreTelemetry.ContextWindowTelemetry | undefined,
): string {
  const contextWindow = telemetry?.contextWindow;
  if (contextWindow?.status !== "known")
    return "Context usage has not been reported for this session yet.";
  const percent = Math.round(contextWindow.usedFraction * 100);
  return `${percent}% of context used (${contextWindow.usedTokens.toLocaleString()} of ${contextWindow.maxTokens.toLocaleString()} tokens).`;
}

/**
 * UI-W12: the literal chat text the Context group's "Compact now" row
 * (below) sends. There is no manual-compaction RPC on the wire to call
 * instead: `compact` is one of Pi's 32 RPC commands plan.md §11.1 lists,
 * but `apps/web/src/features/sessions/rpc-command-web-parity.ts`'s own
 * `"compact"` entry — a live command-parity ledger, not a reference-only
 * doc — records the grep-verified fact grounding this: no `compact`-shaped
 * request literal exists anywhere in `packages/protocol/src/messages.ts`,
 * only the observational `compaction` timeline-entry type and
 * `compaction_start`/`compaction_end` events. The only real path to a
 * manual compaction is sending this string as ordinary chat text, exactly
 * as if a user had typed it and pressed Enter — so the row reuses
 * `useComposer`'s own `submit()` (via `setDraftText` plus the effect
 * below) rather than a fabricated client method.
 */
const COMPACT_NOW_TEXT = "/compact";

/**
 * Why the "Compact now" row can't send right now, or `null` when it can.
 * Mirrors `useComposer`'s own `canSend` gating — a live client, no
 * submission already in flight, no attachment upload still pending — minus
 * its "there is text to send" clause, since this row supplies its own text
 * (`COMPACT_NOW_TEXT` above) rather than reading the draft. Always read
 * into visible text on the row itself: a `disabled` row with no reason
 * shown would be the "colour/attribute alone" failure plan.md §10.5
 * forbids, and a press that silently did nothing would be worse.
 */
function describeCompactNowUnavailable(
  hasClient: boolean,
  isSubmitting: boolean,
  hasPendingUploads: boolean,
): string | null {
  if (!hasClient) return "Connect to a session to send /compact.";
  if (isSubmitting) return "Wait for the current message to finish sending.";
  if (hasPendingUploads) return "Wait for attachments to finish uploading.";
  return null;
}

export interface ComposerProps extends UseComposerOptions {
  /** Accessible label for the input; also its visible-on-focus hint text. */
  label?: string;
  placeholder?: string;
  testId?: string;
  /**
   * T293: real `DaemonClient` wiring for Pi's `getEditorText`/
   * `pasteToEditor` tier-2 read bridge (plan.md §4.2). Separate from
   * `client` (`AgentTurnClient`, a narrower turn-control interface) since
   * this needs `on(...)`/`respondToEditorText` instead. `undefined` — no
   * live daemon connection, the same "no live client yet" seam every
   * other daemon-backed feature in this file already uses — leaves the
   * composer working exactly as it does today, with nothing answering a
   * `getEditorText` extension call (the extension's own bounded timeout
   * on the daemon side covers that, same as a second, unanswered client).
   */
  editorTextClient?: DaemonEditorTextSource;
  /**
   * This session's derived context-window telemetry, from
   * `useSessionContextTelemetry`. The ring's own sheet is now the only
   * place `ContextMeter` renders: UI-W9 removed `routes/root-route.tsx`'s
   * direct mount beside `PiExtensionRail`, because the reference `.live`
   * region (`docs/ui-reference/pi-companion-web.html`) carries no
   * Context/Cache/Cost block at all — that readout belongs to the ring.
   * Omit when no usage has been reported and the ring renders its honest
   * "not reported" state rather than a fabricated 0%.
   */
  contextTelemetry?: coreTelemetry.ContextWindowTelemetry;
  /**
   * Live `DaemonSessionCostClient` for the session-cost readout mounted
   * in the same sheet, directly after `ContextMeter` (UI-W11).
   * `SessionCostMeterContainer`'s own doc (`features/telemetry/
   * SessionCostMeterContainer.tsx`) names this composer sheet as exactly
   * where it is "ready to mount" — this is that mount. `undefined` — no
   * live connection yet, the same "no live client yet" seam every other
   * daemon-backed prop on this component already uses — leaves the
   * meter in `SessionCostStore`'s own honest "not priced yet" state,
   * never a fabricated `$0.00`. A real `DaemonClient` satisfies this
   * interface structurally (that container's own doc), so
   * `routes/screens/host-session-screen.tsx` passes its raw `client`
   * here directly, the same way it already does for `editorTextClient`.
   */
  sessionCostClient?: DaemonSessionCostClient;
  /**
   * `@file` candidate listing (T389). The route supplies this from the
   * daemon's existing `listDirectory` when a connection exists. Omit it and
   * `@` still completes skills (which come from the same `listCommands` the
   * slash palette already uses) — file suggestions are simply absent, never
   * invented.
   */
  fileReferenceSource?: coreComposer.ReferenceFileSource;
  /**
   * Voice transcription client (T277 web close, plan.md §9.4). The route
   * resolves this from the live `DaemonClient` via
   * `resolveTranscribeClient` (the web equivalent of Android's T282
   * pattern); `undefined` — no live connection — is the honest
   * "transcription-unavailable" seam a future mic control will read.
   * Accepted today so the wiring lands before the button does; no mic
   * affordance reads it yet (see this file's "no mic/dictate control"
   * note), so omitting it changes nothing visible.
   */
  transcribeClient?: VoiceTranscriptionClient;
}

/** `ComposerAttachment.status` -> `Chip` tone (T28B6): status is always paired with visible text too, never colour alone (plan.md §10.5). */
function attachmentTone(status: ComposerAttachment["status"]): ChipTone {
  if (status === "error") return "danger";
  if (status === "uploaded") return "success";
  return "info";
}

/** Visible chip text for a staged attachment (T28B6): always names the file, its size, and its current status in words. */
function attachmentLabel(attachment: ComposerAttachment): string {
  const size = formatAttachmentSize(attachment.size);
  if (attachment.status === "uploading") return `${attachment.name} — ${size} — uploading\u2026`;
  if (attachment.status === "error") return `${attachment.name} — ${size} — failed`;
  return `${attachment.name} — ${size}`;
}

/** `AgentSlashCommand` -> `CommandSearchItem` (T28B4): the recipe's own generic shape, filled from live daemon data. */
function toCommandSearchItem(command: AgentSlashCommand): CommandSearchItem {
  const description = command.argumentHint
    ? `${command.description} ${command.argumentHint}`
    : command.description;
  return {
    id: command.name,
    label: `/${command.name}`,
    hint: command.kind === "skill" ? `${description} \u00b7 skill` : description,
  };
}

/**
 * The message composer (T28B1, T28B2): `PromptBar` (plan.md §10.4) wired
 * to `useComposer` so a prompt submits through core (outbox enqueue,
 * then — once a `client` is wired — the actual daemon round trip) and
 * appears optimistically in the transcript view model.
 *
 * Composes existing pieces rather than forking them (plan.md §10):
 * `PromptBar` already supplies the labelled `<textarea>`, the
 * Enter-to-send / Shift+Enter-for-newline / Escape-to-interrupt keyboard
 * contract, the attach and context slots and the visible footer; the
 * `IconButton` primitive supplies the Stop control's native keyboard
 * operation and `disabled` state; and `StatusIndicator` pairs any
 * send/abort problem with visible text, not colour alone (plan.md §10.5).
 *
 * **Prompt-row layout (T386 fidelity work).** The row itself is the
 * mockup's `.prompt`: attach `+`, the context ring, the mono textarea and
 * the accent send control on one raised surface. There is no mic/dictate
 * control: the mockup draws one, but web has no real dictation path, and
 * a dead button is worse than a missing one — the same call
 * `use-drag-and-drop.ts`'s own docs make for capabilities that are not
 * really there.
 *
 * **The metadata row (T388, superseding T386's ring-opens-the-menu
 * design).** Model/effort, per-message routing, and the session-wide
 * queue-delivery mode are no longer inside the context ring's popover —
 * the ring now opens only a context-usage summary. Instead they render
 * as three compact chips (the mockup's `.chip`) on ONE metadata row
 * directly under the prompt row, immediately after the state sentence:
 * `state sentence · [Model] [Routing] [Queue] · keyboard hint · Stop`.
 * `PromptBar` owns that single foot row already (`.pc-prompt-bar__foot`),
 * so this component fills it through `PromptBar`'s `metaChips`/`footEnd`
 * slots rather than rendering a second row of its own — there is exactly
 * one foot row in the DOM. Each chip is a real button
 * (`aria-haspopup`/`aria-expanded`, via the unmodified `Popover`
 * primitive) opening the SAME picker component T386 mounted in the
 * sheet — `ModelThinkingPicker`, `PromptRoutingPicker`, `QueueModePicker`
 * — unchanged, just re-anchored. The chip's own visible text
 * (`describeModelChipLabel`/`describeRoutingChipLabel`/
 * `describeQueueChipLabel` below) is a live, collapsed summary of
 * whatever that picker currently reports, including its own explained
 * unavailable/loading/error states — never a static label.
 *
 * "Stop" (T28B2) is a second, distinctly-labelled control from "Send" —
 * cancelling the agent's active turn rather than submitting the draft —
 * so it is a separate icon-only control in the metadata row rather than
 * replacing Send's label while a turn runs (plan.md §12.2/§12.3 keep
 * those two actions separate; the daemon, not this button, decides
 * whether a submission made while a turn is active becomes a steer or a
 * queued follow-up). It renders only while there is something for it to
 * do — a wired client, whether or not an abort is already in flight —
 * rather than sitting permanently in the row, disabled, when there is no
 * turn to interrupt at all.
 *
 * Queue depth and mode (T28B3): `PromptBar`'s existing `queuedCount`
 * counter now reflects the live queue (`useComposer`'s `queueDepth`),
 * and a `StatusIndicator` spells out depth and its steer/follow-up split
 * in text (plan.md §10.5: never colour alone) whenever the daemon's own
 * live `pi_queue_update` reports one — the daemon decides steer vs.
 * follow-up (`agent-turn-client.ts`), so this is a display of that
 * decision, not a client-side control over it. This is a different thing
 * from the Queue chip above: the chip summarises the session-wide
 * *delivery mode* `QueueModePicker` edits, this status line is the live
 * *contents* of the queue right now.
 *
 * Slash-command completion (T28B4): typing "/" as the entire draft opens
 * the `CommandSearch` recipe (plan.md §10.4) filled with the daemon's
 * own `listCommands` result (`use-slash-commands.ts`) — never a
 * hard-coded set. There is no separate "Commands" toggle button: the
 * auto-open trigger (`useSlashCommands`'s `isBareSlashPrefix`) already
 * covers discoverability, and `useSlashCommands.open()` remains available
 * to a future affordance without this component needing a dedicated
 * button for it today. `CommandSearch` already supplies its own full
 * keyboard contract (ArrowUp/ArrowDown to move, Enter to choose, Escape
 * to dismiss) as a labelled combobox/listbox pair, so this component
 * only wires selection (inserting `/name ` into the draft and
 * refocusing the message textarea) and dismissal into it, rather than
 * forking it. Because `useComposer.submit` sends whatever text is in the
 * draft verbatim, an unrecognized slash command — whether typed past the
 * palette or left over after Escape — submits as ordinary text rather
 * than being rejected client-side.
 *
 * Model/thinking pickers (T28B5, plan.md §11.1 "model and reasoning"):
 * `ModelThinkingPicker` composes two `Select` primitives fed by
 * `useModelThinking`, mounted inside the Model chip's popover. Reads and
 * changes go through the same optional-method seam on `client` that
 * `onQueueUpdate`/`listCommands` already use — a client that omits the
 * four model/thinking methods leaves the picker in its own explained
 * "unsupported" state rather than erroring.
 *
 * Steer/follow-up mode control (T38B1a, plan.md §11.1 "queues and
 * automation"): `QueueModePicker` composes two more `Select` primitives
 * fed by `useQueueModes`, mounted inside the Queue chip's popover. This
 * is the session-wide *mode* (deliver several queued messages together,
 * or one at a time) — distinct from which queue a single message enters
 * in the first place; `QueueModePicker`'s own copy states that
 * distinction directly, since the two are easy to conflate.
 *
 * T110 gave every real `DaemonClient` all three `useQueueModes` methods,
 * so `"unsupported"` is reachable — and still tested — only for a turn
 * client that omits the trio; it is not what a real session shows.
 *
 * Per-message steer/follow-up routing (T38B1b): `PromptRoutingPicker`,
 * mounted inside the Routing chip's popover, is the actual per-message
 * choice — plain local state (`useComposer`'s
 * `promptRouting`/`setPromptRouting`) that rides along on the *next*
 * `submit()` call as `SendAgentMessageOptions.streamingBehavior`, then
 * resets to its "Auto" default once that submission consumes it. See
 * `PromptRoutingPicker.tsx` and `use-composer.ts`'s own doc comments for
 * the full contract and for exactly how this differs from
 * `QueueModePicker` above it.
 *
 * Attachments (T28B6, plan.md §12.4, §7.3): an "Attach files" `Button`
 * opens the platform-neutral `FilePicker` (never a raw DOM file input
 * inside this component — see `use-attachments.ts`'s doc comment), and
 * every selected file uploads immediately through `client.uploadFile`,
 * reporting upload/error/uploaded status per file as a `Chip` — tone
 * *and* a visible status word together, never colour alone (plan.md
 * §10.5). `submit()` (in `use-composer.ts`) is what actually attaches
 * the resulting refs to the outbox entry and the daemon message once
 * every staged upload settles.
 *
 * Drag-and-drop, paste, and inline previews (T279): the file dialog
 * above is one of four ways a file reaches this composer, and all four
 * route through `useAttachments.addFiles` (the file dialog's
 * `pickAndAddFiles` is defined in terms of it) — one acceptance path, so
 * a dropped or pasted 200 MB file hits the exact same ceiling a picked
 * one does. `useDragAndDrop`'s `dropZoneHandlers` are spread onto this
 * component's own wrapper (not `window`), and its `isDraggingOver` drives
 * a highlight that is quiet until a drag is actually over the target —
 * see that hook's own doc comment for how a drop outside the target is
 * still kept from navigating the tab away. `useComposerPaste`'s
 * `handlePaste` is wired onto the same wrapper rather than the
 * `<textarea>` itself: a DOM `paste` event bubbles, so this still fires
 * for a paste inside `PromptBar`'s input without this component reaching
 * into that recipe to add an `onPaste` prop. See that hook's own doc
 * comment for the argued pasted-link rule. An image attachment's
 * `previewUrl` (set by `useAttachments` once its `URL.createObjectURL`
 * preview is ready) renders as a small thumbnail beside its chip.
 */
export function Composer({
  label = "Message Pi",
  // T386: the reference's own placeholder for this field
  // (`.prompt textarea::placeholder`).
  placeholder = "Ask, or steer the turn in flight…",
  testId,
  editorTextClient,
  contextTelemetry,
  sessionCostClient,
  fileReferenceSource,
  ...composerOptions
}: ComposerProps) {
  const {
    draftText,
    canSend,
    setDraftText,
    submit,
    isSubmitting,
    isAborting,
    canAbort,
    abort,
    sendError,
    abortError,
    queueUpdate,
    queueDepth,
    attachments,
    promptRouting,
    setPromptRouting,
  } = useComposer(composerOptions);

  const slashCommands = useSlashCommands({
    sessionId: composerOptions.sessionId,
    client: composerOptions.client,
    draftText,
  });

  const modelThinking = useModelThinking({
    sessionId: composerOptions.sessionId,
    client: composerOptions.client,
  });

  const queueModes = useQueueModes({
    sessionId: composerOptions.sessionId,
    client: composerOptions.client,
  });

  // FIX-L2: the composer's Stop control needs to know not just that a
  // client is wired (`canAbort` below), but that a turn is genuinely in
  // progress right now — see `use-agent-turn-status.ts`'s own doc comment
  // for the live-idle-session defect this closes.
  const agentTurnStatus = useAgentTurnStatus({
    sessionId: composerOptions.sessionId,
    client: composerOptions.client,
  });

  const dragAndDrop = useDragAndDrop({ onFiles: attachments.addFiles });
  const handlePaste = useComposerPaste({
    onFiles: attachments.addFiles,
    now: () => composerOptions.clock.now(),
  });

  // T389: the caret offset the `@` token search runs from, plus a queued
  // caret position applied after a chosen reference rewrites the draft.
  const [caretIndex, setCaretIndex] = useState(0);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);

  // Skills are the `skill` entries of the same `listCommands` result the
  // slash palette already uses — no second daemon round trip, and no
  // invented names when the daemon reports none.
  const skillCandidates = useMemo<coreComposer.ReferenceCandidate[]>(
    () =>
      slashCommands.commands
        .filter((command) => command.kind === "skill")
        .map((command) => ({
          kind: "skill",
          id: command.name,
          label: `@${command.name}`,
          description: command.description,
        })),
    [slashCommands.commands],
  );

  const references = useComposerReferences({
    draftText,
    caret: caretIndex,
    files: fileReferenceSource,
    skills: skillCandidates,
  });

  const wrapperRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  /** Whether the context ring's session-controls sheet is showing. */
  const [controlsOpen, setControlsOpen] = useState(false);
  /**
   * FIX-W9: the most recent Compact-now send's failure, once it has
   * escaped `submit()`'s (`use-composer.ts`) own internal catch around
   * `client.sendAgentMessage` — an `outbox.enqueue` /
   * `draftController.clear()` / `markSending` rejection, none of which
   * `submit()` catches itself. `useComposer`'s own `sendError` cannot
   * report this (it is set only inside that internal catch, and exposes
   * no setter this component could call instead), so this is a second,
   * narrower status line rather than a value routed into that one.
   */
  const [compactSendError, setCompactSendError] = useState<string | null>(null);

  // T293: mirrors the live draft into a ref rather than re-wiring on every
  // keystroke — `wireEditorTextResponder` reads `draftTextRef.current`
  // fresh each time a request actually arrives, so the effect below only
  // needs to re-run when the daemon connection or session identity
  // changes, not on every character typed.
  const draftTextRef = useRef(draftText);
  useEffect(() => {
    draftTextRef.current = draftText;
  }, [draftText]);

  useEffect(() => {
    if (!editorTextClient) {
      return;
    }
    return wireEditorTextResponder(editorTextClient, {
      agentId: composerOptions.sessionId,
      getDraftText: () => draftTextRef.current,
    });
  }, [editorTextClient, composerOptions.sessionId]);

  function focusMessageInput(): void {
    wrapperRef.current?.querySelector<HTMLTextAreaElement>(".pc-prompt-bar__input")?.focus();
  }

  // Applies a caret position queued by a reference insertion, after React
  // has committed the rewritten draft value.
  useEffect(() => {
    if (pendingCaret === null) return;
    const input = wrapperRef.current?.querySelector<HTMLTextAreaElement>(".pc-prompt-bar__input");
    if (input) {
      input.focus();
      input.setSelectionRange(pendingCaret, pendingCaret);
    }
    setPendingCaret(null);
  }, [pendingCaret, draftText]);

  /** Reads the textarea's caret offset from any bubbling form event. */
  function readCaret(target: EventTarget | null): number | null {
    const element = target as HTMLTextAreaElement | null;
    return typeof element?.selectionStart === "number" ? element.selectionStart : null;
  }

  function handleComposerChangeCapture(event: React.FormEvent<HTMLDivElement>): void {
    const caret = readCaret(event.target);
    if (caret !== null) setCaretIndex(caret);
  }

  function handleComposerKeyUp(event: React.KeyboardEvent<HTMLDivElement>): void {
    const caret = readCaret(event.target);
    if (caret !== null) setCaretIndex(caret);
  }

  function applyReferenceInsertion(insertion: coreComposer.ReferenceInsertion | null): void {
    if (insertion === null) return;
    setDraftText(insertion.text);
    setCaretIndex(insertion.caret);
    setPendingCaret(insertion.caret);
  }

  function selectReference(candidate: coreComposer.ReferenceCandidate): void {
    applyReferenceInsertion(references.choose(candidate));
  }

  function removeResolvedReference(reference: coreComposer.ResolvedReference): void {
    const next = coreComposer.removeReference(draftText, reference);
    setDraftText(next.text);
    setCaretIndex(next.caret);
    setPendingCaret(next.caret);
  }

  /**
   * Keyboard contract for the open `@` candidate list (T389). Handled in
   * the capture phase on the composer wrapper so ArrowUp/ArrowDown move the
   * highlight and Enter chooses a candidate *before* `PromptBar`'s own
   * textarea handler can send the message; Escape dismisses the list
   * instead of interrupting the turn, exactly as the slash palette already
   * does.
   */
  function handleReferenceKeyDownCapture(event: KeyboardEvent<HTMLDivElement>): void {
    if (!references.isOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      references.moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      references.moveActive(-1);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      applyReferenceInsertion(references.choose());
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      applyReferenceInsertion(references.choose());
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      references.dismiss();
    }
  }

  // Moves focus into `CommandSearch`'s own combobox input the instant the
  // palette opens (auto-triggered by typing "/" or via the manual
  // "Commands" toggle) so its own ArrowUp/ArrowDown/Enter/Escape keyboard
  // contract is immediately usable, without forking the recipe to accept
  // an `autoFocus` prop.
  useEffect(() => {
    if (!slashCommands.isOpen) return;
    paletteRef.current?.querySelector<HTMLInputElement>(".pc-command-search__input")?.focus();
  }, [slashCommands.isOpen]);

  function selectSlashCommand(item: CommandSearchItem): void {
    setDraftText(`${item.label} `);
    slashCommands.dismiss();
    focusMessageInput();
  }

  // Dismisses the whole palette (not just `CommandSearch`'s own internal
  // listbox-open flag) on Escape, in the capture phase so it runs before
  // `CommandSearch`'s own Escape handling — "dismissal" here means
  // returning focus and control to the message textarea, not merely
  // hiding the option list while the filter input keeps focus.
  function handlePaletteKeyDownCapture(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    slashCommands.dismiss();
    focusMessageInput();
  }

  /**
   * Escape in the prompt bar (the mockup's `Esc interrupt`). With the
   * slash-command palette open this keeps its old meaning — dismiss the
   * palette and return focus to the draft — because a palette is a
   * transient overlay, not a turn. Otherwise it interrupts the running
   * turn through the same `abort()` the `Stop` button already uses, and
   * only when that button could act at all (`canAbort`); a draft is never
   * discarded by it.
   */
  function handlePromptEscape(): void {
    if (slashCommands.isOpen) {
      slashCommands.dismiss();
      focusMessageInput();
      return;
    }
    if (canAbort) {
      void abort();
    }
  }

  /**
   * FIX-W9 (BLOCKER): restores a captured draft only when the textarea is
   * still empty. `submit()` (`use-composer.ts`) clears the draft
   * synchronously but then awaits a real `outbox.enqueue` ->
   * `draftController.clear()` -> `markSending` -> `client.sendAgentMessage`
   * round trip before its returned promise settles, and `PromptBar` never
   * disables the textarea while that is in flight — only the Send button
   * does — so the user is free to type a whole new message during the
   * wait. Restoring unconditionally would silently clobber that newer
   * text with the stale pre-compact draft the instant the compact send
   * lands. `draftTextRef` (the T293 editor-text responder mirror above)
   * reads the LIVE draft as of the most recent commit, not any earlier
   * closure's stale `draftText`, so a keystroke typed after the restore
   * was scheduled is still seen. `setDraftText` (not `setDraftTextState`)
   * so an actual restore also re-persists through the same
   * `draftController.update` an ordinary keystroke uses, not just shown
   * once and lost on reload; when the guard skips the restore, the
   * visible text is already whatever the user typed, and it is already
   * persisted the same way (their own `setDraftText` calls while typing
   * did that), so the persisted and visible drafts agree either way.
   */
  const restoreCapturedDraftIfBoxEmpty = useCallback(
    (restoreText: string | null): void => {
      if (restoreText !== null && draftTextRef.current === "") {
        setDraftText(restoreText);
      }
    },
    [setDraftText],
  );

  // UI-W12 (FIX-W5): a synchronous ref, not React state, carries the "a
  // compact send is queued" flag — plus what draft, if any, to restore once
  // it lands — across the render `setDraftText` below triggers, the same
  // reason `use-composer.ts`'s own `submitLockRef` (FIX-W1) is a ref rather
  // than state. `submit` is recreated each render closed over that
  // render's OWN `draftText` (`use-composer.ts`'s `useCallback` deps), so
  // calling the `submit` already in scope in the same tick as
  // `setDraftText(COMPACT_NOW_TEXT)` would still send whatever text was in
  // the draft before this click, not `COMPACT_NOW_TEXT`. This effect fires
  // after the render that follows that state update — the one where
  // `submit`'s closure actually sees `COMPACT_NOW_TEXT` — and calls it
  // exactly once.
  //
  // `null` means no compact send is pending. `handleCompactNow` below never
  // leaves a stale entry here: the one case that does not reach this
  // effect at all (the draft is already exactly `COMPACT_NOW_TEXT`) submits
  // directly, preserving any already-captured entry (BUG 1, FIX-W5; FIX-W9
  // NIT) — see that function's own doc comment.
  const pendingCompactRef = useRef<{ restoreText: string | null } | null>(null);
  useEffect(() => {
    const pending = pendingCompactRef.current;
    if (!pending || draftText !== COMPACT_NOW_TEXT) return;
    pendingCompactRef.current = null;
    setCompactSendError(null);
    void submit()
      .then(() => {
        // BUG 2 (FIX-W5), gated by FIX-W9: restore the user's own
        // in-progress draft once the compact send is durably enqueued —
        // `submit()`'s `outbox.enqueue` always runs, and settles, before
        // its own returned promise does — rather than silently discarding
        // it, but only when nothing newer has replaced it in the box; see
        // `restoreCapturedDraftIfBoxEmpty`'s own doc comment above.
        restoreCapturedDraftIfBoxEmpty(pending.restoreText);
      })
      .catch((error) => {
        // FIX-W9 (SHOULD-FIX 1): `submit()` only catches a
        // `client.sendAgentMessage` rejection internally; a rejection from
        // `outbox.enqueue`, `draftController.clear()`, or `markSending`
        // escapes it entirely. Because `handleCompactNow` already
        // overwrote the PERSISTED draft with `/compact` before `submit()`
        // ran, leaving this unhandled would lose the user's original
        // message from both the UI and storage behind an unhandled
        // rejection. Restore it the same guarded way a clean settle does,
        // and surface the failure on its own status line
        // (`compactSendError` below) since `useComposer` exposes no
        // setter for its own `sendError` this component could reuse.
        restoreCapturedDraftIfBoxEmpty(pending.restoreText);
        setCompactSendError(error instanceof Error ? error.message : String(error));
      });
  }, [draftText, submit, setDraftText, restoreCapturedDraftIfBoxEmpty]);

  const compactNowUnavailableReason = describeCompactNowUnavailable(
    Boolean(composerOptions.client),
    isSubmitting,
    attachments.hasPendingUploads,
  );

  /**
   * Replaces the current draft with `COMPACT_NOW_TEXT` and lets the effect
   * above submit it once that text has actually landed in state — the same
   * `submit()` a user who typed `/compact` and pressed Enter would
   * trigger, never a second, fabricated send path.
   *
   * FIX-W5 (BUG 1): when `draftText` is *already* exactly `COMPACT_NOW_TEXT`
   * (typed by hand before this row was ever opened), `setDraftText`ing the
   * same value is a no-op — React bails the identical-value update via
   * `Object.is`, no re-render happens, and the effect above would never
   * run, leaving `pendingCompactRef` stuck set for a later, unrelated
   * keystroke that happens to pass through that exact string on its way to
   * something longer (e.g. typing "/compact the last 3 turns please"
   * character by character) — that keystroke's own re-render would then
   * fire the stale effect and auto-submit the truncated command, stealing
   * the rest of the sentence. This case submits directly instead of
   * depending on a state transition that may never happen, and clears the
   * ref itself in the same tick so it can never outlive this click — see
   * FIX-W9's NIT paragraph below for what it now does when a DIFFERENT,
   * earlier click's capture is still sitting there.
   *
   * FIX-W5 (BUG 2): whatever the user had actually typed — if anything,
   * and if it is not itself just `COMPACT_NOW_TEXT` again — is captured
   * before it is overwritten and restored into the draft once the compact
   * send is enqueued (see the effect above), rather than silently
   * discarded. FIX-W9 (BLOCKER) gates that restore on the box still being
   * empty — see `restoreCapturedDraftIfBoxEmpty`'s own doc comment — so a
   * message typed while the compact send was still in flight survives
   * instead of being clobbered by this stale text.
   *
   * FIX-W5 (BUG 3): staged attachments are cleared up front rather than
   * riding along with `/compact`. The daemon has no manual-compaction RPC
   * (`COMPACT_NOW_TEXT`'s own doc comment) — `/compact` travels as plain
   * chat text, and a compaction instruction has no defined use for an
   * uploaded file, so shipping one alongside it would only glue the user's
   * upload to a message that ignores it. This is also the only option
   * actually reachable from this component: `submit()` (`use-composer.ts`,
   * out of this task's ownership) unconditionally attaches whatever is
   * currently staged and then clears it on every submission that proceeds,
   * so the sole way to keep those files off THIS particular send is to
   * clear them before calling `submit()`, not after.
   *
   * FIX-W9 (SHOULD-FIX 2, disclosed rather than fixed): unlike the text
   * above, a cleared attachment has NO restore path — a submission failure
   * loses every staged file one-way, and a file still `"uploading"` at
   * click time is orphaned the same way (`useAttachments.upload()`,
   * `use-attachments.ts`, has no cancellation, so its own in-flight
   * `updateAttachment` call lands on an already-emptied array and quietly
   * no-ops once this runs). This is deliberate, not incidental: restaging
   * an already-uploaded reference, or cancelling/resuming an in-flight
   * one, has no operation on `UseAttachmentsState` (`use-attachments.ts`)
   * to call — the only two ways to add an attachment are a fresh
   * `PickedFile` pick/drop/paste, never an already-uploaded reference —
   * and that file is out of this task's ownership. A failed Compact-now
   * send therefore leaves the user re-picking any file they had staged
   * for it, same as today, while its TEXT (above) does not.
   */
  function handleCompactNow(): void {
    if (compactNowUnavailableReason) return;
    setControlsOpen(false);
    attachments.clear();
    const trimmedDraft = draftText.trim();
    const restoreText =
      trimmedDraft.length > 0 && trimmedDraft !== COMPACT_NOW_TEXT ? draftText : null;
    if (draftText === COMPACT_NOW_TEXT) {
      // FIX-W9 (NIT): a fast second click can land here while an EARLIER
      // click's own captured `restoreText` is still sitting in
      // `pendingCompactRef`, waiting for that click's own effect to run —
      // the draft already reads as `COMPACT_NOW_TEXT` because that earlier
      // click's `setDraftText` call already committed, before its effect
      // got a turn to run. Carry that capture into THIS click's own submit
      // instead of discarding it: null the ref first so the earlier
      // click's effect sees nothing pending and does not also call
      // `submit()` (no duplicate send either way —
      // `use-composer.ts`'s `submitLockRef` is a further backstop), then
      // attach the same restore/error handling the effect above uses,
      // closed over whatever was actually pending. That is `null`,
      // unchanged, for the ordinary BUG-1 case of a draft typed as
      // `/compact` by hand with nothing queued to restore.
      const alreadyPending = pendingCompactRef.current;
      pendingCompactRef.current = null;
      setCompactSendError(null);
      void submit()
        .then(() => {
          restoreCapturedDraftIfBoxEmpty(alreadyPending?.restoreText ?? null);
        })
        .catch((error) => {
          restoreCapturedDraftIfBoxEmpty(alreadyPending?.restoreText ?? null);
          setCompactSendError(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    pendingCompactRef.current = { restoreText };
    setDraftText(COMPACT_NOW_TEXT);
  }

  const statusTestId = testId ? `${testId}-status` : undefined;
  const abortTestId = testId ? `${testId}-abort` : undefined;
  const queueStatusTestId = testId ? `${testId}-queue-status` : undefined;
  const slashCommandsTestId = testId ? `${testId}-slash-commands` : undefined;
  const attachTestId = testId ? `${testId}-attach` : undefined;
  const modelChipTestId = testId ? `${testId}-model-chip` : undefined;
  const routingChipTestId = testId ? `${testId}-routing-chip` : undefined;
  const queueChipTestId = testId ? `${testId}-queue-chip` : undefined;
  const contextSummaryTestId = testId ? `${testId}-context-summary` : undefined;
  // FIX-L2: `canAbort` alone (`use-composer.ts`) is only "a client is
  // wired and no abort is already in flight" — true for the entire
  // lifetime of any live connection, including long after every turn has
  // finished. Showing Stop also requires `agentTurnStatus.hasActiveTurn`,
  // the daemon's own live turn-state signal, so the control disappears
  // once a session goes idle instead of staying enabled forever.
  const showAbort = (canAbort && agentTurnStatus.hasActiveTurn) || isAborting;
  const attachmentsTestId = testId ? `${testId}-attachments` : undefined;
  const dropHintTestId = testId ? `${testId}-drop-hint` : undefined;
  const contextRingTestId = testId ? `${testId}-context-ring` : undefined;
  const controlsSheetTestId = testId ? `${testId}-session-controls` : undefined;
  const compactNowTestId = testId ? `${testId}-compact-now` : undefined;
  const compactErrorTestId = testId ? `${testId}-compact-error` : undefined;
  const footerStateTestId = testId ? `${testId}-foot-state` : undefined;
  const referencesTestId = testId ? `${testId}-references` : undefined;
  const resolvedReferencesTestId = testId ? `${testId}-resolved-references` : undefined;
  const referenceListboxId = useId();
  const composerClassName = dragAndDrop.isDraggingOver
    ? "pc-composer pc-composer--drop-active"
    : "pc-composer";

  return (
    <div
      className={composerClassName}
      ref={wrapperRef}
      onPaste={handlePaste}
      onChangeCapture={handleComposerChangeCapture}
      onKeyUp={handleComposerKeyUp}
      onKeyDownCapture={handleReferenceKeyDownCapture}
      {...dragAndDrop.dropZoneHandlers}
    >
      {dragAndDrop.isDraggingOver ? (
        <div className="pc-composer__drop-hint" data-testid={dropHintTestId} aria-hidden="true">
          Drop to attach
        </div>
      ) : null}
      {references.isOpen ? (
        <ReferenceSuggestions
          listboxId={referenceListboxId}
          items={references.candidates}
          activeIndex={references.activeIndex}
          onSelect={selectReference}
          testId={referencesTestId}
        />
      ) : null}
      <PromptBar
        label={label}
        placeholder={placeholder}
        value={draftText}
        canSend={canSend}
        queuedCount={queueDepth}
        onValueChange={setDraftText}
        onSend={() => {
          void submit();
        }}
        onEscape={handlePromptEscape}
        contextControl={
          <ContextRing
            telemetry={contextTelemetry}
            expanded={controlsOpen}
            onToggle={() => setControlsOpen((open) => !open)}
            testId={contextRingTestId}
          />
        }
        attachControl={
          <button
            type="button"
            className="pc-prompt-bar__attach"
            aria-label="Attach files"
            title="Attach files"
            onClick={() => {
              void attachments.pickAndAddFiles();
            }}
            data-testid={attachTestId}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        }
        footer={<span data-testid={footerStateTestId}>{describeRouting(promptRouting)}</span>}
        metaChips={
          <span className="pc-composer__meta">
            <span className="pc-composer__meta-chip">
              <Popover
                triggerLabel={describeModelChipLabel(modelThinking)}
                testId={modelChipTestId}
              >
                <ModelThinkingPicker
                  state={modelThinking}
                  testId={testId ? `${testId}-model-thinking` : undefined}
                />
              </Popover>
            </span>
            <span className="pc-composer__meta-chip">
              <Popover
                triggerLabel={describeRoutingChipLabel(promptRouting)}
                testId={routingChipTestId}
              >
                <PromptRoutingPicker
                  value={promptRouting}
                  onChange={setPromptRouting}
                  testId={testId ? `${testId}-prompt-routing` : undefined}
                />
              </Popover>
            </span>
            <span className="pc-composer__meta-chip">
              <Popover triggerLabel={describeQueueChipLabel(queueModes)} testId={queueChipTestId}>
                <QueueModePicker
                  state={queueModes}
                  testId={testId ? `${testId}-queue-modes` : undefined}
                />
              </Popover>
            </span>
          </span>
        }
        footEnd={
          showAbort ? (
            <IconButton
              icon="stop"
              accessibleName="Stop"
              className="pc-composer__meta-abort"
              disabled={isAborting}
              onClick={() => {
                void abort();
              }}
              data-testid={abortTestId}
            />
          ) : null
        }
        testId={testId}
      />
      {slashCommands.isOpen ? (
        <div
          className="pc-composer__slash-commands"
          data-testid={slashCommandsTestId}
          ref={paletteRef}
          onKeyDownCapture={handlePaletteKeyDownCapture}
        >
          <CommandSearch
            label="Slash commands"
            placeholder="Filter commands…"
            items={slashCommands.commands.map(toCommandSearchItem)}
            onSelect={selectSlashCommand}
            testId={slashCommandsTestId}
          />
        </div>
      ) : null}
      {attachments.attachments.length > 0 ? (
        <div className="pc-composer__attachments" data-testid={attachmentsTestId}>
          <ChipGroup ariaLabel="Staged attachments">
            {attachments.attachments.map((attachment) => (
              <span className="pc-composer__attachment" key={attachment.id}>
                {attachment.previewUrl ? (
                  <img
                    className="pc-composer__attachment-preview"
                    src={attachment.previewUrl}
                    alt=""
                    data-testid={
                      attachmentsTestId
                        ? `${attachmentsTestId}-${attachment.id}-preview`
                        : undefined
                    }
                  />
                ) : null}
                <Chip
                  label={attachmentLabel(attachment)}
                  tone={attachmentTone(attachment.status)}
                  onRemove={() => attachments.remove(attachment.id)}
                  testId={attachmentsTestId ? `${attachmentsTestId}-${attachment.id}` : undefined}
                />
                {attachment.status === "error" ? (
                  <Button
                    kind="secondary"
                    onClick={() => attachments.retry(attachment.id)}
                    data-testid={
                      attachmentsTestId ? `${attachmentsTestId}-${attachment.id}-retry` : undefined
                    }
                  >
                    Retry
                  </Button>
                ) : null}
              </span>
            ))}
          </ChipGroup>
        </div>
      ) : null}
      {references.resolved.length > 0 ? (
        <div className="pc-composer__resolved-references" data-testid={resolvedReferencesTestId}>
          <ChipGroup ariaLabel="References in the draft">
            {references.resolved.map((reference, index) => (
              <Chip
                key={`${reference.candidate.kind}:${reference.candidate.id}:${reference.start}`}
                label={reference.candidate.label}
                tone="info"
                onRemove={() => removeResolvedReference(reference)}
                testId={
                  resolvedReferencesTestId ? `${resolvedReferencesTestId}-${index}` : undefined
                }
              />
            ))}
          </ChipGroup>
        </div>
      ) : null}
      {isAborting || abortError || sendError ? (
        <div className="pc-composer__status">
          {isAborting ? (
            <StatusIndicator
              label="Turn"
              tone="info"
              statusText="Stopping…"
              testId={statusTestId}
            />
          ) : abortError ? (
            <StatusIndicator
              label="Stop"
              tone="danger"
              statusText={abortError}
              testId={statusTestId}
            />
          ) : sendError ? (
            <StatusIndicator
              label="Send"
              tone="danger"
              statusText={sendError}
              testId={statusTestId}
            />
          ) : null}
        </div>
      ) : null}
      {/* FIX-W9 (SHOULD-FIX 1): a Compact-now failure that escaped
          `submit()`'s own internal catch — an `outbox.enqueue` /
          `draftController.clear()` / `markSending` rejection, never a
          `client.sendAgentMessage` one (that path already sets
          `sendError` above). Its own status line: `useComposer` exposes
          no setter for `sendError` this component could reuse instead. */}
      {compactSendError ? (
        <StatusIndicator
          label="Compact"
          tone="danger"
          statusText={compactSendError}
          testId={compactErrorTestId}
        />
      ) : null}
      {queueDepth > 0 ? (
        <StatusIndicator
          label="Queue"
          tone="info"
          statusText={describeQueue(queueUpdate.steering.length, queueUpdate.followUp.length)}
          testId={queueStatusTestId}
        />
      ) : null}
      <Sheet
        open={controlsOpen}
        title="Session controls"
        description="This session's context-window usage."
        onClose={() => setControlsOpen(false)}
        testId={controlsSheetTestId}
      >
        <div className="pc-composer__session-controls">
          <p data-testid={contextSummaryTestId}>{describeContextSummary(contextTelemetry)}</p>
          {/* UI-W9: the reference `#ctx-menu` popover's own
              final `.menu-g` group is its "Context" readout
              (`docs/ui-reference/pi-companion-web.html`) — the SAME
              `ContextMeter` the right rail used to mount directly now
              renders here instead, off the ring's own `contextTelemetry`
              prop, so the two can never disagree. */}
          {contextTelemetry ? (
            <ContextMeter
              telemetry={contextTelemetry}
              testId={testId ? `${testId}-context-meter` : undefined}
            />
          ) : null}
          {/* UI-W11: the reference `#ctx-menu` group also carries a Cost
              readout — `SessionCostMeterContainer` (`features/telemetry/`)
              mounts directly after `ContextMeter` so the ring's popover
              carries the full context/cost group. Unlike `ContextMeter`
              above, this always mounts (it needs only `sessionId`, not
              `contextTelemetry`) and shows its own honest "not priced
              yet" state whenever there is no live `sessionCostClient` or
              no priced turn — never a fabricated `$0.00`. */}
          <SessionCostMeterContainer
            agentId={composerOptions.sessionId}
            client={sessionCostClient}
            testId={testId ? `${testId}-session-cost-meter` : undefined}
          />
          {/* UI-W12: the reference `#ctx-menu` popover's Context group ends
              with its `.mrow`-styled `#row-compact`
              (`docs/ui-reference/pi-companion-web.html`) — "Compact now"
              sends the literal `COMPACT_NOW_TEXT` chat message through the
              same submit path any typed message takes; see that constant's
              own doc comment above for why there is no RPC to call
              instead. */}
          <button
            type="button"
            className="pc-composer__compact-now"
            onClick={handleCompactNow}
            disabled={compactNowUnavailableReason !== null}
            data-testid={compactNowTestId}
          >
            <span className="pc-composer__compact-now-label">Compact now</span>
            <span className="pc-composer__compact-now-value">
              {compactNowUnavailableReason ?? "Sends /compact as a message"}
            </span>
          </button>
        </div>
      </Sheet>
    </div>
  );
}

export default Composer;
