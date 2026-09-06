/**
 * Composer render model (plan.md §9.2 "bottom composer with prominent
 * microphone and attachment actions"; T33B1; steer/follow-up/abort
 * T33B2).
 *
 * Kept free of any React Native import, exactly like
 * `../extensions/renderers/log-model.ts`, so the optimistic
 * pending -> sent -> failed lifecycle is unit-testable without a
 * device/emulator. `Composer.tsx` is a thin view over this module: it
 * owns no transition logic of its own, only wiring these functions to
 * `useState` and to the primitives.
 *
 * There is no live `DaemonClient` wired into Android yet (plan.md
 * §12.4's "no client yet" seam, already used by `ConnectionShell` and
 * the file browser), so `Composer` takes injected callbacks
 * (`onSubmit`, and now a `TurnService`) rather than talking to a
 * transport directly. This module does not know or care whether those
 * callbacks are backed by a real send: it only shapes local optimistic
 * state around whatever outcome the caller reports back.
 *
 * **Steer vs. follow-up vs. abort** (plan.md §7.2, §8; the daemon's
 * `pi_queue_update` event carries `steering: string[]` and
 * `followUp: string[]` — both genuine queues, not single slots): these
 * are three different queue transitions, not three buttons that do the
 * same thing.
 *
 * - A **steer** redirects the turn that is currently running.
 * - A **follow-up** queues a message to be sent once the running turn
 *   ends.
 * - An **abort** stops the running turn outright, and — because a
 *   follow-up only exists to run *after* a turn that is no longer going
 *   to finish — also drops whatever is locally queued rather than
 *   letting it be silently sent once the (now-aborted) turn "ends".
 *
 * Both only make sense while a turn is actually running, so
 * `submitSteer`/`submitFollowUp` are no-ops (like a blank draft) when
 * `state.turnRunning` is `false`. A plain `submitDraft` (T33B1) is
 * unconditional — it starts a *new* turn — and is left disabled by the
 * view whenever a turn is already running (see `Composer.tsx`).
 */

import type { ComposerUploadedAttachment } from "./attachment-model.js";

export type ComposerEntryStatus = "pending" | "sent" | "failed";

/**
 * The queue's dispatch mode (T33B3). plan.md §7.2 names exactly two
 * queues at the frontend state-model level — "prompt submission, steer,
 * follow-up, abort, and queue state" — so these are the only two modes
 * surfaced here; nothing wider (e.g. Pi's own agent-global
 * `steeringMode`/`followUpMode` RPC settings, §11.1/§12.3) is invented
 * on top of them, since the plan never enumerates that setting's
 * values.
 *
 * This selects which queue `Composer`'s explicit Steer/Follow-up
 * controls are understood to target by default; it does not disable
 * either control — see `Composer.tsx`'s mode `Select`.
 */
export type QueueDispatchMode = "steer" | "follow-up";

/** Default dispatch mode: queueing behind the running turn rather than redirecting it outright. */
export const DEFAULT_DISPATCH_MODE: QueueDispatchMode = "follow-up";

export interface ComposerEntry {
  /** Stable id for this submission; unchanged across a later retry. */
  id: string;
  text: string;
  status: ComposerEntryStatus;
  createdAt: number;
  /**
   * Attachments recorded on this entry (T33B7, `attachment-model.ts`).
   * Present only when at least one file was attached and successfully
   * uploaded before Send; absent (not an empty array) for every plain
   * text entry, so existing equality assertions in this file's own
   * tests (which never set this field) are unaffected.
   */
  attachments?: readonly ComposerUploadedAttachment[];
}

export interface ComposerState {
  draft: string;
  entries: readonly ComposerEntry[];
  /** Whether a Pi turn is currently running. Host-controlled — see `Composer.tsx`'s `turnRunning` prop. */
  turnRunning: boolean;
  /** Messages queued to redirect the currently running turn, oldest first. */
  steerQueue: readonly ComposerEntry[];
  /** Messages queued to run once the currently running turn ends, oldest first. */
  followUpQueue: readonly ComposerEntry[];
  /** Which queue new sends are currently understood to target — see `QueueDispatchMode`. */
  mode: QueueDispatchMode;
}

export const EMPTY_COMPOSER_STATE: ComposerState = {
  draft: "",
  entries: [],
  turnRunning: false,
  steerQueue: [],
  followUpQueue: [],
  mode: DEFAULT_DISPATCH_MODE,
};

export interface ComposerModelDeps {
  generateId: () => string;
  now: () => number;
}

/**
 * The transport for steering, following up, and aborting the live turn.
 * Injected — there is no live `DaemonClient` wired into Android yet
 * (plan.md §12.4's "no client yet" seam); T32A1B (P5-W6) provides a real
 * implementation. Every method settles once the daemon has acknowledged
 * (or rejected) the request; this module never assumes success before
 * that.
 */
