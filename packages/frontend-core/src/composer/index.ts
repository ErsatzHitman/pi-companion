/**
 * Composer domain — plan.md §6/§7.1.
 *
 * Owns drafts and the queued-submission outbox (T22 — "Implement core
 * drafts, outbox, and offline cache"). Prompt submission, steer,
 * follow-up, abort *dispatch*, queue mode, and compaction/retry
 * surfaces are a later task (T38B) layered on top of the outbox defined
 * here; this module only queues and persists, it never talks to a
 * `DaemonClient` directly.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

export type { Draft, DraftAttachmentRef, SaveDraftInput } from "./drafts.js";
export { DraftStore } from "./drafts.js";

export type {
  EnqueueInput,
  MarkFailedOptions,
  OutboxEntry,
  OutboxEntryKind,
  OutboxEntryStatus,
} from "./outbox.js";
export { OutboxController } from "./outbox.js";
