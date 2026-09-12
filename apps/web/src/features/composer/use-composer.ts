import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Clock, FilePicker, StructuredStorage } from "@picompanion/frontend-core";
import { composer as coreComposer, timeline as coreTimeline } from "@picompanion/frontend-core";

import type {
  AgentQueueUpdate,
  AgentTurnClient,
  PromptStreamingBehavior,
} from "./agent-turn-client.js";
import type { PiUiComposerDraftSource } from "./pi-ui-composer-draft.js";
import type { UseAttachmentsState } from "./use-attachments.js";
import { useAttachments } from "./use-attachments.js";
import { useComposerPiUiDraft } from "./use-composer-pi-ui-draft.js";

const EMPTY_QUEUE_UPDATE: AgentQueueUpdate = { steering: [], followUp: [] };

/**
 * Composer input and prompt submission (plan.md §8.3 "centre transcript
 * and composer"; T28B1).
 *
 * `useComposer` is the framework-facing glue between the `PromptBar`
 * recipe and the two `frontend-core` pieces a prompt submission touches:
 *
 * - `composer.OutboxController` (T22) records the submission with a
 *   stable client submission id *before* any daemon round-trip — "with
 *   submission through core" from the T28B1 scope note.
 * - `timeline.addOptimisticUserMessage` (T20B) adds a local pending row
 *   for that same submission so it "appears optimistically in the
 *   transcript" (T28B1 acceptance criterion) the instant it is sent,
 *   without waiting for a daemon acknowledgment.
 *
 * `visibleRows` is exactly `timeline.getVisibleTimelineRows` — the same
 * view model the transcript feature (owned separately, T28A*) will
 * render from once it exists. This hook does not render a transcript
 * itself; it only guarantees the optimistic row is produced correctly.
 *
 * Steering and follow-up (T28B2) are not a client-side choice: the same
 * `submit()` call is used regardless of whether a turn is idle, running,
 * or queued, and the daemon (not this hook) decides whether a given
 * submission lands as a fresh prompt, a mid-turn steer, or a queued
 * follow-up (see `agent-turn-client.ts`). What T28B2 adds is the actual
 * network round trip for that submission — every entry is only ever
 * recorded in the outbox before T28B2 — plus `abort()`, an explicit
 * control to cancel the agent's active turn.
 *
 * Queue depth and mode (T28B3): `queueUpdate` mirrors the daemon's live
 * `pi_queue_update` stream (steering vs. follow-up entries, in queue
 * order) through the same optional-client seam as `abort` — a client
 * that does not implement `onQueueUpdate` simply leaves the queue at its
 * empty default rather than erroring. There is no client-settable queue
 * *mode* here — that lives in `use-queue-modes.ts` (T38B1a), not this
 * hook. (CORRECTED (P6-W6 merge gate): this said the mode was
 * "entirely the daemon's decision" and had "no wire request to change it
 * today". The wire request has existed since P6-W3 (T38B0a) and a real
 * `DaemonClient` has sent it since T110.)
 *
 * Slash-command completion is a later task (T28B4) layered on top of
 * this same hook.
 *
 * Per-message routing (T38B1b, plan.md §11.1 "queues and automation"):
 * `promptRouting`/`setPromptRouting` is *not* the T38B1a queue mode above
 * — it is plain local UI state (no daemon round trip, no "unsupported"
 * state; see `PromptRoutingPicker.tsx`'s own doc comment for the full
 * distinction) recording which queue the *next* submission should enter:
 * `null` (the default) sends no `streamingBehavior` at all, preserving
 * the daemon's own turn-state-derived choice exactly; an explicit
 * `"steer"`/`"followUp"` overrides it for that one message only.
 * `submit()` reads the current value, forwards it to `client.sendAgentMessage`
 * as `options.streamingBehavior`, and then resets it back to `null` —
 * consumed the moment it travels with its message, the same way
 * `attachments.clear()` a few lines below empties the attachment tray
 * once its refs have travelled with that same submission — so a later,
 * unrelated send is never silently steered (or queued) by a choice made
 * for an earlier message.
 *
 * Attachments (T28B6, plan.md §12.4): `attachments` is `useAttachments`
 * (`use-attachments.ts`) composed in here rather than left for `Composer`
 * to wire up separately, because `submit()` needs to read its
 * `uploadedAttachments`/`hasPendingUploads` directly — a submission
 * waits for every staged upload to finish, then records the resulting
 * `AgentUploadedAttachment` refs on the very same outbox entry
 * (`kind: "prompt"`) as the text ("through the core outbox", the T28B6
 * scope note), and passes them to `client.sendAgentMessage` alongside
 * it. A blank draft with at least one uploaded attachment is a valid
 * send — canSend does not require `draftText` when an attachment is
 * ready — since an attachment-only message is a real use case the wire
 * protocol supports (`SendAgentMessageSchema`'s `text` accepts an empty
 * string).
 *
 * Pi UI Bridge `composer` proposals (plan.md §11.3 "composer update with
 * undo"): `piUiComposerDrafts` is the optional seam through which an
 * accepted `composer`-kind element's suggested text reaches this draft.
 * The subscription itself is `useComposerPiUiDraft`
 * (`use-composer-pi-ui-draft.ts`); the source is built by whichever route
 * mounts both the composer and the Pi UI rail, since only a route may
 * compose two sibling features. Omitted — the honest default for a
 * standalone composer or a test harness — nothing subscribes and the
 * draft changes only by typing, exactly as before.
 */
