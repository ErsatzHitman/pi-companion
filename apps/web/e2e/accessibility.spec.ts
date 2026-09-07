/**
 * T44A2 — plan.md §10.5's "Web runs axe checks" acceptance criterion:
 * "Web axe gates pass across every route."
 *
 * Before this file, `expectNoAxeViolations` (`fixtures/axe.ts`) was
 * called from exactly one place — `keyboard-navigation.spec.ts`, on the
 * single session route — which is real coverage of that one route and
 * none of the other eight. This file is a real-browser axe sweep of
 * every OTHER route the app serves, reusing the same fixtures every
 * other T31B/T31C spec already established (`connectViaUi`,
 * `seedSession`) rather than asserting an empty shell: a route that
 * needs a live session or terminal to render anything meaningful gets
 * one seeded through the daemon's public RPC, exactly the way
 * `session-lifecycle.spec.ts`/`terminal.spec.ts` already do.
 *
 * **What makes "every route" a real, checkable claim rather than a list
 * that can quietly go stale:** `fixtures/route-coverage-manifest.ts`
 * (`ROUTE_COVERAGE`) is the one curated list of every route
 * `routes/route-tree.ts` declares, each marked `swept: true` (checked
 * below) or `swept: false` with a written reason (the two dev-only labs,
 * unreachable in the production bundle this harness serves — see that
 * file's own comments). Two independent, both-required mechanisms keep
 * this file and that manifest from drifting apart in either direction:
 *
 * 1. `SWEEPS` below is typed as `Record<SweptRoutePath, RouteSweep>` —
 *    a union derived FROM `ROUTE_COVERAGE` itself (via `as const
 *    satisfies`, see that file's doc comment). `Record` rejects both a
 *    missing key and an excess one, so `npm run typecheck` (this repo's
 *    mandatory gate) fails to build the moment this table and the
 *    manifest name a different set of swept routes — not a possible
 *    future check, a compile error today.
 * 2. `scripts/ci/guard-axe-route-coverage.mjs` independently derives the
 *    real route list from `routes/route-tree.ts` itself (following its
 *    imports, reading each route file's own `path:` literal — never a
 *    hand-typed copy) and fails, in both directions, the moment
 *    `ROUTE_COVERAGE` drifts from THAT. See its own doc comment for the
 *    exact mechanism and its proof.
 *
 * Together: add a route to `route-tree.ts` and forget everything else,
 * and the `scripts/ci` guard fails. Add a manifest entry with
 * `swept: true` and forget to add its sweep here, and `typecheck` fails.
 * There is no path that leaves a route silently unswept.
 */
import type { Page } from "@playwright/test";

import { connectViaUi } from "./fixtures/connect-ui.js";
import { expectNoAxeViolations } from "./fixtures/axe.js";
import { ROUTE_COVERAGE } from "./fixtures/route-coverage-manifest.js";
import { seedSession } from "./fixtures/seed-session.js";
import { expect, test } from "./fixtures/test.js";
import type { DaemonConnection } from "./fixtures/test.js";

type CoverageEntry = (typeof ROUTE_COVERAGE)[number];
/** Every `routePath` this manifest marks `swept: true` — see that file's doc comment. */
type SweptRoutePath = Extract<CoverageEntry, { swept: true }>["routePath"];

type RouteSweep = (args: { page: Page; daemonConnection: DaemonConnection }) => Promise<void>;

/**
 * One entry per swept route. Each visits the real route (seeding
 * whatever precondition it needs through the daemon's public RPC, never
 * bypassing a rule a browser client would also have to satisfy), waits
 * for that route's own stable, route-specific landmark — never a bare
 * timeout — and only then runs the real axe check, so a violation is
 * always asserted against the route's SETTLED render, not a transient
 * loading frame.
 */
