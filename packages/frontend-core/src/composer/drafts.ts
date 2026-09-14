/**
 * Draft persistence (plan.md §7.1, §12.5: "Drafts survive restart").
 *
 * A draft is the in-progress, unsent composer text (plus lightweight
 * attachment references) for a single conversation target — typically a
 * session or agent id. `DraftStore` is a thin, platform-neutral
 * persistence layer on top of `StructuredStorage`; it holds no
 * in-memory state of its own beyond what the caller reads back, so it
 * survives an app restart exactly as far as the injected
 * `StructuredStorage` implementation does.
 */

import type { Clock, TimerHandle } from "../platform/clock.js";
import type { StructuredStorage } from "../platform/storage.js";
import type { OutboxEntryStatus } from "./outbox.js";

/** Minimal, platform-neutral reference to an attachment staged on a draft. */
export interface DraftAttachmentRef {
  /** Locally stable id for this attachment reference (not a daemon id). */
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
}

/** A persisted, in-progress composer draft for one conversation target. */
export interface Draft {
  /** Conversation target this draft belongs to (session or agent id). */
  key: string;
  text: string;
  attachments: DraftAttachmentRef[];
  /** Epoch milliseconds of the last save. */
  updatedAt: number;
}

const DRAFTS_COLLECTION = "composer/drafts";

/** Options accepted by `DraftStore.save`. */
export interface SaveDraftInput {
  text: string;
  attachments?: DraftAttachmentRef[];
}

/**
 * Identifies the conversation target a draft belongs to (T389).
 *
 * A Pi session is only unique across the pair: the same `agentId` can
 * exist on two different daemons, so keying by `agentId` alone would let
 * session `x` on server A restore session `x`'s draft on server B.
 */
export interface DraftSessionTarget {
  /** The daemon/server this session lives on. */
  serverId: string;
  /** The agent/session id within that server. */
  agentId: string;
}

/** Joins the two URI-encoded halves of a draft id. */
const DRAFT_KEY_SEPARATOR = "::";

/**
 * Builds the `StructuredStorage` id for one conversation's draft (T389).
 *
 * Both halves are `encodeURIComponent`-escaped before joining, so a `":"`
 * inside either id cannot make two different sessions collide (a raw
 * separator would make `("a", "b::c")` and `("a::b", "c")` the same
 * key). Kept in core — not the web hook — because both platforms must
 * derive byte-identical ids or a draft written on one would never be seen
 * on the other.
 */
export function draftKeyForSession(target: DraftSessionTarget): string {
  return `${encodeURIComponent(target.serverId)}${DRAFT_KEY_SEPARATOR}${encodeURIComponent(
    target.agentId,
  )}`;
}

/**
 * Default debounce before a changed draft is written to storage (T389).
 * Long enough that ordinary typing is one write, short enough that a
 * reload right after a pause restores what the user last saw.
 */
export const DEFAULT_DRAFT_SAVE_DEBOUNCE_MS = 300;

/** Options accepted by `DraftSessionController`. */
export interface DraftSessionControllerOptions {
  /** Overridable for deterministic tests; defaults to `DEFAULT_DRAFT_SAVE_DEBOUNCE_MS`. */
  debounceMs?: number;
}

/**
 * FIX-W2 (plan.md §12.5): the outbox statuses that make a persisted
 * draft's text count as "already submitted" and therefore unsafe to
 * silently restore. Every status an `OutboxEntry` can actually persist in
 * is included — `pending` too, not just `sending`/`awaiting-confirmation`
 * — because a `pending` entry is already a durably recorded submission the
 * outbox itself owns getting sent; the exact race this fix closes (a
 * reload between `enqueue()` resolving and the persisted draft's `clear()`
 * resolving) is observed with the entry still `pending` (`markSending`
 * only runs once `clear()` has already resolved), so excluding it would
 * leave that race uncaught. `sent` is included for forward compatibility
 * even though `OutboxController.markSent` deletes the entry outright today
 * (`outbox.ts`) rather than ever persisting it in that status.
 */
const ALREADY_SUBMITTED_OUTBOX_STATUSES: ReadonlySet<OutboxEntryStatus> = new Set([
  "pending",
  "sent",
  "sending",
  "awaiting-confirmation",
]);

/** The minimal shape `isDraftAlreadySubmitted` needs from an `OutboxEntry` (outbox.ts). */
export interface DraftOutboxEntryLike {
  sessionId: string;
  status: OutboxEntryStatus;
  payload: unknown;
}

function outboxEntryTextMatches(payload: unknown, trimmedText: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const candidate = (payload as { text?: unknown }).text;
  return typeof candidate === "string" && candidate.trim() === trimmedText;
}

