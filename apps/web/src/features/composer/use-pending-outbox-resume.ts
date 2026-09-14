/**
 * Pushes a `pending` outbox entry over the wire, reusing its ORIGINAL
 * `clientMessageId` (FIX-W8).
 *
 * ## The gap this closes
 *
 * `composer.OutboxController.confirmResend` (`@picompanion/frontend-core`,
 * `packages/frontend-core/src/composer/outbox.ts`) is the *only* path an
 * `"awaiting-confirmation"` entry has back to `"pending"` — but it only
 * flips the entry's status; that module holds "no send/network logic
 * itself" (its own doc comment). Before this file, web's
 * `RecoveredTurnBanner` "Resend" action called `confirmRecoveredTurn`
 * (`./recovered-turn-model.ts`, which calls `confirmResend`) and nothing
 * else: the banner disappeared, the entry sat `"pending"` in storage
 * forever, and the message was never actually sent — a button that lied.
 *
 * Android does not have this gap: `apps/android/src/app-shell/core.ts`'s
 * `resumePendingTurnOutboxEntries` re-sends every `"pending"` entry on
 * every fresh daemon connection (cold start and reconnect alike). This
 * module is web's equivalent half of that same behaviour contract —
 * triggered from the banner's Resend action and, optionally, on
 * reconnect, rather than from a cold-start recovery pass web has no
 * equivalent of (see `recovered-turn-model.ts`'s own doc comment on why
 * web has no `TurnOutboxOwner`-shaped cold start).
 *
 * ## Behaviour contract (mirrors `resumePendingTurnOutboxEntries`)
 *
 * - Only `"prompt"`-kind entries are resent (the only kind that carries
 *   free text a `sendAgentMessage` call can replay); any other kind is
 *   left untouched, matching Android's `if (entry.kind !== "prompt")
 *   continue`.
 * - The entry's ORIGINAL `payload.clientMessageId` — the id
 *   `use-composer.ts`'s `submit()` minted once, when the entry was first
 *   enqueued — is sent as `SendAgentMessageOptions.messageId`, never a
 *   freshly minted id. The daemon's `startAgentRun`
 *   (`packages/server/src/server/agent/agent-prompt.ts`) dedupes an
 *   incoming `send_agent_message_request` on this id, so resending under
 *   the same id is what turns "one message queued twice" into "the same
 *   logical send, retried" instead of a second, duplicate user row.
 * - `markSending`/`markSent`/`markFailed` bracket the network call
 *   exactly the way `use-composer.ts`'s own `submit()` and Android's
 *   `resumePendingTurnOutboxEntries` both already do: a failed resend is
 *   parked back in `"awaiting-confirmation"` (idempotency is not
 *   independently re-verified here, so the same conservative default
 *   `outbox.ts`'s own `markFailed` doc comment describes applies) —
 *   never silently dropped, and still visible through
 *   `RecoveredTurnBanner` for another explicit Resend.
 *
 * ## Re-entrancy
 *
 * `usePendingOutboxResume`'s `resumePending` is guarded by a synchronous
 * ref, the identical discipline `use-composer.ts`'s own `submitLockRef`
 * (FIX-W1) uses, for the identical reason: `useState`-backed "busy" state
 * is only observable after a render, so two synchronous callers in the
 * same tick (two rapid Resend clicks, or a reconnect effect firing while
 * a Resend click's call is still in flight) would otherwise both read
 * "not busy" and both start resending the same candidates. The ref is
 * set before any `await`, and cleared in `finally`, so a thrown/rejected
 * pass never leaves `resumePending` permanently stuck.
 */
import { useCallback, useEffect, useRef } from "react";

import type { composer as coreComposer } from "@picompanion/frontend-core";

import type { AgentTurnClient, SendAgentMessageOptions } from "./agent-turn-client.js";

/** The narrow slice of `OutboxController` this module needs to resend `pending` entries. */
export interface PendingOutboxResumeSource {
  getAutoResendCandidates(sessionId?: string): Promise<coreComposer.OutboxEntry[]>;
  markSending(id: string): Promise<coreComposer.OutboxEntry | null>;
  markSent(id: string): Promise<void>;
  markFailed(
    id: string,
    error: string,
    options?: coreComposer.MarkFailedOptions,
  ): Promise<coreComposer.OutboxEntry | null>;
}

interface ResendablePrompt {
  text: string;
  clientMessageId?: string;
  attachments?: SendAgentMessageOptions["attachments"];
}

/**
 * Narrows a `"prompt"`-kind outbox entry's opaque `payload` to what this
 * module needs to resend it — mirrors the shape `use-composer.ts`'s
 * `submit()` enqueues (`{ text, clientMessageId, attachments }`) and
 * Android's `resumePendingTurnOutboxEntries`'s own `payload as { text?:
 * unknown }` narrowing. `null` for any other kind, or a `"prompt"` entry
 * with no string `text` (defensive; never produced by `use-composer.ts`
 * today).
 */