export interface TurnService {
  steer: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  /**
   * Changes the queue dispatch mode (T33B3; see `QueueDispatchMode`).
   * Resolving applies the requested mode; rejecting means the daemon
   * declined it, and `Composer.tsx` reverts the model to whatever mode
   * was in effect before the request via `revertDispatchMode` — the
   * change is never left optimistically stuck on the requested mode.
   */
  setMode: (mode: QueueDispatchMode) => Promise<void>;
}

/** `true` once there is non-whitespace text to send. Mirrors `PromptBar`'s `canSend` contract. */
export function canSubmitDraft(draft: string): boolean {
  return draft.trim().length > 0;
}

/** `true` once there is non-whitespace text AND a turn is running to steer. */
export function canSteerDraft(state: ComposerState): boolean {
  return state.turnRunning && canSubmitDraft(state.draft);
}

/** `true` once there is non-whitespace text AND a turn is running to queue behind. */
export function canFollowUpDraft(state: ComposerState): boolean {
  return state.turnRunning && canSubmitDraft(state.draft);
}

/** `true` only while a turn is actually running — there is nothing to abort otherwise. */
export function canAbort(state: ComposerState): boolean {
  return state.turnRunning;
}

export interface SubmitDraftResult {
  state: ComposerState;
  /** The newly created entry, or `undefined` when the draft was blank (a no-op). */
  entry: ComposerEntry | undefined;
}

/**
 * Submits the current draft optimistically: the trimmed text enters
 * `entries` immediately with `status: "pending"`, and the draft is
 * cleared — both before any transport has confirmed anything. A no-op
 * (same `state` back, `entry: undefined`) for a blank/whitespace-only
 * draft, matching `canSubmitDraft`. This always starts a *new* turn; the
 * view disables it while `turnRunning` (use `submitSteer`/
 * `submitFollowUp` instead — see this module's doc comment).
 */
export function submitDraft(state: ComposerState, deps: ComposerModelDeps): SubmitDraftResult {
  const text = state.draft.trim();
  if (text.length === 0) {
    return { state, entry: undefined };
  }
  const entry: ComposerEntry = {
    id: deps.generateId(),
    text,
    status: "pending",
    createdAt: deps.now(),
  };
  return {
    state: { ...state, draft: "", entries: [...state.entries, entry] },
    entry,
  };
}

/**
 * Shared shape for enqueuing into `steerQueue`/`followUpQueue`: a no-op
 * (same `state` back, `entry: undefined`) for a blank draft OR when no
 * turn is running (there is nothing to steer or queue behind),
 * otherwise appends a fresh `"pending"` entry and clears the draft,
 * exactly like `submitDraft`.
 */
function submitToQueue(
  state: ComposerState,
  queueKey: "steerQueue" | "followUpQueue",
  deps: ComposerModelDeps,
): SubmitDraftResult {
  const text = state.draft.trim();
  if (!state.turnRunning || text.length === 0) {
    return { state, entry: undefined };
  }
  const entry: ComposerEntry = {
    id: deps.generateId(),
    text,
    status: "pending",
    createdAt: deps.now(),
  };
  return {
    state: { ...state, draft: "", [queueKey]: [...state[queueKey], entry] },
    entry,
  };
}

/** Enqueues the draft to redirect the running turn. See this module's doc comment for steer vs. follow-up. */
export function submitSteer(state: ComposerState, deps: ComposerModelDeps): SubmitDraftResult {
  return submitToQueue(state, "steerQueue", deps);
}

/** Enqueues the draft to run once the running turn ends. See this module's doc comment for steer vs. follow-up. */
export function submitFollowUp(state: ComposerState, deps: ComposerModelDeps): SubmitDraftResult {
  return submitToQueue(state, "followUpQueue", deps);
}

function updateEntry(
  state: ComposerState,
  id: string,
  updater: (entry: ComposerEntry) => ComposerEntry,
): ComposerState {
  return {
    ...state,
    entries: state.entries.map((entry) => (entry.id === id ? updater(entry) : entry)),
  };
}

function updateQueueEntry(
  state: ComposerState,
  queueKey: "steerQueue" | "followUpQueue",
  id: string,
  updater: (entry: ComposerEntry) => ComposerEntry,
): ComposerState {
  return {
    ...state,
    [queueKey]: state[queueKey].map((entry) => (entry.id === id ? updater(entry) : entry)),
  };
}

/** Marks a pending entry as confirmed sent (the transport acknowledged it). No-op for an unknown id. */
export function markEntrySent(state: ComposerState, id: string): ComposerState {
  return updateEntry(state, id, (entry) => ({ ...entry, status: "sent" }));
}

