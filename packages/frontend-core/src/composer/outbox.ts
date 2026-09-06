/**
 * Outbox for queued daemon submissions (plan.md §7.1, §12.5).
 *
 * Every submission the composer hands to the daemon — a prompt, a
 * steer, a follow-up, an abort, and so on — is first recorded here with
 * a *stable client submission id* that never changes across retries of
 * the same logical send. That id is what lets the daemon (once it
 * supports idempotent resend) recognize a retried submission as the
 * same one, rather than creating a duplicate.
 *
 * Per plan.md §12.5: "Automatic resend is enabled only after daemon
 * idempotency is verified; otherwise the user confirms uncertain
 * sends." This module enforces that rule structurally: a failed entry
 * only re-enters the auto-resend-eligible `pending` state on its own
 * when the caller asserts idempotency has been verified for that send.
 * Otherwise it is parked in `awaiting-confirmation` and the *only* way
 * back to `pending` is the explicit `confirmResend` call — there is no
 * code path that resends it automatically.
 */

import type { Clock } from "../platform/clock.js";
import type { StructuredStorage } from "../platform/storage.js";

/** The kinds of composer submissions the outbox can carry. */
export type OutboxEntryKind =
  | "prompt"
  | "steer"
  | "followup"
  | "abort"
  | "permission-answer"
  | "extension-action";

/**
 * Lifecycle of one outbox entry.
 *
 * - `pending`: not yet sent, or safe to (re)send automatically.
 * - `sending`: a send attempt is in flight.
 * - `awaiting-confirmation`: a send attempt failed and idempotency for
 *   that attempt was not verified; only an explicit `confirmResend`
 *   moves this back to `pending`.
 * - `sent`: the daemon acknowledged the submission. Terminal; entries
 *   are normally removed once observed in this state.
 */
export type OutboxEntryStatus = "pending" | "sending" | "awaiting-confirmation" | "sent";

/** One queued submission, addressed by a stable client submission id. */
export interface OutboxEntry<TPayload = unknown> {
  /** Stable client submission id. Unchanged across retries of this entry. */
  id: string;
  /** Conversation target this submission belongs to (session or agent id). */
  sessionId: string;
  kind: OutboxEntryKind;
  payload: TPayload;
  status: OutboxEntryStatus;
  /** Epoch milliseconds when the entry was first enqueued. */
  createdAt: number;
  /** Epoch milliseconds of the most recent send attempt, if any. */
  lastAttemptAt?: number;
  /** Number of send attempts made so far. */
  attempts: number;
  /** Error message from the most recent failed attempt, if any. */
  lastError?: string;
}

const OUTBOX_COLLECTION = "composer/outbox";

/** Options accepted by `OutboxController.enqueue`. */
export interface EnqueueInput<TPayload = unknown> {
  sessionId: string;
  kind: OutboxEntryKind;
  payload: TPayload;
}

/** Options accepted by `OutboxController.markFailed`. */
export interface MarkFailedOptions {
  /**
   * Set only when the caller has independently verified that the
   * daemon will treat a resend of this entry's stable id as
   * idempotent (for example, a documented capability/feature gate).
   * Defaults to `false`: the safe, conservative choice.
   */
  idempotencyVerified?: boolean;
}

function defaultGenerateId(clock: Clock): string {
  const timePart = clock.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `outbox-${timePart}-${randomPart}`;
}

/**
 * Manages the queued-submission outbox through the injected
 * `StructuredStorage`, so queued entries survive an app restart. Holds
 * no send/network logic itself — callers (the connection/session
 * layer) drive `markSending`/`markSent`/`markFailed` around their own
 * daemon RPC calls.
 */
export class OutboxController {
  private readonly storage: StructuredStorage;
  private readonly clock: Clock;
  private readonly collection: string;
  private readonly generateId: () => string;

  constructor(
    storage: StructuredStorage,
    clock: Clock,
    options?: { collection?: string; generateId?: () => string },
  ) {
    this.storage = storage;
    this.clock = clock;
    this.collection = options?.collection ?? OUTBOX_COLLECTION;
    this.generateId = options?.generateId ?? (() => defaultGenerateId(clock));
  }