function readPromptPayload(entry: coreComposer.OutboxEntry): ResendablePrompt | null {
  if (entry.kind !== "prompt") return null;
  const payload = entry.payload as {
    text?: unknown;
    clientMessageId?: unknown;
    attachments?: unknown;
  } | null;
  const text = typeof payload?.text === "string" ? payload.text : null;
  if (text === null) return null;
  const clientMessageId =
    typeof payload?.clientMessageId === "string" ? payload.clientMessageId : undefined;
  const attachments = Array.isArray(payload?.attachments)
    ? (payload.attachments as SendAgentMessageOptions["attachments"])
    : undefined;
  return { text, clientMessageId, attachments };
}

/**
 * Resends every `sessionId`-scoped `"pending"` entry in `outbox` over
 * `client`, reusing each entry's original `clientMessageId`. A plain
 * async function (no React), so it is directly unit-testable and so
 * `usePendingOutboxResume` below adds nothing but the re-entrancy guard
 * and the reconnect/mount trigger on top of it.
 *
 * Never throws past its own boundary: a per-entry send failure is caught
 * and turned into `markFailed`, matching
 * `resumePendingTurnOutboxEntries`'s own "never throws" contract. Entries
 * are resent in `getAutoResendCandidates`'s own order (oldest first,
 * `outbox.ts`'s `loadAll` sorts by `createdAt`), one at a time — never
 * concurrently — so two entries for the same session cannot race each
 * other's send.
 */
export async function resumePendingOutboxEntries(
  client: AgentTurnClient,
  sessionId: string,
  outbox: PendingOutboxResumeSource,
): Promise<void> {
  const candidates = await outbox.getAutoResendCandidates(sessionId);
  for (const entry of candidates) {
    const prompt = readPromptPayload(entry);
    if (!prompt) continue;
    await outbox.markSending(entry.id);
    try {
      await client.sendAgentMessage(sessionId, prompt.text, {
        ...(prompt.clientMessageId ? { messageId: prompt.clientMessageId } : {}),
        ...(prompt.attachments && prompt.attachments.length > 0
          ? { attachments: prompt.attachments }
          : {}),
      });
      await outbox.markSent(entry.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Idempotency is not independently re-verified for a resend either,
      // so this parks back in `awaiting-confirmation` rather than
      // auto-resending — the same conservative default `use-composer.ts`'s
      // own first-send `markFailed` call uses.
      await outbox.markFailed(entry.id, message);
    }
  }
}

export interface UsePendingOutboxResumeOptions {
  /** The live turn client, or `undefined` with no connection. */
  client: AgentTurnClient | undefined;
  sessionId: string;
  /** The same `OutboxController` instance the composer and `RecoveredTurnBanner` share. */
  outbox: PendingOutboxResumeSource | undefined;
  /**
   * `hosts.HostControllerConnectionInfo["status"]` (or an equivalent
   * status string) for this session's live connection. When supplied, a
   * value of `"connected"` triggers `resumePending()` automatically —
   * the reconnect half of Android's behaviour contract (cold start and
   * every later reconnect). Omit to drive resend purely from explicit
   * calls (e.g. only the banner's Resend action).
   */
  connectionStatus?: string;
}

export interface UsePendingOutboxResumeResult {
  /**
   * Resends every `pending` entry once, if `client`/`outbox` are both
   * present; otherwise a no-op. Safe to call from multiple sites (a
   * Resend click, the reconnect effect below): a call made while a
   * previous call from *this hook instance* is still in flight is a
   * silent no-op rather than a second, concurrent pass — see this
   * module's own "Re-entrancy" doc section.
   */
  resumePending: () => Promise<void>;
}

/**
 * React binding over `resumePendingOutboxEntries` above: adds the
 * synchronous in-flight guard and an optional `connectionStatus`-driven
 * effect that fires the same resend on every transition into
 * `"connected"`.
 *
 * The effect firing again on a plain remount (rather than only a true
 * reconnect) is deliberate and cheap, matching this file's own doc
 * comment ("on reconnect/mount if that is cheap and safe"): a remount
 * cannot itself cause a *duplicate send* the way a naive implementation
 * could, because by the time any second call's own
 * `getAutoResendCandidates()` read runs, an entry a still-in-flight first
 * call already reached `markSending`/`markSent` on is no longer
 * `"pending"` — `OutboxController.getAutoResendCandidates` (`outbox.ts`)
 * only ever returns `"pending"` entries, so a resolved or in-flight
 * candidate simply is not read again.
 */
export function usePendingOutboxResume(
  options: UsePendingOutboxResumeOptions,
): UsePendingOutboxResumeResult {
  const { client, sessionId, outbox, connectionStatus } = options;

  const inFlightRef = useRef(false);

  const resumePending = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    if (!client || !outbox) return;
    inFlightRef.current = true;
    try {
      await resumePendingOutboxEntries(client, sessionId, outbox);
    } finally {
      inFlightRef.current = false;
    }
  }, [client, outbox, sessionId]);

  useEffect(() => {
    if (connectionStatus !== "connected") return;
    void resumePending();
  }, [connectionStatus, resumePending]);

  return { resumePending };
}
