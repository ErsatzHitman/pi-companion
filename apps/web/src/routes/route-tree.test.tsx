import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { routeTree } from "./route-tree.js";

/**
 * Warm every lazy route chunk BEFORE any assertion is timed, exactly as
 * `App.test.tsx`/`route-boundaries.test.tsx` already do (see the rationale
 * recorded there): `router.load()` resolves each route's
 * `lazyRouteComponent` dynamic import, and vitest transforms that module
 * graph on demand, per worker. Cold, the `/connect` chunk alone (it pulls
 * `@picompanion/frontend-core`'s `hosts` module) can exceed this file's
 * 20s per-case ceiling on a loaded machine, which made the first case fail
 * under full-suite contention. Moving the transform outside the timed
 * window keeps that ceiling meaningful instead of raising it to hide the
 * cost; the routes still resolve through `lazyRouteComponent`, so what this
 * file asserts is unchanged.
 */
beforeAll(async () => {
  await Promise.all([
    import("./screens/connect-screen.js"),
    import("./screens/host-screen.js"),
    import("./screens/host-sessions-screen.js"),
    import("./screens/host-session-screen.js"),
    import("./screens/host-session-files-screen.js"),
    import("./screens/host-session-terminal-screen.js"),
    import("./screens/host-settings-screen.js"),
    import("./screens/host-diagnostics-screen.js"),
  ]);
}, 180_000);

/**
 * §8.2 route stubs (plan.md), resolved against the code-based route tree.
 *
 * The daemon's static SPA fallback (T18) and Vite's default `appType:
 * "spa"` are what let a hard refresh on any of these paths reach
 * `index.html` in the first place; once it does, this proves the client
 * router itself resolves each path (including dynamic segments and the
 * files splat) rather than 404ing inside the app.
 */
describe("§8.2 route tree", () => {
  const cases: Array<{ path: string; routeId: string; params: Record<string, string> }> = [
    { path: "/connect", routeId: "/connect", params: {} },
    { path: "/h/host-1", routeId: "/h/$serverId", params: { serverId: "host-1" } },
    {
      path: "/h/host-1/sessions",
      routeId: "/h/$serverId/sessions",
      params: { serverId: "host-1" },
    },
    {
      path: "/h/host-1/session/agent-1",
      routeId: "/h/$serverId/session/$agentId",
      params: { serverId: "host-1", agentId: "agent-1" },
    },
    {
      path: "/h/host-1/session/agent-1/files/src/index.ts",
      routeId: "/h/$serverId/session/$agentId/files/$",
      params: { serverId: "host-1", agentId: "agent-1", _splat: "src/index.ts" },
    },
    {
      path: "/h/host-1/session/agent-1/terminal/term-1",
      routeId: "/h/$serverId/session/$agentId/terminal/$terminalId",
      params: { serverId: "host-1", agentId: "agent-1", terminalId: "term-1" },
    },
    {
      path: "/h/host-1/settings",
      routeId: "/h/$serverId/settings",
      params: { serverId: "host-1" },
    },
    {
      path: "/h/host-1/diagnostics",
      routeId: "/h/$serverId/diagnostics",
      params: { serverId: "host-1" },
    },
  ];

  it.each(cases)(
    "resolves $path to $routeId",
    async ({ path, routeId, params }) => {
      const router = createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: [path] }),
      });
      // T27A1's real `/connect` screen lazily pulls in
      // `@picompanion/frontend-core`'s `hosts` module; the first
      // dynamic-`import()` transform of that chunk in a fresh test process
      // can take several seconds, well past vitest's 5000ms default test
      // timeout, which `router.load()` here would otherwise hit.
      await router.load();
      const match = router.state.matches.at(-1);
      expect(match?.routeId).toBe(routeId);
      expect(match?.params).toMatchObject(params);
    },
    // T30A2: the terminal case's lazy chunk now also loads
    // `@picompanion/frontend-core`'s full barrel (for
    // `terminal.TerminalController`), well past vitest's 5s default the
    // first time it transforms; an explicit timeout, not a weaker
    // assertion.
    20_000,
  );

  it("redirects / to /connect", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    expect(router.state.location.pathname).toBe("/connect");
  }, 20_000);
});
