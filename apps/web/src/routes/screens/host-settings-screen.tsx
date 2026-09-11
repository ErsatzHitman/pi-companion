import { useEffect, useMemo, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import type { DaemonClient } from "@picompanion/client";

import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import {
  AgentSettingsPanel,
  ThemePreferenceControl,
  createDaemonSettingsClient,
  useAutoCompaction,
  useAutoRetry,
} from "../../features/settings/index.js";
import { Section } from "../../ui/primitives/index.js";
import { RoutePlaceholder } from "../../ui/route-placeholder.js";

const routeApi = getRouteApi("/h/$serverId/settings");

/**
 * Resolved agent context for the settings panel: which agent these
 * settings apply to (or why none is available yet).
 */
export interface CurrentAgentState {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  agentId: string | null;
  reason: string | null;
}

const IDLE_STATE: CurrentAgentState = { status: "idle", agentId: null, reason: null };

/**
 * T131: `AgentSettingsPanel`'s controls are per-agent
 * (`SettingsClient.getAutoCompaction(agentId, ...)`), but this route is
 * per-server (`/h/:serverId/settings`, plan.md §8.2) with no `agentId`
 * param — the exact closing seam T38B2's doc comment on this file left
 * for whoever mounted the panel: "pick an agentId for this screen (there
 * is none in scope today)".
 *
 * Closed here the same way `daemon-client-context.tsx`'s
 * `mostRecentlyConnected` already picks "the" profile to reconnect among
 * several candidates: the most recently updated agent on this daemon,
 * via `client.fetchAgents({ sort: [{ key: "updated_at", direction: "desc"
 * }], page: { limit: 1 } })`. This is a deliberate, disclosed interim
 * choice for a host-level settings screen with no other agent context to
 * go on — not a claim that every agent on a host shares one
 * auto-compaction/auto-retry value (they do not; `SettingsClient` is
 * itself scoped per `agentId`). A future task that adds a real per-agent
 * settings surface (or an agent picker on this screen) replaces this
 * function outright; nothing about `AgentSettingsPanel`, `useAutoCompaction`,
 * or `useAutoRetry` needs to change for that, since all three already take
 * a plain `agentId` string.
 */
export function useCurrentAgentId(client: DaemonClient | null): CurrentAgentState {
  const [state, setState] = useState<CurrentAgentState>(IDLE_STATE);

  useEffect(() => {
    if (!client) {
      setState(IDLE_STATE);
      return;
    }

    setState({ status: "loading", agentId: null, reason: null });
    let cancelled = false;

    client
      .fetchAgents({
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 1 },
      })
      .then((result) => {
        if (cancelled) return;
        const first = result.entries[0];
        if (!first) {
          setState({
            status: "empty",
            agentId: null,
            reason: "No agents on this host yet. Settings apply once an agent exists.",
          });
          return;
        }
        setState({ status: "ready", agentId: first.agent.id, reason: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          agentId: null,
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  return state;
}

/**
 * `/h/:serverId/settings` screen body (T27S2 placeholder, T38B2 built the
 * settings surface, T131 mounts it here).
 *
 * `AgentSettingsPanel` (auto-compaction / auto-retry toggles) is wired to
 * `useDaemonClientContext()`'s live client (T53A1) through
 * `createDaemonSettingsClient` — see that adapter's doc comment for which
 * of the two settings has a real wire today (auto-compaction, since T131;
 * auto-retry remains `"unsupported"`, disclosed and gated, never an
 * enabled control whose value silently dies — the P6-W7 defect this
 * repository's rules name explicitly). `useCurrentAgentId` above resolves
 * which agent those settings target; while there is no client, or no
 * agent yet, the panel still mounts (proving it renders on this route
 * regardless), but both rows render their own truthful `"no-client"`
 * state via `agentId: ""` — `useAutoCompaction`/`useAutoRetry` key off
 * `client` being present, not `agentId` being non-empty, so this never
 * throws.
 */
export function HostSettingsScreen() {
  const { serverId } = routeApi.useParams();
  const { client, info } = useDaemonClientContext();
  const agent = useCurrentAgentId(client);

  const settingsClient = useMemo(
    () => (client ? createDaemonSettingsClient(client) : undefined),
    [client],
  );

  const effectiveAgentId = agent.agentId ?? "";
  const autoCompaction = useAutoCompaction({ agentId: effectiveAgentId, client: settingsClient });
  const autoRetry = useAutoRetry({ agentId: effectiveAgentId, client: settingsClient });

  return (
    <>
      <RoutePlaceholder title="Settings" params={{ serverId, connection: info.status }} />
      {agent.status === "empty" || agent.status === "error" ? (
        <p className="pc-agent-settings__note">{agent.reason}</p>
      ) : null}
      {/*
        The Theme control is a real, persisted System/Light/Dark choice
        (`features/settings/ThemePreferenceControl.tsx` +
        `styles/theme-preference.ts`). It lives on this route rather than
        in a slide-over sheet: this route is the one axe/route-coverage
        guards and the header gear links to, and that
        sheet-vs-route shape is a recorded product decision — the
        reference's 420px sheet was not adopted.
      */}
      <Section title="Appearance">
        <ThemePreferenceControl testId="host-settings-theme" />
      </Section>
      <AgentSettingsPanel
        autoCompaction={autoCompaction}
        autoRetry={autoRetry}
        testId="host-settings-agent-settings"
      />
    </>
  );
}
