/**
 * React-facing "edit from here" call site (T105, plan.md §11.1).
 *
 * `packages/frontend-core/src/sessions/tree-edit-shortcut.ts` (T38A1b)
 * was complete, tested, and reachable through
 * `@picompanion/frontend-core`'s `sessions` barrel (the P6-W3 merge-gate
 * fix), but nothing in either app ever called it — "a route is not a
 * caller". This hook is that call: the one place `apps/web` actually
 * invokes `sessions.editFromHere`, turning a click on a user message's
 * "Edit from here" button (`message-row.tsx`) into a real daemon fork
 * request and a real `SessionTreeNode`.
 *
 * ## What "real" means here, and the gap it does not close
 *
 * `client` is deliberately a narrow, OPTIONAL `EditFromHereForkClient`
 * rather than `@picompanion/client`'s full `DaemonClient` — mirroring
 * `features/sessions/daemon-sessions-client.ts`'s own disclosed gap for
 * `forkSession`/`forkAgent` (T38A3): no `fork_agent_request` wire
 * message exists in `@picompanion/protocol` today, so a real
 * `DaemonClient` never implements it, and this hook's `client` stays
 * `undefined` in production until a protocol+client task closes that gap
 * (T38A3 nominated T51A, or a split of it, as the natural owner — this
 * task changes nothing about that). Until then, calling `editFromHere`
 * on a valid target with no client reports "not connected" rather than
 * silently doing nothing; an INVALID target (no predecessor, e.g.) is
 * still rejected before ever reaching `client` at all, via frontend-core's
 * own `InvalidEditFromHereTargetError`.
 *
 * Once a fork resolves, this hook does exactly what `tree-edit-shortcut.ts`'s
 * module doc says `editFromHere` is for: it builds the real
 * `SessionTreeNode` through frontend-core's own `editFromHere` — never
 * hand-built here, see that module's "composition, not duplication"
 * section — using the daemon-assigned `agentId`, and hands the caller
 * back the fork's `SessionTreeNode`, `forkPoint`, and `draftText`. That is
 * the value arriving, not merely a resolved promise: `use-edit-from-
 * here.test.ts` asserts the outcome is a real `kind: "fork"` node whose
 * `agentId` is the daemon's own assigned id and whose `draftText` is the
 * edited message's original text, produced by the real frontend-core
 * function — a mutation that swaps that call for a hand-built object
 * fails that assertion (see this file's test for the mutation proof).
 *
 * `parent` is synthesized as a fresh root (`createRootSession`) rather
 * than resolved against this session's full ancestor chain: that chain
 * is built and owned by `features/sessions/`'s tree-state module
 * (`session-tree-state.ts`, T38A3), a different directory this task does
 * not own or edit. A synthesized root still produces a structurally
 * valid fork (`kind: "fork"`, correct `forkPoint`, correct `agentId`) —
 * only `.node.parent`/`.node.root` describe a one-level tree rather than
 * this session's real recorded ancestry. DISCLOSED GAP: a caller that
 * wants this fork placed correctly in `SessionsScreen`'s full tree view
 * must re-resolve it there (that screen already knows how to place a
 * `SessionRelationship` — see its own `handleForked`); wiring this hook's
 * outcome into that screen is out of this task's Owns line
 * (`apps/web/src/features/sessions/` is off-limits for this task, per
 * T105's own coordination note).
 */
import { useCallback, useMemo, useRef, useState } from "react";

import type { Clock, timeline } from "@picompanion/frontend-core";
import { sessions as coreSessions } from "@picompanion/frontend-core";

import { buildEditFromHereTargets } from "./edit-from-here-target.js";
import type { EditFromHereTargetIndex } from "./edit-from-here-target.js";

/**
 * DISCLOSED GAP (mirrors `daemon-sessions-client.ts`'s `DaemonAgentClient.
 * forkAgent`, T38A3): no browser-facing wire message exists for this yet,
 * so a real `DaemonClient` never implements it today. Declared narrowly
 * and structurally here — not imported from `features/sessions/` — so
 * this file stays decoupled from that directory's own owned shape; a
 * real `DaemonClient` that grows a compatible `forkAgent` the day the
 * wire gap closes can be adapted to this shape with no change to this
 * hook (see `host-session-screen.tsx`'s adapter).
 */
