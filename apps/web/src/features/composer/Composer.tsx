import { useEffect, useId, useMemo, useRef, useState } from "react";
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

  const statusTestId = testId ? `${testId}-status` : undefined;
  const abortTestId = testId ? `${testId}-abort` : undefined;
  const queueStatusTestId = testId ? `${testId}-queue-status` : undefined;
  const slashCommandsTestId = testId ? `${testId}-slash-commands` : undefined;
  const attachTestId = testId ? `${testId}-attach` : undefined;
  const modelChipTestId = testId ? `${testId}-model-chip` : undefined;
  const routingChipTestId = testId ? `${testId}-routing-chip` : undefined;
  const queueChipTestId = testId ? `${testId}-queue-chip` : undefined;
  const contextSummaryTestId = testId ? `${testId}-context-summary` : undefined;
  const showAbort = canAbort || isAborting;
  const attachmentsTestId = testId ? `${testId}-attachments` : undefined;
  const dropHintTestId = testId ? `${testId}-drop-hint` : undefined;
  const contextRingTestId = testId ? `${testId}-context-ring` : undefined;
  const controlsSheetTestId = testId ? `${testId}-session-controls` : undefined;
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
        </div>
      </Sheet>
    </div>
  );
}

export default Composer;