/**
 * FIX-W2: `true` when `text` (compared trimmed) matches an outbox entry
 * already recorded for `sessionId` in one of
 * `ALREADY_SUBMITTED_OUTBOX_STATUSES`. The mount-restore path
 * (`DraftSessionController.open`) uses this to refuse to silently restore
 * a persisted draft whose text has already gone out (or is already
 * durably in flight, or parked awaiting confirmation): restoring it would
 * let the user unknowingly resend it under a brand-new `clientMessageId`
 * that no server-side idempotency check can correlate with the original
 * submission (plan.md §12.5 "the user confirms uncertain sends" — a fresh,
 * uncorrelated resend is exactly what that rule exists to prevent).
 */
export function isDraftAlreadySubmitted(
  text: string,
  sessionId: string,
  entries: readonly DraftOutboxEntryLike[],
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return entries.some(
    (entry) =>
      entry.sessionId === sessionId &&
      ALREADY_SUBMITTED_OUTBOX_STATUSES.has(entry.status) &&
      outboxEntryTextMatches(entry.payload, trimmed),
  );
}

/** Options accepted by `DraftSessionController.open`. */
export interface OpenDraftOptions {
  /**
   * FIX-W2: called with a freshly loaded, non-empty persisted draft's text
   * before it is shown. Return (or resolve to) `true` to refuse the
   * restore — `open` then resolves to `""` and drops the now-known-stale
   * persisted draft, the same way a successful `clear()` does, instead of
   * silently re-showing already-submitted text on every future mount for
   * this target. Typically backed by `isDraftAlreadySubmitted` above, fed
   * from the caller's own `OutboxController.loadAll(sessionId)`.
   */
  isAlreadySubmitted?: (text: string) => boolean | Promise<boolean>;
}

/**
 * Persists composer drafts through the injected `StructuredStorage`.
 * One `DraftStore` instance is safe to share across an app session; a
 * new instance constructed over the same underlying storage (as happens
 * after an app restart) sees exactly the same drafts.
 */
export class DraftStore {
  private readonly storage: StructuredStorage;
  private readonly clock: Clock;
  private readonly collection: string;

  constructor(storage: StructuredStorage, clock: Clock, collection: string = DRAFTS_COLLECTION) {
    this.storage = storage;
    this.clock = clock;
    this.collection = collection;
  }

  /** Loads the current draft for `key`, or `null` if none is saved. */
  async load(key: string): Promise<Draft | null> {
    return this.storage.get<Draft>(this.collection, key);
  }

