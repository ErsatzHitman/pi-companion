/**
 * Live `pi_notice` queue (T112, plan.md §7.4, §8.3, §11.5).
 *
 * `pi_notice` (`AgentStreamEventPayloadSchema`,
 * `packages/protocol/src/messages.ts`) is the Pi provider's only channel
 * for out-of-band operator-visible warnings and errors — UI-bridge
 * resync requests, steer/follow-up failures, unknown-channel notices,
 * the `setTitle` daemon-only fallback (every
 * `this.emit({ type: "pi_notice", ... })` call site in
 * `packages/server/src/server/agent/providers/pi/agent.ts`). Before T112
 * the daemon produced this event and nothing consumed it (found by the
 * P6-W4 import-graph walk and confirmed by `grep -rn pi_notice`). This
 * store is the live half of the consumer this task adds; see
 * `daemon-pi-notice-client.ts` for how a real `DaemonClient`'s
 * `agent_stream` pushes feed it and `PiNoticeBannerContainer.tsx` for how
 * it is rendered.
 *
 * Mirrors `features/telemetry/session-cost-store.ts`'s
 * "ephemeral, session-scoped, `useSyncExternalStore`-friendly plain
 * class" convention: `getSnapshot()` returns the *same* array reference
 * until the next `ingest`/`dismiss`, so a subscriber using
 * `useSyncExternalStore` never re-renders on an unchanged snapshot.
 *
 * `provider` is kept as a plain `string` here (not the protocol
 * package's `AgentProvider` literal union) deliberately: this store
 * never needs to import `@picompanion/protocol` to stay structurally
 * compatible with a real `pi_notice` event, matching
 * `daemon-pi-notice-client.ts`'s own duck-typed wire boundary.
 */
export type PiNoticeLevel = "info" | "warning" | "error";

/** One rendered `pi_notice`, with a locally allocated stable id. */
export interface PiNoticeEntry {
  readonly id: string;
  readonly level: PiNoticeLevel;
  readonly message: string;
  readonly provider: string;
  readonly source?: string;
  readonly turnId?: string;
}

/**
 * The slice of a `pi_notice` `AgentStreamEvent`
 * (`@picompanion/protocol/agent-types`) this store reads. A real
 * `pi_notice` event has every one of these fields, so it satisfies this
 * type as-is.
 */
export interface PiNoticeSourceEvent {
  type: "pi_notice";
  provider: string;
  level: PiNoticeLevel;
  message: string;
  source?: string;
  turnId?: string;
}

export type PiNoticeListener = () => void;

/**
 * Cap on how many live notices this store retains per session. A noisy
 * provider (e.g. a steer failure loop) must never grow this without
 * bound for a long-lived session; the oldest entries are dropped first,
 * never the newest.
 */
const MAX_NOTICES = 20;

let idSequence = 0;

/** Ephemeral, session-scoped queue of live `pi_notice` events (T112). */
export class PiNoticeStore {
  private entries: readonly PiNoticeEntry[] = [];
  private readonly listeners = new Set<PiNoticeListener>();

  /** Appends one notice, dropping the oldest once past `MAX_NOTICES`. */
  ingest(event: PiNoticeSourceEvent): void {
    idSequence += 1;
    const entry: PiNoticeEntry = {
      id: `pi_notice_${idSequence}`,
      level: event.level,
      message: event.message,
      provider: event.provider,
      source: event.source,
      turnId: event.turnId,
    };
    this.entries = [...this.entries, entry].slice(-MAX_NOTICES);
    this.notify();
  }

  /** Removes one notice by id (a no-op if it is already gone). */
  dismiss(id: string): void {
    const next = this.entries.filter((entry) => entry.id !== id);
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.notify();
  }

  /** The same array reference until the next `ingest`/`dismiss`. */
  getSnapshot(): readonly PiNoticeEntry[] {
    return this.entries;
  }

  subscribe(listener: PiNoticeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
