import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

import { Button, Chip, ChipGroup, StatusIndicator } from "../../ui/primitives/index.js";
import type { ChipTone } from "../../ui/primitives/index.js";
import { CommandSearch, PromptBar } from "../../ui/recipes/index.js";
import type { CommandSearchItem } from "../../ui/recipes/index.js";
import type { AgentSlashCommand } from "./agent-turn-client.js";
import "./composer.css";
import { ModelThinkingPicker } from "./ModelThinkingPicker.js";
import { PromptRoutingPicker } from "./PromptRoutingPicker.js";
import { QueueModePicker } from "./QueueModePicker.js";
import type { UseComposerOptions } from "./use-composer.js";
import { useComposer } from "./use-composer.js";
import type { ComposerAttachment } from "./use-attachments.js";
import { formatAttachmentSize } from "./use-attachments.js";
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

export interface ComposerProps extends UseComposerOptions {
  /** Accessible label for the input; also its visible-on-focus hint text. */
  label?: string;
  placeholder?: string;
  testId?: string;
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
 * Enter-to-send / Shift+Enter-for-newline keyboard contract, and the
 * `focus-visible` ring; the `Button` primitive supplies the Stop
 * control's native keyboard operation and `disabled` state; and
 * `StatusIndicator` pairs any send/abort problem with visible text, not
 * colour alone (plan.md §10.5).
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
 */
export function Composer({
  label = "Message Pi",
  placeholder = "Ask Pi…",
  testId,
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

  const wrapperRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

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

  const statusTestId = testId ? `${testId}-status` : undefined;
  const abortTestId = testId ? `${testId}-abort` : undefined;
  const queueStatusTestId = testId ? `${testId}-queue-status` : undefined;
  const slashCommandsTestId = testId ? `${testId}-slash-commands` : undefined;
  const slashCommandsToggleTestId = testId ? `${testId}-slash-commands-toggle` : undefined;
  const attachTestId = testId ? `${testId}-attach` : undefined;
  const attachmentsTestId = testId ? `${testId}-attachments` : undefined;

  return (
    <div className="pc-composer" ref={wrapperRef}>
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
          onClick={() => {
            void attachments.pickAndAddFiles();
          }}
          data-testid={attachTestId}
        >
          Attach files
        </Button>
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
      <ModelThinkingPicker
        state={modelThinking}
        testId={testId ? `${testId}-model-thinking` : undefined}
      />
      <QueueModePicker state={queueModes} testId={testId ? `${testId}-queue-modes` : undefined} />
      <PromptRoutingPicker
        value={promptRouting}
        onChange={setPromptRouting}
        testId={testId ? `${testId}-prompt-routing` : undefined}
      />
    </div>
  );
}

export default Composer;
