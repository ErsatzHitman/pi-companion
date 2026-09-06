import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { axe } from "jest-axe";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

import { CoreProvider } from "../app/core-context.js";
import { NotFoundScreen } from "./not-found-screen.js";

/**
 * Warm the lazy route chunks BEFORE any assertion is timed. See
 * `screens/host-sessions-screen.test.tsx` for the full rationale: cold
 * dynamic-import transform (~7s per route) inside `findBy*` made these route
 * files flaky in roughly half of full-suite runs. The routes still resolve
 * through `lazyRouteComponent`, so the boundary behaviour asserted here is
 * unchanged -- only the transform cost moves out of the timed window.
 */
beforeAll(async () => {
  await Promise.all([
    import("./screens/connect-screen.js"),
    import("./screens/host-session-terminal-screen.js"),
  ]);
}, 120_000);
import { RouteErrorScreen } from "./route-error-screen.js";
import { routeTree } from "./route-tree.js";

/**
 * T27S2: the root route's `notFoundComponent` and `errorComponent`
 * boundaries (plan.md §8.2), plus proof that a route's `lazyRouteComponent`
 * boundary actually delivers rendered content and not just a resolved
 * route id (route-tree.test.tsx only asserts the latter).
 *
 * `Shell` (T27S1) renders `ConnectionStatus`, which needs `CoreProvider`
 * (see `app/App.tsx`); every render of the real `routeTree` here is
 * wrapped the same way `App` wraps it, or the root route's own
 * `errorComponent` boundary would (correctly, but confusingly for these
 * tests) catch that missing-provider error instead of what each test is
 * actually exercising.
 */
function renderRouteTreeAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <CoreProvider>
      <RouterProvider router={router} />
    </CoreProvider>,
  );
}

describe("route boundaries (T27S2)", () => {
  it("renders the not-found screen instead of a blank page for an unknown path", async () => {
    renderRouteTreeAt("/this/path/does/not/exist");

    expect(await screen.findByTestId("route-not-found")).toBeTruthy();
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: /go to connect/i })).toBeTruthy();
  });

  it("has no axe violations on the not-found screen", async () => {
    const { container } = renderRouteTreeAt("/this/path/does/not/exist");
    await screen.findByTestId("route-not-found");

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);

  it.each([
    { path: "/connect", heading: "Connect" },
    { path: "/h/host-1", heading: "Host" },
    { path: "/h/host-1/sessions", heading: "Sessions" },
    { path: "/h/host-1/settings", heading: "Settings" },
  ])(
    "lazily loads and renders the $path screen",
    async ({ path, heading }) => {
      renderRouteTreeAt(path);

      // T27A1's real `/connect` screen lazily pulls in
      // `@picompanion/frontend-core`'s `hosts` module; the first
      // dynamic-`import()` transform of that chunk in a fresh test process
      // can take several seconds, well past the 1000ms default `findBy*`
      // wait. The other cases here resolve well within this generous
      // ceiling too.
      expect(
        await screen.findByRole("heading", { name: heading }, { timeout: 15_000 }),
      ).toBeTruthy();
    },
    20_000,
  );

  it("resolves a deep link straight to a dynamic-segment lazy screen with its params", async () => {
    renderRouteTreeAt("/h/host-42/session/agent-9/terminal/term-7");

    // T30A2: this lazy chunk now also pulls in `@picompanion/frontend-core`'s
    // full barrel (for `terminal.TerminalController`) the first time it
    // transforms, well past testing-library's 1s default wait — an explicit
    // timeout here, not a weaker assertion (plan.md CLAUDE.md test hygiene).
    expect(
      await screen.findByRole("heading", { name: "Terminal" }, { timeout: 15_000 }),
    ).toBeTruthy();
    expect(screen.getByText("host-42")).toBeTruthy();
    expect(screen.getByText("agent-9")).toBeTruthy();
    expect(screen.getByText("term-7")).toBeTruthy();
  }, 20_000);

  it("wires the root route's boundaries to these T27S2 screens", async () => {
    const { rootRoute } = await import("./root-route.js");
    expect(rootRoute.options.notFoundComponent).toBe(NotFoundScreen);
    expect(rootRoute.options.errorComponent).toBe(RouteErrorScreen);
  });
});

describe("NotFoundScreen (T27S2)", () => {
  function renderInMinimalRouter() {
    const isolatedRoot = createRootRoute({ component: NotFoundScreen });
    const router = createRouter({
      routeTree: isolatedRoot,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    return render(<RouterProvider router={router} />);
  }

  it("names the failure and offers a keyboard-operable way back", async () => {
    renderInMinimalRouter();

    await screen.findByTestId("route-not-found");
    const link = screen.getByRole("link", { name: /go to connect/i });
    expect(link.getAttribute("href")).toBe("/connect");
  });
});

describe("RouteErrorScreen (T27S2)", () => {
  function renderInMinimalRouter(error: unknown, reset: () => void) {
    const isolatedRoot = createRootRoute({
      component: () => <RouteErrorScreen error={error as Error} reset={reset} />,
    });
    const router = createRouter({
      routeTree: isolatedRoot,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    return render(<RouterProvider router={router} />);
  }

  it("shows the error message with role=alert so it is announced", async () => {
    renderInMinimalRouter(new Error("synthetic route failure"), () => {});

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This screen failed to load");
    expect(alert.textContent).toContain("synthetic route failure");
    expect(screen.getByTestId("route-error")).toBeTruthy();
  });

  it("falls back to a safe message for a non-Error throw", async () => {
    renderInMinimalRouter("not an Error instance", () => {});

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("An unknown error occurred.");
  });

  it("invokes reset when Try again is activated by keyboard", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    renderInMinimalRouter(new Error("boom"), reset);

    await screen.findByRole("alert");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Try again" }));
    await user.keyboard("{Enter}");

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers a way back to Connect alongside the retry action", async () => {
    renderInMinimalRouter(new Error("boom"), () => {});

    await screen.findByRole("alert");
    const link = screen.getByRole("link", { name: /go to connect/i });
    expect(link.getAttribute("href")).toBe("/connect");
  });

  it("has no axe violations", async () => {
    const { container } = renderInMinimalRouter(new Error("boom"), () => {});
    await screen.findByRole("alert");

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});
