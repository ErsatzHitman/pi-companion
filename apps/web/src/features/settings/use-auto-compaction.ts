import { useCallback, useEffect, useState } from "react";

import type { AgentSettingState } from "./agent-setting-state.js";
import { DAEMON_DEFAULT_AUTO_COMPACTION_ENABLED } from "./settings-client.js";
import type { SettingsClient } from "./settings-client.js";

/**
 * Auto-compaction setting control (T38B2, plan.md §11.1's "queues and
 * automation" RPC group's `set_auto_compaction`). Shaped after
 * `use-queue-modes.ts`'s hook/availability pair — see
 * `agent-setting-state.ts` for what each `availability` value means and
 * `settings-client.ts`'s header comment for the full "which world" audit
 * this control is built against (world 3: no wire message, no
 * `DaemonClient` method, for either setting in this feature).
 *
 * Same "re-fetch the authoritative value rather than guess it locally"
 * discipline `use-model-thinking.ts`/`use-queue-modes.ts` already use for
 * their own "round-trips and persists" criterion: `setEnabled` below
 * calls `client.setAutoCompaction`, then calls `client.getAutoCompaction`
 * again and trusts THAT result — never the value the caller asked for.
 * This is what makes the round trip provable against a counting fake
 * "through the real path, not by local state changing": a fake whose
 * `setAutoCompaction` is skipped (or whose internal state that
 * `getAutoCompaction` reads is never mutated) leaves the re-fetched
 * value unchanged, and this hook's `enabled` stays at its old value even
 * though the caller asked for a new one.
 */
export interface UseAutoCompactionOptions {
  /** Conversation target this control reads/changes (session or agent id). */
  agentId: string;
  /** Live settings client; both methods on it are themselves optional. */
  client?: SettingsClient;
}

const REQUIRED_METHODS = ["getAutoCompaction", "setAutoCompaction"] as const;

function supportsAutoCompaction(client: SettingsClient): boolean {
  return REQUIRED_METHODS.every((method) => typeof client[method] === "function");
}

export function useAutoCompaction({
  agentId,
  client,
}: UseAutoCompactionOptions): AgentSettingState {
  const [availability, setAvailability] = useState<AgentSettingState["availability"]>("no-client");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [enabled, setEnabledValue] = useState<boolean | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const supported = client ? supportsAutoCompaction(client) : false;

  useEffect(() => {
    setEnabledValue(null);
    setChangeError(null);

    if (!client) {
      setAvailability("no-client");
      setUnavailableReason("Connect to a daemon to change auto-compaction.");
      return;
    }
    if (!supported) {
      setAvailability("unsupported");
      setUnavailableReason(
        `This connection cannot change auto-compaction yet. Pi's own default is auto-compaction ` +
          `${DAEMON_DEFAULT_AUTO_COMPACTION_ENABLED ? "on" : "off"} for a new session.`,
      );
      return;
    }

    setAvailability("loading");
    setUnavailableReason(null);
    let cancelled = false;

    client.getAutoCompaction!(agentId)
      .then((value) => {
        if (cancelled) return;
        setEnabledValue(value);
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
  }, [client, agentId]);

  const setEnabled = useCallback(
    async (next: boolean): Promise<void> => {
      if (!client?.setAutoCompaction || !client.getAutoCompaction || isChanging) return;
      setIsChanging(true);
      setChangeError(null);
      try {
        await client.setAutoCompaction(agentId, next);
        const refreshed = await client.getAutoCompaction(agentId);
        setEnabledValue(refreshed);
      } catch (cause) {
        setChangeError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setIsChanging(false);
      }
    },
    [client, isChanging, agentId],
  );

  return {
    availability,
    unavailableReason,
    enabled,
    isChanging,
    changeError,
    setEnabled,
  };
}
