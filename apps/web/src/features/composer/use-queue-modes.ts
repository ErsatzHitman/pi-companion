import { useCallback, useEffect, useState } from "react";

import type { AgentProviderNotice, AgentTurnClient, QueueMode } from "./agent-turn-client.js";

/**
 * Steer/follow-up mode control (T38B1a, plan.md §11.1's "queues and
 * automation", §12.3's "agent-global settings have no change event").
 * Shaped after `use-model-thinking.ts`'s hook/availability pair, applied
 * to the session-wide `QueueMode` pair instead of model/thinking state.
 *
 * `availability` distinguishes *why* the control might have nothing
 * useful to show, the same "unavailable options are explained" treatment
 * `use-model-thinking.ts` established:
 *
 * - `"no-client"`: no live turn-control client is wired at all.
 * - `"unsupported"`: a client is wired but omits `getQueueModes`,
 *   `setSteeringMode`, or `setFollowUpMode`. The control renders a
 *   truthful disabled state rather than one that looks live.
 *   (CORRECTED (P6-W6 merge gate): this said "true of every real
 *   `DaemonClient` as of P6-W6". T110 landed first in that wave, so a
 *   real `DaemonClient` has all three and reaches `"ready"`; this state
 *   now describes only a turn client that omits the group.)
 * - `"loading"`: the initial `getQueueModes` fetch is in flight.
 * - `"error"`: the initial fetch failed; `unavailableReason` carries the
 *   daemon's raw explanation.
 * - `"ready"`: a snapshot has loaded and both modes are visible without
 *   opening anything (native `<select>` always shows its current value
 *   collapsed).
 *
 * **Deliberate deviation from `use-model-thinking.ts`:** that hook's own
 * live-push subscription (`onAgentModelSnapshotChange`) runs independently
 * of its four-method support check, and a push alone can promote
 * `availability` to `"ready"`. This hook's `onQueueModesChange`
 * subscription is gated on `supported` (the three-method check) instead,
 * and never changes `availability` itself. That matters here in a way it
 * does not there: `daemon-agent-turn-client.ts`'s real adapter already
 * provides `onQueueModesChange` today, via the daemon's existing
 * `agent_update` push, independent of the three sends — while
 * `getQueueModes`/`setSteeringMode`/`setFollowUpMode` are a separate
 * capability a turn client may omit. (CORRECTED (P6-W6 merge gate):
 * this said the three "do not exist on a real `DaemonClient` until T110
 * lands"; T110 landed first in this wave. The gating below is still
 * correct and still load-bearing for any client that omits them.) If a
 * push were allowed to promote availability on its own, such a session
 * would show this
 * control as "ready" and apparently changeable the instant any other
 * agent-state broadcast happened to arrive, while every `set*` call
 * silently no-ops — exactly the "enabled control whose only outcome is
 * doing nothing" failure this codebase has shipped three times before
 * (see `host-session-screen.tsx`'s P6-W4 write-up). Gating the
 * subscription on `supported` means a push can only ever update an
 * already-ready control's *values*, never manufacture readiness out of
 * nothing.
 *
 * `steeringNotice`/`followUpNotice` (T127): the daemon's own "this applies
 * from the next turn" explanation attached to a `setSteeringMode`/
 * `setFollowUpMode` change, carried through the same way
 * `use-model-thinking.ts`'s `thinkingNotice` already does for
 * `setThinkingOption` — `AgentTurnClient.setSteeringMode`/`setFollowUpMode`
 * used to return `Promise<void>`, so `daemon-agent-turn-client.ts`'s
 * adapter awaited and discarded the notice a real `DaemonClient` already
 * resolved with (T110). `QueueModePicker.tsx` renders whichever of the two
 * is non-`null`.
 */
export interface UseQueueModesOptions {
  /** Conversation target this control reads/changes (session or agent id). */
  sessionId: string;
  /** Live turn-control client; the three queue-mode methods on it are themselves optional. */
  client?: AgentTurnClient;
}

export type QueueModesAvailability = "no-client" | "unsupported" | "loading" | "ready" | "error";

export interface QueueModesState {
  availability: QueueModesAvailability;
  /** Human explanation for a non-`"ready"` `availability`, or `null` once ready. */
  unavailableReason: string | null;
  /** The session-wide steering-queue mode, or `null` if the provider reports none. */
  steeringMode: QueueMode | null;
  /** The session-wide follow-up-queue mode, or `null` if the provider reports none. */
  followUpMode: QueueMode | null;
  /** `true` while a `setSteeringMode` call is in flight. */
  isChangingSteeringMode: boolean;
  /** `true` while a `setFollowUpMode` call is in flight. */
  isChangingFollowUpMode: boolean;
  /** The most recent change failure, or `null`. Cleared at the start of the next call. */
  changeError: string | null;
  /** A provider notice attached to the most recent successful `setSteeringMode` call (T127, e.g. "this applies from the next turn"), or `null`. */
  steeringNotice: AgentProviderNotice | null;
  /** Same as `steeringNotice`, for the most recent successful `setFollowUpMode` call. */
  followUpNotice: AgentProviderNotice | null;
  /** Changes the steering mode. No-op while `availability !== "ready"` or another change is already in flight. */
  setSteeringMode: (mode: QueueMode) => Promise<void>;
  /** Changes the follow-up mode. Same guards as `setSteeringMode`. */
  setFollowUpMode: (mode: QueueMode) => Promise<void>;
}

