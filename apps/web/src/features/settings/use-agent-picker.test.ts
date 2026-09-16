import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DaemonClient } from "@picompanion/client";

import { useAgentPicker } from "./use-agent-picker.js";

/**
 * WEB-SETTINGS-1: moved from `routes/screens/host-settings-screen.test.tsx`
 * alongside `useAgentPicker` itself — see that hook's module doc for why
 * its former sibling `useCurrentAgentId` was deleted rather than kept.
 */
describe("useAgentPicker (per-agent settings picker)", () => {
  it("stays idle with a null client", () => {
    const { result } = renderHook(() => useAgentPicker(null));
    expect(result.current.status).toBe("idle");
    expect(result.current.selectedAgentId).toBeNull();
  });

  it("lists agents most-recent-first and defaults the selection to the first", async () => {
    const fakeClient = {
      fetchAgents: async (query: unknown) => {
        expect(query).toEqual({
          sort: [{ key: "updated_at", direction: "desc" }],
          page: { limit: 50 },
        });
        return {
          entries: [
            { agent: { id: "agent-2", title: "Second" } },
            { agent: { id: "agent-1", title: null } },
          ],
        };
      },
    } as unknown as DaemonClient;

    const { result } = renderHook(() => useAgentPicker(fakeClient));

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.agents.map((agent) => agent.id)).toEqual(["agent-2", "agent-1"]);
    expect(result.current.selectedAgentId).toBe("agent-2");
  });

  it("follows the user's explicit choice instead of resetting to most-recent", async () => {
    const fakeClient = {
      fetchAgents: async () => ({
        entries: [{ agent: { id: "agent-1" } }, { agent: { id: "agent-2" } }],
      }),
    } as unknown as DaemonClient;

    const { result } = renderHook(() => useAgentPicker(fakeClient));

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.selectedAgentId).toBe("agent-1");

    act(() => {
      result.current.selectAgent("agent-2");
    });
    expect(result.current.selectedAgentId).toBe("agent-2");
  });

  it("reports empty truthfully when the host has no agents yet", async () => {
    const fakeClient = {
      fetchAgents: async () => ({ entries: [] }),
    } as unknown as DaemonClient;

    const { result } = renderHook(() => useAgentPicker(fakeClient));

    await waitFor(() => {
      expect(result.current.status).toBe("empty");
    });
    expect(result.current.selectedAgentId).toBeNull();
  });

  // Merge gate: `useAgentPicker`'s `catch` branch — the one that sets
  // `status: "error"` and surfaces `cause.message` as `reason` — is rendered
  // to the user by `host-settings-screen.tsx`'s "Agent" `Section`, but the
  // only test in the tree that drove a rejecting `fetchAgents` belonged to
  // the redundant `useCurrentAgentId` this wave deleted. Deleting a hook is
  // not a reason to lose coverage of a live branch its survivor also has.
  it("reports 'error' truthfully when fetchAgents rejects, without throwing", async () => {
    const fakeClient = {
      fetchAgents: async () => {
        throw new Error("host unreachable");
      },
    } as unknown as DaemonClient;

    const { result } = renderHook(() => useAgentPicker(fakeClient));

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.reason).toBe("host unreachable");
    expect(result.current.selectedAgentId).toBeNull();
    expect(result.current.agents).toEqual([]);
  });
});