  /** Loads every outbox entry, optionally filtered to one session/agent. */
  async loadAll(sessionId?: string): Promise<OutboxEntry[]> {
    const entries = await this.storage.list<OutboxEntry>(this.collection);
    const scoped = sessionId ? entries.filter((entry) => entry.sessionId === sessionId) : entries;
    return [...scoped].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Loads a single outbox entry by its stable client submission id. */
  async load(id: string): Promise<OutboxEntry | null> {
    return this.storage.get<OutboxEntry>(this.collection, id);
  }

  /**
   * Entries safe to (re)send automatically right now: `pending` only.
   * Deliberately excludes `awaiting-confirmation` — that is the whole
   * point of this module.
   */
  async getAutoResendCandidates(sessionId?: string): Promise<OutboxEntry[]> {
    const entries = await this.loadAll(sessionId);
    return entries.filter((entry) => entry.status === "pending");
  }

  /** Enqueues a new submission with a freshly generated stable id. */
  async enqueue<TPayload>(input: EnqueueInput<TPayload>): Promise<OutboxEntry<TPayload>> {
    const entry: OutboxEntry<TPayload> = {
      id: this.generateId(),
      sessionId: input.sessionId,
      kind: input.kind,
      payload: input.payload,
      status: "pending",
      createdAt: this.clock.now(),
      attempts: 0,
    };
    await this.storage.put(this.collection, entry.id, entry);
    return entry;
  }

  /** Marks an entry as having an in-flight send attempt. */
  async markSending(id: string): Promise<OutboxEntry | null> {
    return this.update(id, (entry) => ({
      ...entry,
      status: "sending",
      attempts: entry.attempts + 1,
      lastAttemptAt: this.clock.now(),
    }));
  }

  /**
   * Marks an entry as acknowledged by the daemon and removes it from
   * the outbox (its job is done; callers that need history should copy
   * relevant fields into the timeline before calling this).
   */
  async markSent(id: string): Promise<void> {
    await this.storage.delete(this.collection, id);
  }

  /**
   * Marks a send attempt as failed.
   *
   * With `idempotencyVerified: true`, the entry returns to `pending`
   * and is eligible for automatic resend. Otherwise (the default) it
   * moves to `awaiting-confirmation`, which `getAutoResendCandidates`
   * never returns; the caller must call `confirmResend` after explicit
   * user confirmation before it can be sent again.
   */
  async markFailed(
    id: string,
    error: string,
    options?: MarkFailedOptions,
  ): Promise<OutboxEntry | null> {
    const idempotencyVerified = options?.idempotencyVerified ?? false;
    return this.update(id, (entry) => ({
      ...entry,
      status: idempotencyVerified ? "pending" : "awaiting-confirmation",
      lastError: error,
      lastAttemptAt: this.clock.now(),
    }));
  }

  /**
   * The only path from `awaiting-confirmation` back to `pending`. Call
   * this only after the user has explicitly confirmed an uncertain
   * resend. No-op (returns `null`) for an entry that is not currently
   * `awaiting-confirmation`, so it cannot be used to bypass the guard.
   */
  async confirmResend(id: string): Promise<OutboxEntry | null> {
    const entry = await this.load(id);
    if (!entry || entry.status !== "awaiting-confirmation") {
      return null;
    }
    return this.update(id, (current) => ({
      ...current,
      status: "pending",
    }));
  }

  /** Removes an entry outright (for example, a user-cancelled draft send). */
  async remove(id: string): Promise<void> {
    await this.storage.delete(this.collection, id);
  }

  private async update(
    id: string,
    updater: (entry: OutboxEntry) => OutboxEntry,
  ): Promise<OutboxEntry | null> {
    const entry = await this.load(id);
    if (!entry) {
      return null;
    }
    const next = updater(entry);
    await this.storage.put(this.collection, id, next);
    return next;
  }
}