const REQUIRED_METHODS = ["getQueueModes", "setSteeringMode", "setFollowUpMode"] as const;

function supportsQueueModes(client: AgentTurnClient): boolean {
  return REQUIRED_METHODS.every((method) => typeof client[method] === "function");
}

export function useQueueModes({ sessionId, client }: UseQueueModesOptions): QueueModesState {
  const [availability, setAvailability] = useState<QueueModesAvailability>("no-client");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [steeringMode, setSteeringModeValue] = useState<QueueMode | null>(null);
  const [followUpMode, setFollowUpModeValue] = useState<QueueMode | null>(null);
  const [isChangingSteeringMode, setIsChangingSteeringMode] = useState(false);
  const [isChangingFollowUpMode, setIsChangingFollowUpMode] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [steeringNotice, setSteeringNotice] = useState<AgentProviderNotice | null>(null);
  const [followUpNotice, setFollowUpNotice] = useState<AgentProviderNotice | null>(null);

  const supported = client ? supportsQueueModes(client) : false;

  // Initial fetch (T38B1a): resets on every agent/client identity change,
  // matching `useModelThinking`'s own subscription lifecycle.
  useEffect(() => {
    setSteeringModeValue(null);
    setFollowUpModeValue(null);
    setChangeError(null);
    setSteeringNotice(null);
    setFollowUpNotice(null);

    if (!client) {
      setAvailability("no-client");
      setUnavailableReason("Connect to a daemon to change the steer/follow-up mode.");
      return;
    }
    if (!supported) {
      setAvailability("unsupported");
      setUnavailableReason("This connection cannot change the steer/follow-up mode.");
      return;
    }

    setAvailability("loading");
    setUnavailableReason(null);
    let cancelled = false;

    client.getQueueModes!(sessionId)
      .then((modes) => {
        if (cancelled) return;
        setSteeringModeValue(modes.steeringMode);
        setFollowUpModeValue(modes.followUpMode);
        setAvailability("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setAvailability("error");
        setUnavailableReason(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `supported` is derived from `client` each render, not independent state.
  }, [client, sessionId]);

  // Live reflection of a change made by another connected client (T38B1a's
  // "reflected here without a manual refresh" criterion). Gated on
  // `supported`, not merely on the method existing — see this file's own
  // doc comment for why that gate matters here specifically.
  useEffect(() => {
    if (!supported || !client?.onQueueModesChange) return;
    return client.onQueueModesChange(sessionId, (modes) => {
      setSteeringModeValue(modes.steeringMode);
      setFollowUpModeValue(modes.followUpMode);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `supported` is derived from `client` each render, not independent state.
  }, [client, sessionId]);

  const refreshModes = useCallback(async (): Promise<void> => {
    if (!client?.getQueueModes) return;
    const modes = await client.getQueueModes(sessionId);
    setSteeringModeValue(modes.steeringMode);
    setFollowUpModeValue(modes.followUpMode);
  }, [client, sessionId]);

  const setSteeringMode = useCallback(
    async (mode: QueueMode): Promise<void> => {
      if (!client?.setSteeringMode || isChangingSteeringMode || isChangingFollowUpMode) return;
      setIsChangingSteeringMode(true);
      setChangeError(null);
      setSteeringNotice(null);
      try {
        const notice = await client.setSteeringMode(sessionId, mode);
        setSteeringNotice(notice);
        await refreshModes();
      } catch (cause) {
        setChangeError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setIsChangingSteeringMode(false);
      }
    },
    [client, isChangingSteeringMode, isChangingFollowUpMode, sessionId, refreshModes],
  );

  const setFollowUpMode = useCallback(
    async (mode: QueueMode): Promise<void> => {
      if (!client?.setFollowUpMode || isChangingSteeringMode || isChangingFollowUpMode) return;
      setIsChangingFollowUpMode(true);
      setChangeError(null);
      setFollowUpNotice(null);
      try {
        const notice = await client.setFollowUpMode(sessionId, mode);
        setFollowUpNotice(notice);
        await refreshModes();
      } catch (cause) {
        setChangeError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setIsChangingFollowUpMode(false);
      }
    },
    [client, isChangingSteeringMode, isChangingFollowUpMode, sessionId, refreshModes],
  );

  return {
    availability,
    unavailableReason,
    steeringMode,
    followUpMode,
    isChangingSteeringMode,
    isChangingFollowUpMode,
    changeError,
    steeringNotice,
    followUpNotice,
    setSteeringMode,
    setFollowUpMode,
  };
}
