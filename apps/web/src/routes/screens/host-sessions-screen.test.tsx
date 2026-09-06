import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

afterEach(cleanup);

import { CoreProvider } from "../../app/core-context.js";
import { routeTree } from "../route-tree.js";

/**
 * Warm the lazy route chunk BEFORE any assertion is timed.
 *
 * `lazyRouteComponent` resolves a dynamic import on first render, and vitest
 * transforms that module graph on demand, per worker. Cold, that costs ~7s for
 * a single route here, so it used to land inside `findBy*` and consumed most of
 * the 15s budget; under worker contention it exceeded it and this file failed
 * in roughly half of full-suite runs. Warming the module registry moves the
 * transform out of the timed window instead of hiding it behind a bigger
 * number, so the assertion timeout still means "the route failed to render".
 *
 * The route still goes through `lazyRouteComponent`, so what this file asserts
 * -- that the boundary delivers rendered content -- is unchanged.
 */
beforeAll(async () => {
  await import("./host-sessions-screen.js");
}, 120_000);

/**
 * T27B2: proves `HostSessionsScreen` (wired through the real, production
 * `routeTree`, the same way `host-session-files-screen.test.tsx`
 * exercises the files screen) renders the sessions feature rather than
 * the old `RoutePlaceholder` stub. `features/sessions/SessionsScreen
 * .test.tsx` covers the feature's own create/open behavior in depth
 * with an injected fake client; this only proves the route delivers it.
 */
describe("HostSessionsScreen route wiring (T27B2)", () => {
  it("renders the sessions feature's heading and create-session trigger", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/h/host-1/sessions"] }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    // Same generous ceiling as the files route test: the lazy chunk's
    // first dynamic `import()` in a fresh test process runs past
    // vitest's default 1000ms `findBy*`/5s test timeouts.
    expect(
      await screen.findByRole("heading", { name: "Sessions" }, { timeout: 15_000 }),
    ).toBeTruthy();
    expect(screen.getByTestId("create-session-trigger")).toBeTruthy();
    expect(screen.getByTestId("session-list-empty")).toBeTruthy();
  }, 20_000);
});