const SWEEPS: Record<SweptRoutePath, RouteSweep> = {
  // `index.tsx`'s `beforeLoad` throws a redirect to `/connect` before
  // any component mounts (`route-coverage-manifest.ts`'s comment on this
  // entry). This is the one case that does NOT call `connectViaUi`
  // first: it proves the redirect itself lands on `/connect` and then
  // axe-checks the resulting, not-yet-connected connect screen — a real
  // and distinct DOM state from the "/connect" sweep below, which checks
  // the screen AFTER a successful connect.
  "/": async ({ page, daemonConnection }) => {
    await page.goto(`${daemonConnection.webBaseUrl}/`);
    await expect(page).toHaveURL(`${daemonConnection.webBaseUrl}/connect`);
    await expect(page.getByRole("heading", { name: "Connect", exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
  },

  "/connect": async ({ page, daemonConnection }) => {
    await connectViaUi(page, daemonConnection, "Axe Sweep Daemon");
    // Still on /connect: `connectViaUi` never navigates away, so this
    // checks the CONNECTED state of this route (the "Reached ..." status
    // banner visible), distinct from the pre-connect "/" case above.
    await expect(page.getByTestId("connect-status-banner")).toBeVisible();
    await expectNoAxeViolations(page);
  },

  "/h/$serverId": async ({ page, daemonConnection }) => {
    await connectViaUi(page, daemonConnection, "Axe Sweep Daemon");
    await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host`);
    await expect(page.getByRole("heading", { level: 1, name: "Host overview" })).toBeVisible();
    await expectNoAxeViolations(page);
  },

  "/h/$serverId/sessions": async ({ page, daemonConnection }) => {
    await connectViaUi(page, daemonConnection, "Axe Sweep Daemon");
    await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/sessions`);
    await expect(page.getByRole("heading", { level: 1, name: "Session list" })).toBeVisible();
    await expectNoAxeViolations(page);
  },

  "/h/$serverId/session/$agentId": async ({ page, daemonConnection }) => {
    await connectViaUi(page, daemonConnection, "Axe Sweep Daemon");
    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Session transcript" }),
      ).toBeVisible();
      await expect(page.getByLabel("Message Pi")).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(page);
    } finally {
      await session.close();
    }
  },

  // `files.spec.ts`'s own doc comment records the live gap this route
  // has today: `HostSessionFilesScreen` never resolves a real workspace
  // root, so every listing request sends an empty `cwd` and the daemon
  // refuses it. That is a functional gap, not an excuse to skip this
  // route's axe coverage — whatever state it settles into (today, an
  // error state) is exactly what a real visitor sees, and is what this
  // sweeps.
  "/h/$serverId/session/$agentId/files/$": async ({ page, daemonConnection }) => {
    await connectViaUi(page, daemonConnection, "Axe Sweep Daemon");
    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(
        `${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}/files/`,
      );
      await expect(page.getByRole("heading", { level: 1, name: "Session files" })).toBeVisible();
      await expect(
        page.getByTestId("file-browser-error").or(page.getByTestId("file-browser-empty")),
      ).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(page);
    } finally {
      await session.close();
    }
  },

  "/h/$serverId/session/$agentId/terminal/$terminalId": async ({ page, daemonConnection }) => {
    await connectViaUi(page, daemonConnection, "Axe Sweep Daemon");
    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    // Declared outside `try` (matching `terminal.spec.ts`'s own
    // `openConnectedTerminal` destructure) so the `finally` block below
    // can still call `killTerminal(terminalId)` even if a step inside
    // `try` throws before reaching the end.
    let terminalId: string | undefined;
    try {
      const created = await session.client.createTerminal(session.cwd, "axe-sweep-terminal");
      expect(created.error).toBeNull();
      terminalId = created.terminal!.id;
      await page.goto(
        `${daemonConnection.webBaseUrl}/h/e2e-host/session/${session.agentId}/terminal/${terminalId}`,
      );
      await expect(page.getByRole("heading", { level: 1, name: "Session terminal" })).toBeVisible();
      await expect(page.getByTestId("terminal-view-status")).toContainText("Connected", {
        timeout: 15_000,
      });
      await expectNoAxeViolations(page);
    } finally {
      // `terminal.spec.ts`'s own `finally` blocks explain why this is
      // needed: a real `node-pty` shell outlives route navigation by
      // design, so it is still holding `session.cwd` open when this test
      // ends. `killTerminal` (the same public RPC a real "close terminal"
      // affordance would call) is what actually reclaims the process --
      // without it, `session.close()`'s `rm(cwd, ...)` intermittently
      // fails on Windows with `EBUSY: resource busy or locked` (observed
      // directly while verifying this file).
      if (terminalId) {
        await session.client.killTerminal(terminalId).catch(() => undefined);
      }
      await session.close();
    }
  },

  "/h/$serverId/settings": async ({ page, daemonConnection }) => {
    await connectViaUi(page, daemonConnection, "Axe Sweep Daemon");
    await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Host settings" })).toBeVisible();
    await expect(page.getByTestId("host-settings-agent-settings")).toBeVisible({
      timeout: 15_000,
    });
    await expectNoAxeViolations(page);
  },

  "/h/$serverId/diagnostics": async ({ page, daemonConnection }) => {
    await connectViaUi(page, daemonConnection, "Axe Sweep Daemon");
    await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host/diagnostics`);
    await expect(page.getByRole("heading", { level: 1, name: "Diagnostics" })).toBeVisible();
    await expect(page.getByTestId("host-diagnostics")).toBeVisible({ timeout: 15_000 });
    await expectNoAxeViolations(page);
  },
};

test.describe("web axe sweep — every route (T44A2, plan.md §10.5)", () => {
  for (const entry of ROUTE_COVERAGE) {
    if (!entry.swept) continue;
    const sweep = SWEEPS[entry.routePath as SweptRoutePath];
    test(`axe: ${entry.routePath} — no violations`, async ({ page, daemonConnection }) => {
      test.slow();
      await sweep({ page, daemonConnection });
    });
  }

  // The 404 surface (`root-route.tsx`'s `notFoundComponent`,
  // `not-found-screen.tsx`) is not itself an entry in `route-tree.ts` --
  // it is what the router falls back to for ANY unmatched path -- so it
  // has no `routePath` to carry in `ROUTE_COVERAGE` and is not counted
  // by `scripts/ci/guard-axe-route-coverage.mjs`'s route-tree-derived
  // list. Task T44A2 names it explicitly ("including the error/404
  // surface if it is reachable"), so it is swept here as real, disclosed
  // extra coverage rather than silently left out because the mechanical
  // completeness check above cannot see it.
  test("axe: 404 (unmatched path) — no violations", async ({ page, daemonConnection }) => {
    test.slow();
    await page.goto(`${daemonConnection.webBaseUrl}/this-path-does-not-exist`);
    await expect(page.getByTestId("route-not-found")).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
