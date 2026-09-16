import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CoreProvider } from "../../app/core-context.js";
import { routeTree } from "../route-tree.js";

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

  /**
   * UI-X3: the connection badge and the session's Files/Terminal links
   * used to render in `Shell`'s header; the header's right side now
   * matches the reference pixel for pixel (settings gear only), so both
   * moved onto this route — the gear's own destination since T131 —
   * carrying their `shell-files-link`/`shell-terminal-link` testids with
   * them. This test runs with the default (no-provider) `client: null`,
   * same as the theme test above, so there is no agent to resolve yet;
   * the Navigation section's own truthful empty note is what proves it
   * never renders a dead link rather than silently omitting the section.
   */
  it("mounts the Connection and Navigation sections the header used to carry", async () => {
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
      await screen.findByRole("heading", { name: "Connection" }, { timeout: 15_000 }),
    ).toBeTruthy();
    expect(document.querySelector(".connection-status")).toBeTruthy();

    expect(screen.getByRole("heading", { name: "Navigation" })).toBeTruthy();
    // No agent resolved yet (no live client in this test) — a truthful note,
    // never a dead Files/Terminal link.
    expect(screen.queryByTestId("shell-files-link")).toBeNull();
    expect(screen.queryByTestId("shell-terminal-link")).toBeNull();
    expect(screen.getByText("Open a session to reach its files and terminal.")).toBeTruthy();
  }, 20_000);
});