export interface UseComposerOptions {
  /** Conversation target this composer submits into (session or agent id). */
  sessionId: string;
  /**
   * The daemon/server `sessionId` lives on (T389). Drafts are keyed by
   * `serverId` + `sessionId` so the same session id on two daemons never
   * shares one draft; omit it only for a standalone composer with no server
   * identity (tests, fixtures), which keys on the session id alone.
   */
  serverId?: string;
  clock: Clock;
  structuredStorage: StructuredStorage;
  /**
   * Platform file-selection surface (T28B6, plan.md §7.3). Always
   * required — unlike `client` — since picking a file does not depend
   * on a live daemon connection, only the upload that follows it does.
   */
  filePicker: FilePicker;
  /** Overridable for deterministic tests; defaults to a clock-seeded generator. */
  generateClientMessageId?: () => string;
  /**
   * Live turn-control client (T28B2). When omitted, submissions are
   * still durably recorded in the outbox (T28B1) but never sent over
   * the network, and `abort` is a no-op — the same "no live client yet"
   * seam `TerminalRoute` and the file browser already use (plan.md
   * §12.4) rather than one invented for this feature.
   */
  client?: AgentTurnClient;
  /**
   * Pi UI Bridge `composer`-kind proposals (plan.md §11.3). When wired,
   * a settled `accept` writes the proposal's text into `draftText` through
   * the same setter the input uses, and a settled `undo` restores what it
   * replaced; a blank proposal, a declined action, and a non-`composer`
   * element are all no-ops. See `UseComposerOptions`'s doc comment and
   * `pi-ui-composer-draft.ts` for the full rule set.
   */
  piUiComposerDrafts?: PiUiComposerDraftSource;
}

export interface ComposerState {
  draftText: string;
  /**
   * `true` once there is something to send (non-whitespace `draftText`,
   * or at least one uploaded attachment) and no submission or attachment
   * upload is currently in flight.
   */
  canSend: boolean;
  /** `true` while a submission's outbox write (and, once a client is wired, its send) is in flight. */
  isSubmitting: boolean;
  /** Confirmed + optimistic rows, in submission order (`timeline.getVisibleTimelineRows`). */
  visibleRows: coreTimeline.TimelineRow[];
  setDraftText: (text: string) => void;
  /** Trims and submits the current draft. No-op when it is blank or already sending. */
  submit: () => Promise<void>;
  /**
   * The most recent submission's send error, or `null` if it round-
   * tripped cleanly (or no client is wired). Cleared at the start of
   * the next `submit()`.
   */
  sendError: string | null;
  /** `true` while a `client.cancelAgent` call from `abort()` is in flight. */
  isAborting: boolean;
  /** `true` when `abort()` can currently do something: a client is wired and no abort is already in flight. */
  canAbort: boolean;
  /** Cancels the agent's active turn, if any. No-op when no client is wired or an abort is already in flight. */
  abort: () => Promise<void>;
  /** The most recent abort attempt's error, or `null`. Cleared at the start of the next `abort()`. */
  abortError: string | null;
  /**
   * This agent's live queue (T28B3): entries the daemon has already
   * accepted and is holding to steer the active turn, or to run as a
   * follow-up once it ends. Stays at `{ steering: [], followUp: [] }`
   * until a client with `onQueueUpdate` is wired and pushes an update.
   */
  queueUpdate: AgentQueueUpdate;
  /** `queueUpdate.steering.length + queueUpdate.followUp.length`. */
  queueDepth: number;
  /** Staged composer attachments (T28B6): selection, upload, retry, and removal. */
  attachments: UseAttachmentsState;
  /**
   * The per-message routing (T38B1b) the *next* `submit()` call will send.
   * `null` is "Auto": no `streamingBehavior` is sent, and the daemon's own
   * turn-state-derived default applies exactly as if this control did not
   * exist. See this file's own doc comment above for the full contract,
   * including why `submit()` resets this back to `null` once consumed.
   */
  promptRouting: PromptStreamingBehavior | null;
  setPromptRouting: (routing: PromptStreamingBehavior | null) => void;
}

