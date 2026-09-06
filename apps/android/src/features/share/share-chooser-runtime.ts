/**
 * Application-facing runtime over `createShareIntentReceiver` (T69).
 *
 * `share-intent-receiver.ts` (T36E) already does all of the real
 * orchestration a share needs — subscribing to a `ShareIntentPort`,
 * classifying, presenting, resolving against a candidate session list,
 * and materializing a draft. Two things it deliberately does not do,
 * because they are chooser-*screen* concerns rather than "wire the port
 * to the model" ones:
 *
 *   1. Its `getCandidateSessionIds` is a fixed function supplied once at
 *      construction; nothing lets a caller refresh the known session
 *      list *after* construction as fresh data arrives (a real fetch
 *      completing on `../../app/share.tsx`'s own mount, in production).
 *      This module wraps that function in a mutable cell a caller pushes
 *      new ids into via `setCandidateSessionIds`, without rebuilding the
 *      receiver or losing whatever chooser state is already in flight.
 *   2. Its `onEvent` is one fixed callback, chosen at construction. React
 *      needs a `subscribe` shape it can attach *after* construction and
 *      detach on unmount — the same shape every other live store in this
 *      app already exposes (`daemon-connection-store.ts`,
 *      `pi-ui-session.ts`, `settings-model.ts`'s controller).
 *
 * Nothing here classifies content, decides a session id is still valid,
 * or writes a draft itself — every one of those stays exactly where
 * T36C/T36E/T36F already built and proved it. This module owns no new
 * *rule*, only the two structural adapters above between a receiver
 * built for plain injection and a screen built for React.
 */
import {
  createShareIntentReceiver,
  type ShareIntentReceiverDeps,
  type ShareIntentReceiverEvent,
} from "./share-intent-receiver.js";
import type { ShareChooserState } from "./share-session-chooser.js";

/** Everything a `ShareChooserRuntime` needs from its caller — the receiver's own deps, minus the two this module supplies itself (see the module doc comment). */
export type ShareChooserRuntimeDeps = Omit<
  ShareIntentReceiverDeps,
  "getCandidateSessionIds" | "onEvent"
>;

export interface ShareChooserSnapshot {
  state: ShareChooserState;
  /** The receiver event that produced this snapshot, or `null` for the initial (pre-`start()`) idle snapshot. */
  lastEvent: ShareIntentReceiverEvent | null;
}

export interface ShareChooserRuntime {
  /** See `ShareIntentReceiver.start` — subscribes, then reads the launch intent. Idempotent. */
  start(): Promise<void>;
  /** See `ShareIntentReceiver.stop`. Safe to call whether or not `start()` ran. */
  stop(): void;
  getState(): ShareChooserState;
  getSnapshot(): ShareChooserSnapshot;
  /**
   * Replaces the set of session ids `presentShareForChoice`/`chooseSession`
   * validate against (`share-session-chooser.ts`). Safe to call before or
   * after `start()`, and repeatedly — e.g. every time a fresh
   * `sessionService.refreshSessions()` resolves. Takes effect on the
   * *next* presentation or resolution; it never mutates a chooser that is
   * already open mid-render.
   */
  setCandidateSessionIds(ids: readonly string[]): void;
  /**
   * Notified with the new snapshot after every state change this
   * runtime's receiver makes (a presentation, a resolution, a
   * cancellation, a refusal). Fires synchronously from whatever call
   * produced the event — no queued batching. Returns an unsubscribe
   * function.
   */
  subscribe(listener: (snapshot: ShareChooserSnapshot) => void): () => void;
  resolveChoice(sessionId: string): Promise<void>;
  dismiss(): void;
}

/**
 * Builds a `ShareChooserRuntime` over a real (or, in tests, scripted-fake)
 * `ShareIntentPort` and `ShareDraftDeps` — see this module's doc comment
 * for exactly what it adds over `createShareIntentReceiver` itself.
 */
export function createShareChooserRuntime(deps: ShareChooserRuntimeDeps): ShareChooserRuntime {
  let candidateSessionIds: readonly string[] = [];
  const listeners = new Set<(snapshot: ShareChooserSnapshot) => void>();

  const receiver = createShareIntentReceiver({
    ...deps,
    getCandidateSessionIds: () => candidateSessionIds,
    onEvent: (event) => {
      const next: ShareChooserSnapshot = { state: receiver.getState(), lastEvent: event };
      snapshot = next;
      for (const listener of listeners) listener(next);
    },
  });

  let snapshot: ShareChooserSnapshot = { state: receiver.getState(), lastEvent: null };

  return {
    start: () => receiver.start(),
    stop: () => receiver.stop(),
    getState: () => receiver.getState(),
    getSnapshot: () => snapshot,
    setCandidateSessionIds(ids) {
      candidateSessionIds = ids;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolveChoice: (sessionId) => receiver.resolveChoice(sessionId),
    dismiss: () => receiver.dismiss(),
  };
}
