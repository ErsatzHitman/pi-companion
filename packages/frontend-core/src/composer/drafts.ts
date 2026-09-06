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

import type { Clock } from "../platform/clock.js";
import type { StructuredStorage } from "../platform/storage.js";

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
