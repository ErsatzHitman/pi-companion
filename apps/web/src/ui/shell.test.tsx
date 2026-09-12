import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { breakpoints } from "@picompanion/design-tokens";
import { axe } from "jest-axe";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CoreProvider } from "../app/core-context.js";
import { routeTree } from "../routes/route-tree.js";
import type { ShellProps } from "./shell.js";
import { ROUTE_HEADINGS, Shell } from "./shell.js";

/**
 * T27S1 — the three-region web app shell (plan.md §8.3, §11.5).
 *
 * `Shell` renders inside a real router (its header brand is a `<Link>`)
 * and a real `CoreProvider` (the connection badge reads core state), so
 * these tests build a minimal standalone route tree rather than the
 * app's real `routes/route-tree.ts`, which a different T27S2 task owns
 * and is being written concurrently.
 */
function renderShell(
  props: Omit<ShellProps, "children"> & { children?: ReactNode },
  /**
   * The route to mount at, as a `{ pattern, href }` pair. `Shell`'s `<h1>`
   * is keyed by route ID (the path PATTERN, not the resolved href), so a
   * route with parameters needs both halves: the pattern to register and
   * an href that matches it.
   */
  route: { pattern: string; href: string } = { pattern: "/connect", href: "/connect" },
) {
  const rootRoute = createRootRoute({
    component: () => <Shell {...props}>{props.children ?? <div>centre content</div>}</Shell>,
  });
  const leafRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: route.pattern,
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([leafRoute]),
    // The default "/" has no matching route in this minimal tree; land on
    // the one leaf route so the root (and its `Shell`) resolve synchronously.
    history: createMemoryHistory({ initialEntries: [route.href] }),
  });

  const result = render(
    <CoreProvider>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-local router, not the app's registered one */}
      <RouterProvider router={router as any} />
    </CoreProvider>,
  );
  return result;
}

afterEach(cleanup);