/**
 * Marks an entry as failed. The entry's `text` is left untouched on the
 * entry itself — this function alone never discards it; it only flips
 * the status so the view can offer a retry. `recoverFailedDraft` is
 * what actually makes the text recoverable for editing.
 */
export function markEntryFailed(state: ComposerState, id: string): ComposerState {
  return updateEntry(state, id, (entry) => ({ ...entry, status: "failed" }));
}

/**
 * Marks a queued steer entry sent/failed. No-op for an unknown id — in
 * particular, an id that `abortTurn` already dropped from `steerQueue`,
 * so a transport response that arrives after an abort cannot resurrect
 * it (see `abortTurn`'s doc comment).
 */
export function markSteerSent(state: ComposerState, id: string): ComposerState {
  return updateQueueEntry(state, "steerQueue", id, (entry) => ({ ...entry, status: "sent" }));
}

export function markSteerFailed(state: ComposerState, id: string): ComposerState {
  return updateQueueEntry(state, "steerQueue", id, (entry) => ({ ...entry, status: "failed" }));
}

/**
 * Marks a queued follow-up entry sent/failed. No-op for an unknown id —
 * in particular, an id that `abortTurn` already dropped from
 * `followUpQueue`, so a transport response that arrives after an abort
 * cannot resurrect it (see `abortTurn`'s doc comment).
 */
export function markFollowUpSent(state: ComposerState, id: string): ComposerState {
  return updateQueueEntry(state, "followUpQueue", id, (entry) => ({ ...entry, status: "sent" }));
}

export function markFollowUpFailed(state: ComposerState, id: string): ComposerState {
  return updateQueueEntry(state, "followUpQueue", id, (entry) => ({ ...entry, status: "failed" }));
}

/** Marks the model's turn as running. Does not touch either queue. */
export function startTurn(state: ComposerState): ComposerState {
  return { ...state, turnRunning: true };
}

/**
 * Marks the model's turn as no longer running because it finished
 * normally (not an abort). Unlike `abortTurn`, this never clears either
 * queue: a follow-up exists specifically to run once the turn it was
 * queued behind ends, so a normal end is exactly when it is expected to
 * proceed.
 */
export function finishTurn(state: ComposerState): ComposerState {
  return { ...state, turnRunning: false };
}

export interface AbortTurnResult {
  state: ComposerState;
  /** `false` when no turn was running — a no-op, not an error. */
  aborted: boolean;
  /** The follow-up entries that were queued and got dropped by this abort, oldest first. */
  cancelledFollowUp: readonly ComposerEntry[];
  /** The steer entries that were queued and got dropped by this abort, oldest first. */
  cancelledSteer: readonly ComposerEntry[];
}

/**
 * Stops the running turn, optimistically and immediately (the same
 * "appears before transport confirmation" contract as `submitDraft`) —
 * `Composer.tsx` calls this before awaiting `TurnService.abort()`, not
 * after.
 *
 * A no-op — same `state` back (by reference), `aborted: false`, both
 * cancelled lists empty — when no turn is running. This is the "abort
 * when nothing is running" case: it must never throw.
 *
 * Both queues are dropped: a queued steer only makes sense against a
 * turn that is still running, and a queued follow-up only makes sense
 * *after* a turn that is going to finish — an aborted turn is neither,
 * so nothing left in either queue should be silently sent later. Any
 * queue entry whose transport call was already in flight when this ran
 * is dropped from state here; if that in-flight call later
 * resolves/rejects, `markSteerSent`/`markSteerFailed`/
 * `markFollowUpSent`/`markFollowUpFailed` will find no entry with that
 * id and be a no-op, so the dropped entry cannot resurface.
 */
export function abortTurn(state: ComposerState): AbortTurnResult {
  if (!state.turnRunning) {
    return { state, aborted: false, cancelledFollowUp: [], cancelledSteer: [] };
  }
  return {
    state: { ...state, turnRunning: false, steerQueue: [], followUpQueue: [] },
    aborted: true,
    cancelledFollowUp: state.followUpQueue,
    cancelledSteer: state.steerQueue,
  };
}

export interface RecoverFailedDraftResult {
  state: ComposerState;
  /** `true` when a failed entry with this id existed and its text was restored. */
  recovered: boolean;
}

/**
 * Restores a failed entry's original text into `draft` so it can be
 * edited and resubmitted, and removes that entry from `entries` (it is
 * about to become a new pending entry once resubmitted, not sit
 * alongside a stale failed copy of itself). A no-op — `state` unchanged,
 * `recovered: false` — when `id` does not name a currently `"failed"`
 * entry; in particular this cannot be used to pull the text out of a
 * `pending` or `sent` entry.
 */
