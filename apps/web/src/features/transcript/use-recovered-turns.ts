/**
 * Live-ish view of one session's parked `"awaiting-confirmation"` outbox
 * entries (FIX-W6). `OutboxController` has no change subscription of its
 * own (it is a thin `StructuredStorage` wrapper, `packages/frontend-core/
 * src/composer/outbox.ts`), so this hook re-reads `loadAll(sessionId)` on
 * mount, whenever the source/session identity changes, on an interval
 * (through the injected `Clock`, never a raw `setInterval` — this
 * repository's platform-timing rule, `@picompanion/frontend-core`'s
 * `Clock` doc comment), and whenever a caller-driven action (Resend/Discard)
 * completes — see `refresh`.
 *
 * `host-session-screen.tsx` constructs its `OutboxController` from the same
 * `platform.structuredStorage`/`platform.clock` singleton
 * `ComposerContainer.tsx` feeds `useComposer`'s own outbox (both come from
 * one `useCore()` value, `app/core-context.tsx`), so a submission
 * `use-composer.ts` parks in `awaiting-confirmation` is visible here without
 * either side needing to share one JS object — the underlying storage
 * collection is the same one either way.
 */
import { useCallback, useEffect, useState } from "react";

import type { Clock, composer as coreComposer } from "@picompanion/frontend-core";

import {
  selectRecoveredTurnsForSession,
  type AwaitingConfirmationEntry,
} from "./recovered-turn-model.js";

/** The narrow slice of `OutboxController` this hook needs to list entries. */
export interface RecoveredTurnSource {
  loadAll(sessionId?: string): Promise<coreComposer.OutboxEntry[]>;
}

/** How often this hook re-polls the outbox for a newly parked entry. */
const RECOVERED_TURN_POLL_INTERVAL_MS = 3_000;

export interface UseRecoveredTurnsResult {
  turns: AwaitingConfirmationEntry[];
  /** Re-reads the outbox immediately; call after Resend/Discard settles. */
  refresh: () => void;
}

export function useRecoveredTurns(
  outbox: RecoveredTurnSource | undefined,
  sessionId: string,
  clock: Clock,
): UseRecoveredTurnsResult {
  const [turns, setTurns] = useState<AwaitingConfirmationEntry[]>([]);

  const refresh = useCallback((): void => {
    if (!outbox) {
      setTurns([]);
      return;
    }
    outbox
      .loadAll(sessionId)
      .then((entries) => setTurns(selectRecoveredTurnsForSession(entries, sessionId)))
      .catch(() => {
        // Best-effort, matching this app's other cache/outbox reads: a
        // failed poll leaves the previous, already-rendered state in place
        // rather than surfacing an error banner of its own.
      });
  }, [outbox, sessionId]);

  useEffect(() => {
    refresh();
    if (!outbox) {
      return;
    }
    const handle = clock.setInterval(refresh, RECOVERED_TURN_POLL_INTERVAL_MS);
    return () => clock.clearInterval(handle);
  }, [outbox, sessionId, clock, refresh]);

  return { turns, refresh };
}
