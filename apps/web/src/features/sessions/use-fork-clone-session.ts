/**
 * Session fork/clone action state (T38A3, plan.md §7.1/§11.1).
 *
 * Mirrors `use-create-session.ts`'s non-optimistic shape rather than
 * `use-session-actions.ts`'s optimistic one: archive/delete *mutate an
 * existing row the caller already renders*, so they can apply an
 * optimistic change and roll it back. Fork/clone *produce a session
 * that doesn't exist yet* — there is nothing to optimistically show
 * until the daemon (or, today, the fake client — see
 * `daemon-sessions-client.ts`'s module doc for the disclosed
 * protocol/client gap) actually assigns it an id, so `onForked`/
 * `onCloned` fire only once the round trip resolves. This also means a
 * failure never has anything to roll back: the source session's own
 * state is never touched by this hook, so "failure leaves the original
 * untouched" (T38A3's acceptance criterion) holds structurally, not
 * just by convention — proved directly in this file's test by asserting
 * the source-session object passed in is never mutated and no
 * `onForked`/`onCloned` fires on a rejected call.
 */
import { useCallback, useRef, useState } from "react";

import {
  SESSIONS_ACTION_UNSUPPORTED,
  type CloneSessionInput,
  type CloneSessionResult,
  type ForkSessionInput,
  type ForkSessionResult,
  type SessionsClient,
} from "./sessions-client.js";
import type { SessionSummary } from "./types.js";

export interface UseForkCloneSessionOptions {
  client: SessionsClient;
  /** Called once a fork resolves, with the source session and the new session + fork point. */
  onForked: (source: SessionSummary, result: ForkSessionResult) => void;
  /** Called if a fork rejects; the source session is never mutated before this fires. */
  onForkFailed: (source: SessionSummary, message: string) => void;
  /** Called once a clone resolves, with the source session and the new session. */
  onCloned: (source: SessionSummary, result: CloneSessionResult) => void;
  /** Called if a clone rejects; the source session is never mutated before this fires. */
  onCloneFailed: (source: SessionSummary, message: string) => void;
}

export interface ForkCloneSessionController {
  /** The id of the session currently being forked FROM, if any. */
  forkingSessionId: string | null;
  /** The id of the session currently being cloned FROM, if any. */
  cloningSessionId: string | null;
  fork: (source: SessionSummary, input: ForkSessionInput) => void;
  clone: (source: SessionSummary, input?: CloneSessionInput) => void;
}

export function useForkCloneSession(
  options: UseForkCloneSessionOptions,
): ForkCloneSessionController {
  const { client, onForked, onForkFailed, onCloned, onCloneFailed } = options;

  const [forkingSessionId, setForkingSessionId] = useState<string | null>(null);
  const forkingRef = useRef<string | null>(null);
  const [cloningSessionId, setCloningSessionId] = useState<string | null>(null);
  const cloningRef = useRef<string | null>(null);

  const fork = useCallback(
    (source: SessionSummary, input: ForkSessionInput): void => {
      if (forkingRef.current) return; // one fork in flight at a time

      forkingRef.current = source.id;
      setForkingSessionId(source.id);

      const request = client.forkSession
        ? client.forkSession(source.id, input)
        : Promise.reject(new Error(SESSIONS_ACTION_UNSUPPORTED));

      request.then(
        (result) => {
          forkingRef.current = null;
          setForkingSessionId(null);
          onForked(source, result);
        },
        (error: unknown) => {
          forkingRef.current = null;
          setForkingSessionId(null);
          onForkFailed(source, error instanceof Error ? error.message : String(error));
        },
      );
    },
    [client, onForked, onForkFailed],
  );

  const clone = useCallback(
    (source: SessionSummary, input?: CloneSessionInput): void => {
      if (cloningRef.current) return; // one clone in flight at a time

      cloningRef.current = source.id;
      setCloningSessionId(source.id);

      const request = client.cloneSession
        ? client.cloneSession(source.id, input)
        : Promise.reject(new Error(SESSIONS_ACTION_UNSUPPORTED));

      request.then(
        (result) => {
          cloningRef.current = null;
          setCloningSessionId(null);
          onCloned(source, result);
        },
        (error: unknown) => {
          cloningRef.current = null;
          setCloningSessionId(null);
          onCloneFailed(source, error instanceof Error ? error.message : String(error));
        },
      );
    },
    [client, onCloned, onCloneFailed],
  );

  return { forkingSessionId, cloningSessionId, fork, clone };
}
