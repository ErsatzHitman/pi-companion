/**
 * Materializes a resolved share into a draft, and queues it through the
 * core outbox when it can't be materialized right away (T36C).
 *
 * This is deliberately built on the *same* two `frontend-core` seams
 * `features/composer/Composer.tsx` already constructs —
 * `composer.DraftStore` and `composer.OutboxController` — never a
 * second queue and never a private draft store. See each function's
 * doc comment for how.
 *
 * A share is never sent to the daemon here, online or offline: this
 * module only ever writes into `DraftStore`, exactly the same
 * unsent-until-the-user-hits-send surface `Composer.tsx` already
 * renders. That is what keeps "a shared URL must not be able to make
 * the app act on it without the user choosing to send it" (this task's
 * brief) true structurally, not just by convention.
 */

import type { composer as coreComposer } from "@picompanion/frontend-core";

import type { ClassifiedShareContent } from "./share-intent-model.js";

type DraftStoreLike = Pick<InstanceType<typeof coreComposer.DraftStore>, "load" | "save">;
type OutboxLike = Pick<
  InstanceType<typeof coreComposer.OutboxController>,
  "enqueue" | "markSending" | "markSent" | "markFailed" | "getAutoResendCandidates"
>;

export interface ShareDraftDeps {
  draftStore: DraftStoreLike;
  outbox: OutboxLike;
  /** Whether a materialize attempt should be made right now. Defaults to `true`. */
  isOnline?: () => boolean;
}

/**
 * `OutboxEntryKind` (`packages/frontend-core/src/composer/outbox.ts`) is
 * a closed union that has no "share" member, and this module may not
 * edit `frontend-core` this wave. `"extension-action"` is the closest
 * existing kind for content arriving outside the normal compose flow
 * that still needs to be reconciled once the app can act on it — see
 * this module's doc comment. A dedicated `"share"` kind would be a
 * small, natural follow-up in `frontend-core` once that package is back
 * in scope.
 */
const SHARE_OUTBOX_KIND: coreComposer.OutboxEntryKind = "extension-action";

/** One outbox entry's payload shape for a queued share — round-trips through `OutboxEntry<SharePayload>.payload`. */
export interface SharePayload {
  source: "share";
  content: ClassifiedShareContent;
}

export type ShareDraftOutcome =
  | { outcome: "drafted"; sessionId: string }
  | { outcome: "queued-offline"; sessionId: string; outboxEntryId: string };

/**
 * Turns a resolved share (already run through `classifyShareIntent` and
 * `chooseSession`) into a draft for `sessionId`, merging with whatever
 * draft already exists there (never overwriting unrelated draft text).
 *
 * Always records the attempt in the outbox first (`enqueue`), matching
 * `Composer.tsx`'s `sendWithOutbox`. When `deps.isOnline` reports
 * `false`, materializing is skipped entirely and the entry is left
 * `"pending"` — durably queued (`outcome: "queued-offline"`), not lost,
 * and *not* auto-sent to anyone; a future online-resume step (not this
 * task's grant — see `drainQueuedShares` below) is what turns a queued
 * entry into a draft once connectivity returns.
 */
export async function materializeShareDraft(
  content: ClassifiedShareContent,
  sessionId: string,
  deps: ShareDraftDeps,
): Promise<ShareDraftOutcome> {
  const payload: SharePayload = { source: "share", content };
  const entry = await deps.outbox.enqueue<SharePayload>({
    sessionId,
    kind: SHARE_OUTBOX_KIND,
    payload,
  });

  const online = deps.isOnline?.() ?? true;
  if (!online) {
    return { outcome: "queued-offline", sessionId, outboxEntryId: entry.id };
  }

  try {
    await deps.outbox.markSending(entry.id);
    await writeShareIntoDraft(deps.draftStore, sessionId, content);
    await deps.outbox.markSent(entry.id);
    return { outcome: "drafted", sessionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.outbox.markFailed(entry.id, message).catch(() => undefined);
    throw error;
  }
}

/**
 * Drains every `"pending"` queued-share entry for `sessionId` — the
 * other half of `materializeShareDraft`'s offline path — into that
 * session's draft. Intended to run once connectivity resumes; not
 * wired to any live connectivity signal in this task (unowned this
 * wave — see this feature's `index.ts` seam note).
 */
export async function drainQueuedShares(
  sessionId: string,
  deps: Pick<ShareDraftDeps, "draftStore" | "outbox">,
): Promise<number> {
  const candidates = await deps.outbox.getAutoResendCandidates(sessionId);
  let drained = 0;
  for (const entry of candidates) {
    if (entry.kind !== SHARE_OUTBOX_KIND) continue;
    const payload = entry.payload as SharePayload | undefined;
    if (!payload || payload.source !== "share") continue;
    await deps.outbox.markSending(entry.id);
    await writeShareIntoDraft(deps.draftStore, sessionId, payload.content);
    await deps.outbox.markSent(entry.id);
    drained += 1;
  }
  return drained;
}

async function writeShareIntoDraft(
  draftStore: DraftStoreLike,
  sessionId: string,
  content: ClassifiedShareContent,
): Promise<void> {
  const existing = await draftStore.load(sessionId);
  const existingText = existing?.text ?? "";

  if (content.kind === "text" || content.kind === "url") {
    const addition = content.kind === "text" ? content.text : content.url;
    const text = existingText.length > 0 ? `${existingText}\n${addition}` : addition;
    await draftStore.save(sessionId, { text, attachments: existing?.attachments ?? [] });
    return;
  }

  const attachments = [
    ...(existing?.attachments ?? []),
    {
      id: `share-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: content.name,
      mimeType: content.mimeType,
      size: content.sizeBytes,
    },
  ];
  await draftStore.save(sessionId, { text: existingText, attachments });
}
