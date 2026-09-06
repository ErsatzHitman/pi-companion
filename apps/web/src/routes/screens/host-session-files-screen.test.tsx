import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

import { CoreProvider } from "../../app/core-context.js";
import { routeTree } from "../route-tree.js";

/**
 * T30B1: proves `HostSessionFilesScreen` (wired through the real,
 * production `routeTree`, the same way `route-boundaries.test.tsx`
 * exercises the other screens) renders the files feature rather than
 * the old `RoutePlaceholder` stub. `features/files/file-browser-screen
 * .test.tsx` covers the feature's own behavior in depth with injected
 * fake clients; this only proves the route delivers it.
 */
describe("HostSessionFilesScreen route wiring (T30B1)", () => {
  it("renders the files feature's breadcrumbs and its default not-connected explanation", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ["/h/host-1/session/agent-1/files/src"],
      }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    // The files route's `lazyRouteComponent` chunk pulls in the whole
    // files feature and `@picompanion/frontend-core`'s barrel; the first
    // dynamic-`import()` transform of that chunk in a fresh test process
    // runs well past the 1000ms default `findBy*` wait (and past vitest's
    // 5s default test timeout). Same generous ceiling the sibling
    // `route-boundaries.test.tsx` lazy-delivery cases use — an explicit
    // timeout, not a weaker assertion.
    expect(await screen.findByRole("heading", { name: "Files" }, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not connected/i);
  }, 20_000);
});