  /** Lists every persisted draft, most recently updated first. */
  async listAll(): Promise<Draft[]> {
    const drafts = await this.storage.list<Draft>(this.collection);
    return [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Saves (overwriting) the draft for `key` and returns the stored value. */
  async save(key: string, input: SaveDraftInput): Promise<Draft> {
    const draft: Draft = {
      key,
      text: input.text,
      attachments: input.attachments ?? [],
      updatedAt: this.clock.now(),
    };
    await this.storage.put(this.collection, key, draft);
    return draft;
  }

  /** Removes any saved draft for `key`. Safe to call when none exists. */
  async clear(key: string): Promise<void> {
    await this.storage.delete(this.collection, key);
  }
}

/**
 * Restores, debounces, and clears one conversation's draft (T389).
 *
 * `DraftStore` is deliberately dumb — it is a persistence layer with no
 * memory of its own. This controller supplies the lifecycle both apps
 * need on top of it, so the platform-neutral half of "drafts survive a
 * reload, and never leak between sessions" is written and tested once
 * rather than re-derived in `apps/web` and `apps/android`:
 *
 * - `open(target)` flushes any outstanding change for the *previous*
 *   target, then loads `target`'s saved text and returns it. Nothing is
 *   reported until that load resolves (`isHydrated` stays `false`), so a
 *   caller that types during the load can never have its keystrokes saved
 *   under the wrong session.
 * - `update(text)` records a change and schedules one write after
 *   `debounceMs`, through the injected `Clock` (never a platform timer).
 * - `flush()` writes any outstanding change immediately.
 * - `clear()` drops the active target's saved draft and its pending
 *   change — the successful-submit path.
 *
 * The controller holds no listener registration and knows nothing about
 * React; a caller reads the text back from `open` and calls `update` as
 * the user types.
 */
export class DraftSessionController {
  private readonly store: DraftStore;
  private readonly clock: Clock;
  private readonly debounceMs: number;
  private target: DraftSessionTarget | null = null;
  private pendingText = "";
  private timer: TimerHandle | null = null;
  private hydrated = false;
  private dirty = false;
  /** Guards against an out-of-order `open` (A -> B -> A) clobbering a newer one. */
  private generation = 0;

  constructor(store: DraftStore, clock: Clock, options: DraftSessionControllerOptions = {}) {
    this.store = store;
    this.clock = clock;
    this.debounceMs = options.debounceMs ?? DEFAULT_DRAFT_SAVE_DEBOUNCE_MS;
  }

  /** The target whose draft is currently active, or `null` before the first `open`. */
  get activeTarget(): DraftSessionTarget | null {
    return this.target;
  }

  /** The active text as this controller last saw it (restored or updated). */
  get text(): string {
    return this.pendingText;
  }

  /** `true` once the active target's saved draft has finished loading. */
  get isHydrated(): boolean {
    return this.hydrated;
  }

  /**
   * Makes `target` the active conversation and resolves to its saved text
   * (`""` when none is saved). Any change still pending for the previous
   * target is written first. The new target becomes active synchronously,
   * so an edit made while the load is still in flight is attributed to the
   * right session rather than dropped.
   */
  async open(target: DraftSessionTarget, options?: OpenDraftOptions): Promise<string> {
    const generation = (this.generation += 1);
    const previous = this.target;
    const previousText = this.pendingText;
    const hadPendingChange = this.dirty;
    this.cancelTimer();
    this.hydrated = false;
    this.dirty = false;
    this.pendingText = "";
    this.target = target;

    if (previous !== null && hadPendingChange) {
      await this.saveNow(previous, previousText);
    }
    // A newer `open` won while the previous write was in flight; leave its state alone.
    if (generation !== this.generation) return this.pendingText;

    const saved = await this.loadSaved(target);
    if (generation !== this.generation) return this.pendingText;
    // An edit that arrived while the load was in flight is newer than the
    // saved draft and must win — otherwise a fast typist's first keystrokes
    // would be silently replaced by (and never persisted over) old text.
    if (!this.dirty) {
      const restoredText = saved ?? "";
      // FIX-W2: ask the caller whether this text was already durably
      // submitted *before* showing it. This is itself an extra await, so
      // re-check both guards above again once it resolves: a newer `open`
      // or a keystroke that arrived during this check must still win.
      const alreadySubmitted =
        restoredText !== ""
          ? ((await options?.isAlreadySubmitted?.(restoredText)) ?? false)
          : false;
      if (generation === this.generation && !this.dirty) {
        if (alreadySubmitted) {
          this.pendingText = "";
          await this.clear();
        } else {
          this.pendingText = restoredText;
        }
      }
    }
    this.hydrated = true;
    return this.pendingText;
  }

  /**
   * Records a change, scheduling one debounced write. No-op before `open`
   * has been called (there is no target yet); a change made while `open`'s
   * load is still in flight is kept and wins over the loaded draft.
   */
  update(text: string): void {
    if (this.target === null) return;
    this.pendingText = text;
    this.dirty = true;
    this.cancelTimer();
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.persist();
    }, this.debounceMs);
  }

  /** Writes any outstanding change immediately. No-op when nothing is dirty. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (!this.hydrated || this.target === null || !this.dirty) return;
    await this.persist();
  }

  /**
   * Drops the active target's saved draft and any pending change. Called
   * once a submission is durably recorded, so the draft does not come back
   * on the next reload.
   */
  async clear(): Promise<void> {
    this.cancelTimer();
    if (this.target === null) return;
    this.pendingText = "";
    this.dirty = false;
    try {
      await this.store.clear(draftKeyForSession(this.target));
    } catch {
      // Best-effort: an unavailable storage must not break the composer.
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Draft persistence is best-effort: storage (IndexedDB on web, SQLite on
   * Android) can be unavailable — private browsing, a denied quota, a test
   * environment with no implementation — and a composer that refused to
   * mount or type because a draft could not be written would be far worse
   * than one whose draft is simply not restored next launch.
   */
  private async saveNow(target: DraftSessionTarget, text: string): Promise<void> {
    try {
      await this.store.save(draftKeyForSession(target), { text });
    } catch {
      // See this method's own doc comment.
    }
  }

  private async loadSaved(target: DraftSessionTarget): Promise<string | null> {
    try {
      return (await this.store.load(draftKeyForSession(target)))?.text ?? null;
    } catch {
      return null;
    }
  }

  private async persist(): Promise<void> {
    const target = this.target;
    if (target === null) return;
    this.dirty = false;
    await this.saveNow(target, this.pendingText);
  }
}