describe("Shell", () => {
  it("renders all three regions with empty-state placeholders when no slot content is given", async () => {
    renderShell({});

    expect(await screen.findByRole("navigation", { name: "Sessions" })).toBeTruthy();
    expect(screen.getByTestId("shell-session-rail-empty")).toBeTruthy();
    expect(screen.getByTestId("shell-center").textContent).toContain("centre content");
    const extensionRail = screen.getByRole("complementary", { name: "Pi extensions" });
    expect(within(extensionRail).getByTestId("shell-extension-rail-empty")).toBeTruthy();
    expect(extensionRail.getAttribute("data-has-content")).toBe("false");
  });

  it("lets a feature mount into a named slot without editing the shell", async () => {
    renderShell({
      sessionRail: <div data-testid="session-feature">session list</div>,
      extensionRail: <div data-testid="extension-feature">fleet roster</div>,
      children: <div data-testid="transcript-feature">transcript + composer</div>,
    });

    expect((await screen.findByTestId("session-feature")).textContent).toContain("session list");
    expect(screen.getByTestId("transcript-feature").textContent).toContain("transcript + composer");
    expect(screen.getByTestId("extension-feature").textContent).toContain("fleet roster");
    expect(screen.queryByTestId("shell-session-rail-empty")).toBeNull();
    expect(screen.queryByTestId("shell-extension-rail-empty")).toBeNull();
  });

  it("keeps the extension rail present, full, and not degraded to a status chip once it has content", async () => {
    renderShell({ extensionRail: <div data-testid="fleet">3 agents running</div> });

    const extensionRail = await screen.findByRole("complementary", { name: "Pi extensions" });
    expect(extensionRail.getAttribute("data-has-content")).toBe("true");
    expect(within(extensionRail).getByTestId("fleet")).toBeTruthy();
    // The rail itself is the same element/landmark whether empty or full —
    // "present" per plan §8.3, never swapped for a collapsed status chip.
    expect(extensionRail.className).toContain("shell__rail--extension");
  });

  it("has a working session-list landmark, a main landmark for the centre column, and a brand link back to /connect", async () => {
    renderShell({});

    expect(await screen.findByRole("main")).toBe(screen.getByTestId("shell-center"));
    expect(screen.getByRole("link", { name: "Pi Companion" }).getAttribute("href")).toBe(
      "/connect",
    );
    // The brand mark's tile is decorative (its glyph is `aria-hidden`),
    // so the link's accessible name stays exactly the wordmark.
    expect(screen.getByText("π")).toBeTruthy();
  });

  it("renders no settings gear where there is no host in context", async () => {
    renderShell({});
    await screen.findByRole("navigation", { name: "Sessions" });
    expect(screen.queryByTestId("shell-settings-trigger")).toBeNull();
  });

  it("navigates the header's settings gear to that host's settings route", async () => {
    const gearRootRoute = createRootRoute({
      component: () => (
        <Shell>
          <Outlet />
        </Shell>
      ),
    });
    const settingsRoute = createRoute({
      getParentRoute: () => gearRootRoute,
      path: "/h/$serverId/settings",
      component: () => <div data-testid="settings-route" />,
    });
    const diagnosticsRoute = createRoute({
      getParentRoute: () => gearRootRoute,
      path: "/h/$serverId/diagnostics",
      component: () => null,
    });
    const router = createRouter({
      routeTree: gearRootRoute.addChildren([settingsRoute, diagnosticsRoute]),
      history: createMemoryHistory({ initialEntries: ["/h/srv-1/diagnostics"] }),
    });
    const user = userEvent.setup();
    render(
      <CoreProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-local router, not the app's registered one */}
        <RouterProvider router={router as any} />
      </CoreProvider>,
    );

    const gear = await screen.findByTestId("shell-settings-trigger");
    expect(gear.getAttribute("aria-label")).toBe("Settings");
    await user.click(gear);
    await waitFor(() => expect(router.state.location.pathname).toBe("/h/srv-1/settings"));
    expect(await screen.findByTestId("settings-route")).toBeTruthy();
  });

  it("links the open session to its files and terminal routes", async () => {
    const sessionRootRoute = createRootRoute({
      component: () => (
        <Shell>
          <Outlet />
        </Shell>
      ),
    });
    const sessionRoute = createRoute({
      getParentRoute: () => sessionRootRoute,
      path: "/h/$serverId/session/$agentId",
      component: () => null,
    });
    const filesRoute = createRoute({
      getParentRoute: () => sessionRootRoute,
      path: "/h/$serverId/session/$agentId/files/$",
      component: () => <div data-testid="files-route" />,
    });
    const terminalRoute = createRoute({
      getParentRoute: () => sessionRootRoute,
      path: "/h/$serverId/session/$agentId/terminal/$terminalId",
      component: () => null,
    });
    const router = createRouter({
      routeTree: sessionRootRoute.addChildren([sessionRoute, filesRoute, terminalRoute]),
      history: createMemoryHistory({ initialEntries: ["/h/srv-1/session/agt-1"] }),
    });
    const user = userEvent.setup();
    render(
      <CoreProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-local router, not the app's registered one */}
        <RouterProvider router={router as any} />
      </CoreProvider>,
    );

    const filesLink = await screen.findByTestId("shell-files-link");
    expect(filesLink.getAttribute("href")).toMatch(/\/h\/srv-1\/session\/agt-1\/files\/?$/);
    const terminalLink = screen.getByTestId("shell-terminal-link");
    expect(terminalLink.getAttribute("href")).toBe("/h/srv-1/session/agt-1/terminal/new");

    await user.click(filesLink);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/h/srv-1/session/agt-1/files"),
    );
    expect(await screen.findByTestId("files-route")).toBeTruthy();
  });

  it("shows no session links where there is no open session", async () => {
    renderShell({}, { pattern: "/h/$serverId/diagnostics", href: "/h/srv-1/diagnostics" });
    await screen.findByTestId("shell-settings-trigger");
    expect(screen.queryByTestId("shell-files-link")).toBeNull();
    expect(screen.queryByTestId("shell-terminal-link")).toBeNull();
  });

  it("declares a compact-fallback media query pinned to the design-tokens wide breakpoint", () => {
    // `import.meta.url` is already a real `file:` URL string here; under
    // jsdom, `new URL(x, import.meta.url)` throws `ERR_INVALID_URL_SCHEME`
    // because jsdom's own `URL` class shadows the global, so this resolves
    // the sibling file with `node:path` instead.
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), "shell.css");
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain(`@media (min-width: ${breakpoints.wide}px)`);
  });

  it("T54A2: renders exactly one level-one heading, naming the current route", async () => {
    renderShell({});
    // `renderShell` mounts the shell at `/connect`, so the heading is that
    // route's name rather than the product-name fallback.
    const headings = await screen.findAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]!.textContent).toBe("Connect to a host");
  });

  // P6-W11 merge gate: T41B1 added `/h/$serverId/diagnostics` to
  // `routes/route-tree.ts` but not to `ROUTE_HEADINGS`, so the screen fell
  // through to `useRouteHeading()`'s product-name fallback and rendered
  // `<h1>Pi Companion</h1>`. That fallback's own doc comment enumerates what
  // it is for -- `/`, the 404 and error boundaries, and the dev-only labs --
  // so a real host screen landing there made the comment false as well as
  // costing the route its name. Nothing caught it: no test referenced
  // `ROUTE_HEADINGS` at all. This pins the one route; T138 owns the general
  // completeness assertion over the real route tree, which is what stops the
  // NEXT route repeating it.
  it("T54A2: names the diagnostics route rather than falling back to the product name", async () => {
    renderShell({}, { pattern: "/h/$serverId/diagnostics", href: "/h/srv-1/diagnostics" });
    const headings = await screen.findAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]!.textContent).toBe("Diagnostics");
  });

  it("T54A2: keeps the level-one heading reachable by a screen reader while hiding it visually", async () => {
    renderShell({});
    const heading = await screen.findByRole("heading", { level: 1 });
    // `getByRole` excludes `display: none` / `visibility: hidden` /
    // `aria-hidden` nodes, so resolving it at all is the accessible-name
    // assertion. The clip-rect utility is what keeps it out of the layout.
    expect(heading.className).toBe("pc-visually-hidden");
  });

  it("has no axe violations empty or populated", async () => {
    const { container: empty } = renderShell({});
    await screen.findByRole("navigation", { name: "Sessions" });
    expect(await axe(empty)).toHaveNoViolations();
    cleanup();

    const { container: populated } = renderShell({
      sessionRail: <div>sessions</div>,
      extensionRail: <div>fleet</div>,
    });
    await screen.findByText("sessions");
    expect(await axe(populated)).toHaveNoViolations();
  });
});

