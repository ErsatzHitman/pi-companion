import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { axe } from "jest-axe";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CoreProvider } from "../../app/core-context.js";
import { routeTree } from "../route-tree.js";

afterEach(cleanup);

/**
 * Warm the lazy route chunk BEFORE any assertion is timed — see
 * `host-sessions-screen.test.tsx`'s identical comment for why (a cold
 * `lazyRouteComponent` dynamic import costs seconds in a fresh worker).
 */
beforeAll(async () => {
  await import("./host-screen.js");
}, 120_000);

/**
 * T393: `/h/:serverId` was a `RoutePlaceholder` stub echoing only the
 * `serverId` and the connection status. This proves the route now delivers a
 * real landing — the host's identity, its live connection state, and quick
 * links to its Sessions/Settings/Diagnostics routes — wired through the real,
 * production `routeTree` (as every other `*-screen.test.tsx` here does).
 *
 * No `DaemonClientProvider` is mounted, matching every other route test: the
 * context's documented default (`client: null`, idle info, `hostController:
 * null`) is itself a real state this screen must render honestly, not crash
 * on. The live-connection half is covered at the context level
 * (`daemon-client-context.test.tsx`) and in the real-browser axe sweep for
 * this route; this file proves the screen's own contents and links.
 */
describe("HostScreen route wiring (T393)", () => {
  it("renders the host identity, connection state, and quick links", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/h/host-1"] }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    await screen.findByTestId("host-screen", {}, { timeout: 15_000 });

    // The section heading keeps the landmark the route always had.
    expect(screen.getByRole("heading", { name: "Host" })).toBeTruthy();

    // Identity comes from the URL and the live connection info — never invented.
    expect(screen.getByTestId("host-server-id").textContent).toBe("host-1");
    expect(screen.getByTestId("host-profile-id").textContent).toBe("No saved profile connected");
    expect(screen.getByTestId("host-connection-kind").textContent).toBe("Not established");
    expect(screen.getByTestId("host-connection-status-indicator").textContent).toContain(
      "Not connected",
    );

    // Quick links to the host's real destinations, with real hrefs.
    expect(screen.getByRole("link", { name: "Sessions" }).getAttribute("href")).toBe(
      "/h/host-1/sessions",
    );
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe(
      "/h/host-1/settings",
    );
    expect(screen.getByRole("link", { name: "Diagnostics" }).getAttribute("href")).toBe(
      "/h/host-1/diagnostics",
    );
  }, 20_000);

  it("has no axe violations", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/h/host-1"] }),
    });
    const { container } = render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    await screen.findByTestId("host-screen", {}, { timeout: 15_000 });
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
