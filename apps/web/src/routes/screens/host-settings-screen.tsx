import { useEffect, useMemo, useState } from "react";
import type { DaemonClient } from "@picompanion/client";

import { useDaemonClientContext } from "../../app/daemon-client-context.js";
import {
  AgentSettingsPanel,
  ThemePreferenceControl,
  createDaemonSettingsClient,
  useAutoCompaction,
  useAutoRetry,
} from "../../features/settings/index.js";
import { Section, Select } from "../../ui/primitives/index.js";

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
 * Available agents for the settings picker (per-agent settings picker close).
 *
 * `useCurrentAgentId` above stays as the disclosed interim most-recent
 * default; this hook lists the host's agents (most recently updated first)
 * so the screen can offer a real picker and settings target the chosen
 * agent instead of always the most recent one. `selectedAgentId` defaults
 * to the first entry once loaded and follows the user's explicit choice
 * afterwards — a refresh that drops the selected id falls back to the new
 * first entry rather than holding a stale id.
 */
export interface AvailableAgentOption {
  id: string;
  title: string | null;
}

export interface AgentPickerState {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  agents: readonly AvailableAgentOption[];
  selectedAgentId: string | null;
  reason: string | null;
}

const PICKER_IDLE: AgentPickerState = {
  status: "idle",
  agents: [],
  selectedAgentId: null,
  reason: null,
};

export function useAgentPicker(client: DaemonClient | null): AgentPickerState & {
  selectAgent: (agentId: string) => void;
} {
  const [state, setState] = useState<AgentPickerState>(PICKER_IDLE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      setState(PICKER_IDLE);
      setSelectedId(null);
      return;
    }

    setState({ status: "loading", agents: [], selectedAgentId: null, reason: null });
    let cancelled = false;

    client
      .fetchAgents({
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 50 },
      })
      .then((result) => {
        if (cancelled) return;
        const agents: AvailableAgentOption[] = result.entries.map((entry) => ({
          id: entry.agent.id,
          title: (entry.agent as { title?: string | null }).title ?? null,
        }));
        if (agents.length === 0) {
          setSelectedId(null);
          setState({
            status: "empty",
            agents: [],
            selectedAgentId: null,
            reason: "No agents on this host yet. Settings apply once an agent exists.",
          });
          return;
        }
        setSelectedId((current) => {
          const stillThere = current !== null && agents.some((agent) => agent.id === current);
          const next = stillThere ? current : (agents[0]?.id ?? null);
          setState({
            status: "ready",
            agents,
            selectedAgentId: next,
            reason: null,
          });
          return next;
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSelectedId(null);
        setState({
          status: "error",
          agents: [],
          selectedAgentId: null,
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  return {
    ...state,
    selectedAgentId: selectedId ?? state.selectedAgentId,
    selectAgent: (agentId: string) => {
      setSelectedId(agentId);
      setState((current) =>
        current.status === "ready" ? { ...current, selectedAgentId: agentId } : current,
      );
    },
  };
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
 * repository's rules name explicitly). `useAgentPicker` above resolves
 * which agent those settings target (defaulting to the most recent, the
 * same value `useCurrentAgentId` resolves, but changeable through the
 * picker); while there is no client, or no agent yet, the panel still
 * mounts (proving it renders on this route regardless), but both rows
 * render their own truthful `"no-client"` state via `agentId: ""` —
 * `useAutoCompaction`/`useAutoRetry` key off `client` being present, not
 * `agentId` being non-empty, so this never throws.
 */
export function HostSettingsScreen() {
  const { client } = useDaemonClientContext();
  const agent = useCurrentAgentId(client);
  const picker = useAgentPicker(client);

  const settingsClient = useMemo(
    () => (client ? createDaemonSettingsClient(client) : undefined),
    [client],
  );

  const effectiveAgentId = picker.selectedAgentId ?? agent.agentId ?? "";
  const autoCompaction = useAutoCompaction({ agentId: effectiveAgentId, client: settingsClient });
  const autoRetry = useAutoRetry({ agentId: effectiveAgentId, client: settingsClient });

  const pickerOptions =
    picker.status === "ready"
      ? picker.agents.map((option) => ({
          value: option.id,
          label: option.title ? `${option.title} (${option.id})` : option.id,
        }))
      : [];

  return (
    <>
      <Section title="Agent">
        {picker.status === "ready" ? (
          <Select
            label="Agent"
            options={pickerOptions}
            value={effectiveAgentId}
            onChange={(event) => picker.selectAgent(event.target.value)}
            testId="host-settings-agent-picker"
          />
        ) : picker.status === "loading" || picker.status === "idle" ? (
          <p className="pc-agent-settings__note">Loading agents…</p>
        ) : (
          <p className="pc-agent-settings__note">{picker.reason}</p>
        )}
      </Section>
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
