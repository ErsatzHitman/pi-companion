import { useEffect, useState } from "react";
import type { DaemonClient } from "@picompanion/client";

/**
 * Available agents for the settings picker.
 *
 * WEB-SETTINGS-1: this hook used to have a sibling, `useCurrentAgentId`
 * (formerly on `routes/screens/host-settings-screen.tsx`), that resolved
 * only the single most-recently-updated agent via its own
 * `client.fetchAgents({ ..., page: { limit: 1 } })` call. Both hooks fetched
 * the same host's agents on every settings-screen mount to answer
 * overlapping questions and emitted the identical empty-state string ("No
 * agents on this host yet. Settings apply once an agent exists.") — this
 * hook already resolves the most-recently-updated agent as
 * `agents[0]`/the default `selectedAgentId`, so `useCurrentAgentId` was a
 * strictly redundant second fetch. It was deleted rather than kept
 * alongside this hook.
 *
 * Lists the host's agents (most recently updated first) so a settings
 * screen can offer a real picker and target the chosen agent instead of
 * always the most recent one. `selectedAgentId` defaults to the first
 * entry once loaded and follows the user's explicit choice afterwards — a
 * refresh that drops the selected id falls back to the new first entry
 * rather than holding a stale id.
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