export interface EditFromHereForkClient {
  forkAgent(
    sourceSessionId: string,
    options: { entryId: string; entryIndex: number; name?: string | null },
  ): Promise<{ agentId: string }>;
}

export interface EditFromHereOutcome {
  /** The session this edit-from-here branched from. */
  readonly sourceSessionId: string;
  /** The new session's id, assigned by `client.forkAgent`. */
  readonly newSessionId: string;
  /** The fork point `resolveEditFromHereForkPoint` derived from the edited message. */
  readonly forkPoint: coreSessions.SessionForkPoint;
  /** The edited message's original text, for prefilling the new session's composer. */
  readonly draftText: string;
  /**
   * The `SessionTreeNode` frontend-core's own `editFromHere` produced —
   * see this file's module doc for what its `.parent`/`.root` do and do
   * not describe.
   */
  readonly node: coreSessions.SessionTreeNode;
}

export interface UseEditFromHereOptions {
  /** The session being edited from. */
  sessionId: string;
  /** The transcript entries `edit-from-here-target.ts` derives fork targets from. */
  entries: readonly timeline.TranscriptEntry[];
  clock: Clock;
  /** See this file's module doc's "what 'real' means here" section. `undefined` until a real wire message exists. */
  client?: EditFromHereForkClient;
  onForked: (outcome: EditFromHereOutcome) => void;
}

export interface EditFromHereController {
  /** Targets currently answerable from `entries` — also usable by a caller to enable/disable the affordance per row. */
  targets: EditFromHereTargetIndex;
  /** Attempts to edit-from-here at `messageId`. A no-op while another attempt is already in flight. */
  editFromHere: (messageId: string) => void;
  isForking: boolean;
  /** The most recent failure's message, or `null`. Cleared at the start of the next attempt. */
  error: string | null;
}

export function useEditFromHere(options: UseEditFromHereOptions): EditFromHereController {
  const { sessionId, entries, clock, client, onForked } = options;
  const targets = useMemo(() => buildEditFromHereTargets(entries), [entries]);

  const [isForking, setIsForking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forkingRef = useRef(false);

  const editFromHere = useCallback(
    (messageId: string) => {
      if (forkingRef.current) return;

      const target = targets.get(messageId);
      if (!target) {
        setError("That message can't be edited from here.");
        return;
      }

      let forkPoint: coreSessions.SessionForkPoint;
      try {
        forkPoint = coreSessions.resolveEditFromHereForkPoint(target);
      } catch (resolveError) {
        setError(resolveError instanceof Error ? resolveError.message : String(resolveError));
        return;
      }

      if (!client) {
        setError("Not connected — can't branch this conversation yet.");
        return;
      }

      forkingRef.current = true;
      setIsForking(true);
      setError(null);

      client
        .forkAgent(sessionId, { entryId: forkPoint.messageId, entryIndex: forkPoint.index })
        .then((forked) => {
          const parent = coreSessions.createRootSession({
            agentId: sessionId,
            createdAt: clock.now(),
          });
          // The real frontend-core call — see this file's module doc for
          // why nothing here hand-builds the fork node instead.
          const result = coreSessions.editFromHere({
            parent,
            agentId: forked.agentId,
            createdAt: clock.now(),
            target,
          });
          forkingRef.current = false;
          setIsForking(false);
          onForked({
            sourceSessionId: sessionId,
            newSessionId: forked.agentId,
            forkPoint: result.forkPoint,
            draftText: result.draftText,
            node: result.node,
          });
        })
        .catch((forkError: unknown) => {
          forkingRef.current = false;
          setIsForking(false);
          setError(forkError instanceof Error ? forkError.message : String(forkError));
        });
    },
    [client, clock, onForked, sessionId, targets],
  );

  return { targets, editFromHere, isForking, error };
}