export function recoverFailedDraft(state: ComposerState, id: string): RecoverFailedDraftResult {
  const entry = state.entries.find((candidate) => candidate.id === id);
  if (!entry || entry.status !== "failed") {
    return { state, recovered: false };
  }
  return {
    state: {
      ...state,
      draft: entry.text,
      entries: state.entries.filter((candidate) => candidate.id !== id),
    },
    recovered: true,
  };
}

/** Count of entries still awaiting transport confirmation. */
export function pendingCount(state: ComposerState): number {
  return state.entries.filter((entry) => entry.status === "pending").length;
}

/** Live depth of each queue: entries not yet acknowledged by the daemon. A `"sent"`/`"failed"` entry is history, not depth. */
export interface QueueDepth {
  steer: number;
  followUp: number;
  /** `steer + followUp`. */
  total: number;
}

/** Computes `QueueDepth` from the two queues already tracked on `state` (T33B2's `steerQueue`/`followUpQueue`) — this does not add a parallel counter. */
export function queueDepth(state: ComposerState): QueueDepth {
  const steer = state.steerQueue.filter((entry) => entry.status === "pending").length;
  const followUp = state.followUpQueue.filter((entry) => entry.status === "pending").length;
  return { steer, followUp, total: steer + followUp };
}

/** Visible text for a queue depth (plan.md §10.5/T54: state as text, never colour alone). */
export function queueDepthLabel(depth: QueueDepth): string {
  if (depth.total === 0) {
    return "Queue empty";
  }
  const noun = depth.total === 1 ? "message" : "messages";
  return `${depth.total} ${noun} queued (${depth.steer} steer, ${depth.followUp} follow-up)`;
}

/** Visible text for a `QueueDispatchMode`. */
export function dispatchModeLabel(mode: QueueDispatchMode): string {
  return mode === "steer" ? "Steer" : "Follow up";
}

/** Full sentence combining mode and depth, for the queue status region's accessible name. */
export function describeQueueStatus(state: ComposerState): string {
  return `${dispatchModeLabel(state.mode)} mode. ${queueDepthLabel(queueDepth(state))}.`;
}

export interface SetDispatchModeResult {
  state: ComposerState;
  /** The mode in effect before this call. Pass to `revertDispatchMode` if the daemon rejects the change. */
  previousMode: QueueDispatchMode;
  /** `false` when `mode` already matched the current mode — a no-op, not a change; nothing to send to `TurnService.setMode`. */
  changed: boolean;
}

/**
 * Sets the dispatch mode optimistically — the same "appears before
 * transport confirmation" contract as `submitDraft`/`abortTurn`.
 * `Composer.tsx` calls this before awaiting `TurnService.setMode`, and
 * calls `revertDispatchMode(current, previousMode)` if that call
 * rejects.
 */
export function setDispatchMode(
  state: ComposerState,
  mode: QueueDispatchMode,
): SetDispatchModeResult {
  const previousMode = state.mode;
  if (previousMode === mode) {
    return { state, previousMode, changed: false };
  }
  return { state: { ...state, mode }, previousMode, changed: true };
}

/** Reverts the dispatch mode to `mode` after `TurnService.setMode` rejects. No-op (same `state` back) if it already matches. */
export function revertDispatchMode(state: ComposerState, mode: QueueDispatchMode): ComposerState {
  return state.mode === mode ? state : { ...state, mode };
}

/** Short visible status word for an entry (paired with its text, never colour alone — plan.md §10.5). */
export function entryStatusLabel(status: ComposerEntryStatus): string {
  switch (status) {
    case "pending":
      return "Sending…";
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
  }
}

/** Full sentence a screen reader announces for one entry's row. */
export function describeEntryStatus(entry: ComposerEntry): string {
  switch (entry.status) {
    case "pending":
      return `Sending: ${entry.text}`;
    case "sent":
      return `Sent: ${entry.text}`;
    case "failed":
      return `Failed to send: ${entry.text}. Double tap retry to restore it for editing.`;
  }
}

/** Accessible name for a failed entry's retry control. */
export function retryActionLabel(entry: ComposerEntry): string {
  return `Retry sending: ${entry.text}`;
}

export const COMPOSER_ACCESSIBILITY_LABEL = "Message composer";
export const COMPOSER_INPUT_LABEL = "Message";
export const MIC_ACTION_LABEL = "Record voice message";
export const ATTACH_ACTION_LABEL = "Add attachment";
export const STEER_ACTION_LABEL = "Redirect current response";
export const FOLLOW_UP_ACTION_LABEL = "Queue follow-up message";
export const ABORT_ACTION_LABEL = "Stop current response";
export const QUEUE_MODE_LABEL = "Queue mode";
