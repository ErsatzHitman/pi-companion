import { useCallback, useEffect, useState } from "react";

import type { AgentSettingState } from "./agent-setting-state.js";
import { DAEMON_AUTO_RETRY_ALWAYS_ON } from "./settings-client.js";
import type { SettingsClient } from "./settings-client.js";

/**
 * Auto-retry setting control (T38B2, plan.md §11.1's "queues and
 * automation" RPC group's `set_auto_retry`/`abort_retry`). Same
 * hook/availability shape as `use-auto-compaction.ts` — see that file's
 * doc comment for the shared "re-fetch the authoritative value" round
 * trip discipline and `agent-setting-state.ts` for what each
 * `availability` value means.
 *
 * **Auto-retry's `"unsupported"` explanation is not the same claim as
 * auto-compaction's.** Auto-compaction merely lacks the outer wire/client
 * layer over an already-real daemon-internal toggle
 * (`PiRuntimeSession.setAutoCompaction`). Auto-retry has NO
 * daemon-internal toggle of any kind — see `settings-client.ts`'s header
 * comment for the exact grep results — so today's daemon always retries;
 * there is no "off" state anywhere in this codebase for this control to
 * eventually reach even once a wire message exists. `DAEMON_AUTO_RETRY_ALWAYS_ON`
 * documents that, and the explanation text below says so plainly rather
 * than implying an on/off choice merely awaits a protocol change.
 */
export interface UseAutoRetryOptions {
  /** Conversation target this control reads/changes (session or agent id). */
  agentId: string;
  /** Live settings client; both methods on it are themselves optional. */
  client?: SettingsClient;
}

const REQUIRED_METHODS = ["getAutoRetry", "setAutoRetry"] as const;

function supportsAutoRetry(client: SettingsClient): boolean {
  return REQUIRED_METHODS.every((method) => typeof client[method] === "function");
}

export function useAutoRetry({ agentId, client }: UseAutoRetryOptions): AgentSettingState {
  const [availability, setAvailability] = useState<AgentSettingState["availability"]>("no-client");
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [enabled, setEnabledValue] = useState<boolean | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const supported = client ? supportsAutoRetry(client) : false;

  useEffect(() => {
    setEnabledValue(null);
    setChangeError(null);

    if (!client) {
      setAvailability("no-client");
      setUnavailableReason("Connect to a daemon to change auto-retry.");
      return;
    }
    if (!supported) {
      setAvailability("unsupported");
      setUnavailableReason(
        DAEMON_AUTO_RETRY_ALWAYS_ON
          ? "This daemon always retries automatically; there is no way to disable it yet."
          : "This connection cannot change auto-retry.",
      );
      return;
    }

    setAvailability("loading");
    setUnavailableReason(null);
    let cancelled = false;

    client.getAutoRetry!(agentId)
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
      if (!client?.setAutoRetry || !client.getAutoRetry || isChanging) return;
      setIsChanging(true);
      setChangeError(null);
      try {
        await client.setAutoRetry(agentId, next);
        const refreshed = await client.getAutoRetry(agentId);
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