let clientMessageIdSequence = 0;

function defaultGenerateClientMessageId(clock: Clock): string {
  clientMessageIdSequence += 1;
  return `composer-${clock.now().toString(36)}-${clientMessageIdSequence.toString(36)}`;
}

export function useComposer(options: UseComposerOptions): ComposerState {
  const {
    sessionId,
    serverId = "",
    clock,
    structuredStorage,
    generateClientMessageId,
    client,
    filePicker,
    piUiComposerDrafts,
  } = options;

  const [draftText, setDraftTextState] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [visibleRows, setVisibleRows] = useState<coreTimeline.TimelineRow[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isAborting, setIsAborting] = useState(false);
  const [abortError, setAbortError] = useState<string | null>(null);
  const [queueUpdate, setQueueUpdateState] = useState<AgentQueueUpdate>(EMPTY_QUEUE_UPDATE);
  const [promptRouting, setPromptRouting] = useState<PromptStreamingBehavior | null>(null);
  const attachments = useAttachments({ client, filePicker });

  const timelineRef = useRef<coreTimeline.TimelineState>(coreTimeline.createEmptyTimelineState());

  // T389: drafts are persisted per conversation target (server + session).
  // `DraftSessionController` owns the debounce and the switch-safety rules;
  // this hook only feeds it. Constructed once (the platform storage/clock
  // are stable for a mounted composer's lifetime, and a caller that passes
  // fresh option objects per render must not rebuild the hydration state).
  const draftControllerRef = useRef<coreComposer.DraftSessionController | null>(null);
  draftControllerRef.current ??= new coreComposer.DraftSessionController(
    new coreComposer.DraftStore(structuredStorage, clock),
    clock,
  );
  const draftController = draftControllerRef.current;

  // Restore on mount and whenever the target changes. The displayed draft is
  // cleared first so session B never briefly shows session A's text while the
  // load is in flight; the effect's cleanup flushes A's pending change.
  useEffect(() => {
    let cancelled = false;
    setDraftTextState("");
    void draftController
      .open({ serverId, agentId: sessionId })
      .then((restored) => {
        if (!cancelled && restored !== "") setDraftTextState(restored);
      })
      .catch(() => {
        // Draft restoration is best-effort; a storage failure leaves the
        // composer mounted and empty rather than surfacing an error.
      });
    return () => {
      cancelled = true;
      void draftController.flush();
    };
  }, [draftController, serverId, sessionId]);

  const setDraftText = useCallback(
    (text: string): void => {
      setDraftTextState(text);
      draftController.update(text);
    },
    [draftController],
  );

  // A settled `composer`-kind accept/undo from the Pi UI rail writes here,
  // through the same `setDraftText` above — one draft, one setter, no
  // second copy of the composer's text (plan.md §11.3's "composer update
  // with undo").
  useComposerPiUiDraft({
    source: piUiComposerDrafts,
    draftText,
    setDraftText,
  });

  // Live queue-depth subscription (T28B3): resets to empty and
  // re-subscribes whenever the agent or client identity changes, and
  // unsubscribes on unmount — the same lifecycle
  // `terminal.TerminalController`'s `onTerminalStreamEvent` wiring uses.
  useEffect(() => {
    setQueueUpdateState(EMPTY_QUEUE_UPDATE);
    if (!client?.onQueueUpdate) return;
    const unsubscribe = client.onQueueUpdate(sessionId, (update) => {
      setQueueUpdateState(update);
    });
    return unsubscribe;
  }, [client, sessionId]);

  // One outbox per (sessionId, storage, clock) identity; those are
  // expected to be stable for the lifetime of a mounted composer.
  const outbox = useMemo(
    () => new coreComposer.OutboxController(structuredStorage, clock),
    [structuredStorage, clock],
  );

  const makeClientMessageId = useCallback(
    (): string => generateClientMessageId?.() ?? defaultGenerateClientMessageId(clock),
    [generateClientMessageId, clock],
  );

  const submit = useCallback(async () => {
    const text = draftText.trim();
    const uploadedAttachments = attachments.uploadedAttachments;
    // Nothing to send, already sending, or an attachment upload is still
    // in flight (T28B6: a submission always waits for every staged
    // upload to resolve or fail before it can go out, so the daemon never
    // receives a half-uploaded reference).
    if (
      (!text && uploadedAttachments.length === 0) ||
      isSubmitting ||
      attachments.hasPendingUploads
    ) {
      return;
    }

    const clientMessageId = makeClientMessageId();
    const timestamp = new Date(clock.now()).toISOString();
    // Captured before the reset below (T38B1b): this submission carries
    // whatever routing was selected at the moment Send was invoked.
    const streamingBehavior = promptRouting ?? undefined;

    setIsSubmitting(true);
    setSendError(null);
    // Add the optimistic row and clear the draft immediately: the user's
    // own message must not wait on the outbox write (let alone a daemon
    // round trip) to appear.
    timelineRef.current = coreTimeline.addOptimisticUserMessage(timelineRef.current, {
      clientMessageId,
      text,
      timestamp,
    });
    setVisibleRows(coreTimeline.getVisibleTimelineRows(timelineRef.current));
    // Clear the visible draft immediately (the optimistic row above must not
    // wait), but keep the persisted draft until the submission is durably in
    // the outbox: a crash between here and the enqueue leaves it restorable.
    setDraftTextState("");
    // Clear staged attachments now: they travel with this specific
    // submission's outbox entry and `sendAgentMessage` call below, not as
    // ambient state a later, unrelated submission could pick up.
    attachments.clear();
    // Same reasoning for the per-message routing choice (T38B1b): it is
    // consumed by this submission alone, so it resets to "Auto" rather
    // than silently steering (or queuing) every later, unrelated send.
    setPromptRouting(null);

    try {
      const entry = await outbox.enqueue({
        sessionId,
        kind: "prompt",
        payload: { text, clientMessageId, attachments: uploadedAttachments },
      });

      // The submission is durably recorded now, so the draft can go for good.
      await draftController.clear();

      // No live client (plan.md §12.4's "no client yet" seam): the
      // submission stays durably `pending` in the outbox and this hook
      // does not attempt a network send.
      if (!client) return;

      await outbox.markSending(entry.id);
      try {
        // Whether the daemon treats this as a fresh prompt, a mid-turn
        // steer, or a queued follow-up is its own decision by default
        // (`agent-turn-client.ts`) unless `streamingBehavior` explicitly
        // overrides it for this one message (T38B1b) — the call is
        // otherwise identical either way.
        await client.sendAgentMessage(sessionId, text, {
          messageId: clientMessageId,
          ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
        });
        await outbox.markSent(entry.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Idempotency is not verified here, so a failed send is parked
        // in `awaiting-confirmation` (plan.md §12.5) rather than
        // auto-resent.
        await outbox.markFailed(entry.id, message);
        setSendError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    draftText,
    isSubmitting,
    makeClientMessageId,
    clock,
    outbox,
    draftController,
    sessionId,
    client,
    attachments,
    promptRouting,
  ]);

  const abort = useCallback(async () => {
    if (!client || isAborting) return;

    setIsAborting(true);
    setAbortError(null);
    try {
      await client.cancelAgent(sessionId);
    } catch (error) {
      setAbortError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAborting(false);
    }
  }, [client, isAborting, sessionId]);

  const queueDepth = queueUpdate.steering.length + queueUpdate.followUp.length;

  const hasSendableText = draftText.trim().length > 0;
  const hasUploadedAttachment = attachments.uploadedAttachments.length > 0;

  return {
    draftText,
    canSend:
      (hasSendableText || hasUploadedAttachment) && !isSubmitting && !attachments.hasPendingUploads,
    isSubmitting,
    visibleRows,
    setDraftText,
    submit,
    sendError,
    isAborting,
    canAbort: Boolean(client) && !isAborting,
    abort,
    abortError,
    queueUpdate,
    queueDepth,
    attachments,
    promptRouting,
    setPromptRouting,
  };
}