/**
 * T138 — `ROUTE_HEADINGS` coverage over the REAL route tree.
 *
 * At P6-W11, T41B1 registered `/h/$serverId/diagnostics` in
 * `routes/route-tree.ts` and never added it to `ROUTE_HEADINGS`, so a real
 * host screen fell through `useRouteHeading()`'s fallback and rendered
 * `<h1>Pi Companion</h1>`. That one route was fixed at the merge gate
 * (`85ed175`) with a pinned test above. Nothing in the repository referenced
 * `ROUTE_HEADINGS` at all before that fix, so nothing would stop the NEXT
 * route repeating it — that is what this block exists to close.
 *
 * Route ids come from `createRouter({ routeTree })`'s own `routesById`
 * (proved against `apps/web/src/routes/route-tree.test.tsx`'s identical
 * pattern before this was written), not a list typed into this file: a
 * hand-maintained copy of the route list is exactly the drift this task
 * exists to detect.
 */
describe("ROUTE_HEADINGS coverage (T138)", () => {
  /**
   * The route ids `useRouteHeading()`'s fallback covers (see `shell.tsx`'s
   * doc comment), named individually rather than inferred by a pattern
   * (e.g. "anything under /dev") -- a rule like that is how this exact gate
   * stops working: the next lab-shaped route that is not a lab would pass
   * without anyone deciding. Adding an id here is a deliberate, reviewable
   * edit to this list, never automatic.
   */
  const EXEMPT_ROUTE_IDS: ReadonlySet<string> = new Set([
    // `rootRoute`'s own id (`createRootRoute`'s implicit `"__root__"`). It
    // wraps every route (`root-route.tsx`) and is also the ONLY id present
    // in `useMatches()` when TanStack Router falls through to
    // `rootRoute`'s `notFoundComponent` for an unmatched path -- there is
    // no leaf route id at all in that case, so this single entry stands in
    // for "the 404" as well as the root wrapper itself.
    "__root__",
    // `/` (`routes/index.tsx`) never renders: its `beforeLoad` throws a
    // redirect to `/connect` before any component -- or heading -- would
    // be produced.
    "/",
    // T25A dev-only component lab (`dev/component-lab-route.tsx`):
    // resolves to a 404-throwing route in production builds and is not a
    // real product screen.
    "/dev/component-lab",
    // T25B dev-only recipe lab (`dev/recipe-lab-route.tsx`), same
    // production-bundle exclusion as the component lab above.
    "/dev/recipe-lab",
  ]);

  function realRouteIds(): string[] {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/connect"] }),
    });
    return Object.keys(router.routesById);
  }

  it("T138: every non-exempt route id in the real route tree has a ROUTE_HEADINGS entry", () => {
    const missing = realRouteIds()
      .filter((id) => !EXEMPT_ROUTE_IDS.has(id))
      .filter((id) => !ROUTE_HEADINGS[id]);
    expect(missing).toEqual([]);
  });

  // Guards the exempt list itself from going stale in the OTHER direction:
  // if a route named here is ever renamed or removed, this fails loudly
  // instead of leaving a dead id that silently widens the exemption.
  it("T138: every exempt route id still exists in the real route tree", () => {
    const ids = new Set(realRouteIds());
    const stale = [...EXEMPT_ROUTE_IDS].filter((id) => !ids.has(id));
    expect(stale).toEqual([]);
  });
});
