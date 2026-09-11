import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";

import { Button, Chip, ChipGroup, Sheet, StatusIndicator } from "../../ui/primitives/index.js";
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
import type { UseComposerOptions } from "./use-composer.js";
import { useComposer } from "./use-composer.js";
import type { ComposerAttachment } from "./use-attachments.js";
import { formatAttachmentSize } from "./use-attachments.js";
import { useComposerPaste } from "./use-clipboard-paste.js";
import { useDragAndDrop } from "./use-drag-and-drop.js";
import { useModelThinking } from "./use-model-thinking.js";
import { useQueueModes } from "./use-queue-modes.js";
import { useSlashCommands } from "./use-slash-commands.js";

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
   * `useSessionContextTelemetry` — the SAME derivation the right rail's
   * `ContextMeter` renders (`routes/root-route.tsx` owns that half). Omit
   * when no usage has been reported and the ring renders its honest
   * "not reported" state rather than a fabricated 0%.
   */
  contextTelemetry?: coreTelemetry.ContextWindowTelemetry;
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
 * `Button` primitive supplies the Stop control's native keyboard
 * operation and `disabled` state; and `StatusIndicator` pairs any
 * send/abort problem with visible text, not colour alone (plan.md §10.5).
 *
 * **Prompt-row layout (T386 fidelity work).** The row itself is the
 * mockup's `.prompt`: attach `+`, the context ring, the mono textarea and
 * the accent send control on one raised surface, with the mockup's visible
 * `.composer-foot` line below it. Three capabilities are unchanged and
 * stay reachable: `Attach files` is the `+` (same accessible name and
 * testId as its old text button), and `Commands` / `Stop` remain real
 * labelled buttons in the compact control line under the row. There is no
 * mic/dictate control: the mockup draws one, but web has no real dictation
 * path, and a dead button is worse than a missing one — the same call
 * `use-drag-and-drop.ts`'s own docs make for capabilities that are not
 * really there.
 *
 * **The context ring opens the session controls.** `ModelThinkingPicker`,
 * `QueueModePicker` and `PromptRoutingPicker` now live inside the existing
 * `Sheet` primitive, opened by the ring, matching the mockup's
 * ring-opens-the-menu behaviour. They are still the same components with
 * the same testIds and labels; only their mount point moved, so a reader
 * cannot mistake these session-wide controls for ambient composer chrome.
 * Escape inside the sheet closes it (the primitive's own focus trap);
 * Escape in the prompt bar interrupts the running turn instead, exactly as
 * the mockup's footer says.
 *
 * "Stop" (T28B2) is a second, distinctly-labelled control from "Send" —
 * cancelling the agent's active turn rather than submitting the draft —
 * so it renders below the prompt bar rather than replacing Send's label
 * while a turn runs (plan.md §12.2/§12.3 keep those two actions
 * separate; the daemon, not this button, decides whether a submission
 * made while a turn is active becomes a steer or a queued follow-up).
 *
 * Queue depth and mode (T28B3): `PromptBar`'s existing `queuedCount`
 * counter now reflects the live queue (`useComposer`'s `queueDepth`),
 * and a `StatusIndicator` spells out depth and its steer/follow-up split
 * in text (plan.md §10.5: never colour alone) whenever the daemon's own
 * live `pi_queue_update` reports one — the daemon decides steer vs.
 * follow-up (`agent-turn-client.ts`), so this is a display of that
 * decision, not a client-side control over it.
 *
 * Slash-command completion (T28B4): typing "/" as the entire draft (or
 * pressing the "Commands" toggle) opens the `CommandSearch` recipe
 * (plan.md §10.4) filled with the daemon's own `listCommands` result
 * (`use-slash-commands.ts`) — never a hard-coded set. `CommandSearch`
 * already supplies its own full keyboard contract (ArrowUp/ArrowDown to
 * move, Enter to choose, Escape to dismiss) as a labelled
 * combobox/listbox pair, so this component only wires selection
 * (inserting `/name ` into the draft and refocusing the message
 * textarea) and dismissal into it, rather than forking it. Because
 * `useComposer.submit` sends whatever text is in the draft verbatim, an
 * unrecognized slash command — whether typed past the palette or left
 * over after Escape — submits as ordinary text rather than being
 * rejected client-side.
 *
 * Model/thinking pickers (T28B5, plan.md §11.1 "model and reasoning"):
 * `ModelThinkingPicker` composes two `Select` primitives fed by
 * `useModelThinking`, mounted below the send/abort controls. Reads and
 * changes go through the same optional-method seam on `client` that
 * `onQueueUpdate`/`listCommands` already use — a client that omits the
 * four model/thinking methods leaves the picker in its own explained
 * "unsupported" state rather than erroring.
 *
 * Steer/follow-up mode control (T38B1a, plan.md §11.1 "queues and
 * automation"): `QueueModePicker` composes two more `Select` primitives
 * fed by `useQueueModes`, mounted below the model/thinking pickers. This
 * is the session-wide *mode* (deliver several queued messages together,
 * or one at a time) — distinct from which queue a single message enters
 * in the first place; `QueueModePicker`'s own copy states that
 * distinction directly, since the two are easy to conflate.
 *
 * CORRECTED (P6-W6 merge gate): an earlier version of this paragraph
 * said no real `DaemonClient` implemented the three methods this needs,
 * so the picker rendered its explained "unsupported" state. T110 landed
 * FIRST in this same wave (`5806cff`, before this file's `a3c3c82`), so
 * that is backwards at HEAD: `useQueueModes`'s support check finds all
 * three methods on a real `DaemonClient` and the picker renders **ready
 * and functional**. The `"unsupported"` state is still reachable — and
 * still tested — for a turn client that omits the trio; it is simply no
 * longer what a real session shows.
 *
 * Per-message steer/follow-up routing (T38B1b, the control the previous
 * paragraph used to describe as "not yet built"): `PromptRoutingPicker`,
 * mounted just below `QueueModePicker`, is the actual per-message choice
 * — plain local state (`useComposer`'s `promptRouting`/`setPromptRouting`)
 * that rides along on the *next* `submit()` call as
 * `SendAgentMessageOptions.streamingBehavior`, then resets to its "Auto"
 * default once that submission consumes it. See `PromptRoutingPicker.tsx`
 * and `use-composer.ts`'s own doc comments for the full contract and for
 * exactly how this differs from `QueueModePicker` above it.
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
  const slashCommandsToggleTestId = testId ? `${testId}-slash-commands-toggle` : undefined;
  const attachTestId = testId ? `${testId}-attach` : undefined;
  const attachmentsTestId = testId ? `${testId}-attachments` : undefined;
  const dropHintTestId = testId ? `${testId}-drop-hint` : undefined;
  const contextRingTestId = testId ? `${testId}-context-ring` : undefined;
  const controlsSheetTestId = testId ? `${testId}-session-controls` : undefined;
  const footerStateTestId = testId ? `${testId}-foot-state` : undefined;
  const composerClassName = dragAndDrop.isDraggingOver
    ? "pc-composer pc-composer--drop-active"
    : "pc-composer";

  return (
    <div
      className={composerClassName}
      ref={wrapperRef}
      onPaste={handlePaste}
      {...dragAndDrop.dropZoneHandlers}
    >
      {dragAndDrop.isDraggingOver ? (
        <div className="pc-composer__drop-hint" data-testid={dropHintTestId} aria-hidden="true">
          Drop to attach
        </div>
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
      <div className="pc-composer__controls">
        <Button
          kind="secondary"
          aria-haspopup="listbox"
          aria-expanded={slashCommands.isOpen}
          disabled={slashCommands.commands.length === 0}
          onClick={() => {
            if (slashCommands.isOpen) {
              slashCommands.dismiss();
              focusMessageInput();
            } else {
              slashCommands.open();
            }
          }}
          data-testid={slashCommandsToggleTestId}
        >
          Commands
        </Button>
        <Button
          kind="danger"
          disabled={!canAbort}
          onClick={() => {
            void abort();
          }}
          data-testid={abortTestId}
        >
          {isAborting ? "Stopping…" : "Stop"}
        </Button>
        {isAborting ? (
          <StatusIndicator label="Turn" tone="info" statusText="Stopping…" testId={statusTestId} />
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
        description="Mode, model and effort, and queue delivery for this session."
        onClose={() => setControlsOpen(false)}
        testId={controlsSheetTestId}
      >
        <div className="pc-composer__session-controls">
          <ModelThinkingPicker
            state={modelThinking}
            testId={testId ? `${testId}-model-thinking` : undefined}
          />
          <QueueModePicker
            state={queueModes}
            testId={testId ? `${testId}-queue-modes` : undefined}
          />
          <PromptRoutingPicker
            value={promptRouting}
            onChange={setPromptRouting}
            testId={testId ? `${testId}-prompt-routing` : undefined}
          />
        </div>
      </Sheet>
    </div>
  );
}

export default Composer;
