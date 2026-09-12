import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CoreProvider } from "../../app/core-context.js";
import { routeTree } from "../route-tree.js";
import { useCurrentAgentId } from "./host-settings-screen.js";
import type { DaemonClient } from "@picompanion/client";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

/**
 * Warm the lazy route chunk before any assertion is timed — see
 * `host-sessions-screen.test.tsx`'s identical comment for why.
 */
beforeAll(async () => {
  await import("./host-settings-screen.js");
}, 120_000);

/**
 * T131: proves `HostSettingsScreen` (wired through the real, production
 * `routeTree`, the same way every other `*-screen.test.tsx` in this
 * directory exercises its route) mounts `AgentSettingsPanel` rather than
 * the old placeholder-only stub — this is the acceptance criterion
 * "`AgentSettingsPanel` is mounted on a real route, proven in the DOM".
 *
 * This test runs with `client: null` (the `DaemonClientContext` default
 * with no provider override — `daemon-client-context.tsx`'s context
 * object itself isn't exported, so a route-level test can't inject a
 * fake connected client the way `AgentSettingsPanel.test.tsx` does at
 * the feature level). That's enough to prove the mount: both rows still
 * render (in their truthful `"no-client"` state) because
 * `useAutoCompaction`/`useAutoRetry` key off `client` presence, not a
 * live connection. The deeper round-trip-through-a-real-client behavior
 * is proven at the feature level (`AgentSettingsPanel.test.tsx`,
 * `use-auto-compaction.test.ts`) and at the wire level
 * (`daemon-client.test.ts`, `session.test.ts`, `agent-manager.test.ts`,
 * `pi/agent.test.ts`) instead, following `host-sessions-screen.test.tsx`'s
 * own stated boundary ("this only proves the route delivers it").
 */
describe("HostSettingsScreen route wiring (T131)", () => {
  it("renders the AgentSettingsPanel with both setting rows", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/h/host-1/settings"] }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    expect(
      await screen.findByTestId("host-settings-agent-settings", {}, { timeout: 15_000 }),
    ).toBeTruthy();
    expect(screen.getByTestId("host-settings-agent-settings-auto-compaction-toggle")).toBeTruthy();
    expect(screen.getByTestId("host-settings-agent-settings-auto-retry-toggle")).toBeTruthy();
  }, 20_000);

  it("mounts the persisted Theme control without the old route placeholder", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/h/host-1/settings"] }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    const theme = (await screen.findByTestId(
      "host-settings-theme",
      {},
      { timeout: 15_000 },
    )) as HTMLSelectElement;
    expect(theme.value).toBe("system");
    // The route's real controls render under the shell's own heading; the
    // leftover `RoutePlaceholder` facts (`host-1` echo, "Settings" title)
    // are gone.
    expect(screen.getByRole("heading", { name: "Host settings" })).toBeTruthy();
    expect(screen.queryByText("host-1")).toBeNull();
  }, 20_000);
});

/**
 * `useCurrentAgentId` is this file's own closing of the "which agent do
 * these per-agent settings target on a per-server route" seam (see the
 * hook's module doc). Proven here in isolation, against a counting fake
 * `fetchAgents`, independent of any route or `DaemonClient` wiring.
 */
describe("useCurrentAgentId (T131)", () => {
  it("stays idle with a null client", () => {
    const { result } = renderHook(() => useCurrentAgentId(null));
    expect(result.current).toEqual({ status: "idle", agentId: null, reason: null });
  });

  it("resolves to the most recently updated agent when one exists", async () => {
    let calls = 0;
    const fakeClient = {
      fetchAgents: async (query: unknown) => {
        calls += 1;
        expect(query).toEqual({
          sort: [{ key: "updated_at", direction: "desc" }],
          page: { limit: 1 },
        });
        return { entries: [{ agent: { id: "agent-42" } }] };
      },
    } as unknown as DaemonClient;

    const { result } = renderHook(() => useCurrentAgentId(fakeClient));

    await waitFor(() => {
      expect(result.current).toEqual({ status: "ready", agentId: "agent-42", reason: null });
    });
    expect(calls).toBe(1);
  });

  it("reports 'empty' truthfully when the host has no agents yet", async () => {
    const fakeClient = {
      fetchAgents: async () => ({ entries: [] }),
    } as unknown as DaemonClient;

    const { result } = renderHook(() => useCurrentAgentId(fakeClient));

    await waitFor(() => {
      expect(result.current.status).toBe("empty");
    });
    expect(result.current.agentId).toBeNull();
    expect(result.current.reason).toMatch(/no agents/i);
  });

  it("reports 'error' truthfully when fetchAgents rejects, without throwing", async () => {
    const fakeClient = {
      fetchAgents: async () => {
        throw new Error("host unreachable");
      },
    } as unknown as DaemonClient;

    const { result } = renderHook(() => useCurrentAgentId(fakeClient));

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.agentId).toBeNull();
    expect(result.current.reason).toBe("host unreachable");
  });
});
