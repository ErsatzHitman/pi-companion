/**
 * plan.md §14.3: "disconnect and catch up" (§7.4's "restore a stale
 * cached tail without marking it authoritative" / "reconcile ... not
 * only when it closes" invariants). Exercises the one already-wired,
 * live-`DaemonClient`-backed surface this task can reach without
 * touching a file outside `apps/web/e2e/`: `root-route.tsx`'s session
 * rail (`SessionRailContent`, T53A3), whose `useSessionListSync`
 * (`use-session-list-sync.ts`) marks the rail `stale` the instant the
 * connection leaves `"connected"`, and re-fetches (clearing `stale`)
 * the moment it returns.
 *
 * **T31B5 finding, since fixed (batch-F merge).** The rail's very
 * first `fetchSessions()` used to miss the seeded session entirely, so
 * this spec never even reached its offline branch. T53A4 wired a live
 * client into the sessions screen, but a second, independent gap sat
 * underneath it: `apps/web`'s one app-wide `DaemonClient`
 * (`apps/web/src/app/daemon-client-context.tsx`) never set `appVersion`,
 * so every hello omitted it. The ported daemon
 * (`packages/server/src/server/session.ts`) used to gate every agent
 * listing/lookup path (`listAgentPayloads`'s `isProviderVisibleToClient`
 * filter, and `getAgentPayloadById`) on
 * `clientSupportsAllProviders(this.appVersion)`, i.e.
 * `isAppVersionAtLeast(appVersion, "0.1.45")` -- `false` for a `null`
 * `appVersion`. `"pi"` was not one of the grandfathered
 * `LEGACY_PROVIDER_IDS`, so every `"pi"` agent -- the only provider this
 * product has -- was invisible to `fetch_agents`/single-agent lookup for
 * every real browser connection. Session *creation* was unaffected (no
 * visibility check there), which is why `seed-session.ts`'s seed client
 * could create an agent no live app screen could then see. Closed by
 * `daemon-client-context.tsx`'s `DAEMON_APP_VERSION` (T31B1/T31B3); the
 * same root cause also blocked `deep-link-restore.spec.ts` and
 * `keyboard-navigation.spec.ts`.
 *
 * CORRECTED (T262): the `isProviderVisibleToClient`/`LEGACY_PROVIDER_IDS`
 * gate described above is now retired entirely (`isProviderVisibleToClient`
 * is an unconditional `true`) because this product's provider registry has
 * always been pi-only. `DAEMON_APP_VERSION` remains declared for
 * `session.ts`'s separate, still-real `clientUsesLegacyWorkspaceRestore`
 * gate; see `plan.md` §18 item 13.
 */
import { expect, test } from "./fixtures/test.js";
import { connectViaUi } from "./fixtures/connect-ui.js";
import { seedSession } from "./fixtures/seed-session.js";

test.describe("disconnect and catch up", () => {
  test("the session rail marks itself stale while offline and catches back up once reconnected", async ({
    page,
    context,
    daemonConnection,
  }) => {
    test.slow();
    await connectViaUi(page, daemonConnection, "Reconnect Daemon");

    const session = await seedSession({ address: daemonConnection.address, provider: "pi" });
    try {
      await page.goto(`${daemonConnection.webBaseUrl}/h/e2e-host`);

      const sessionRail = page.getByRole("navigation", { name: "Sessions" });
      const row = sessionRail.getByTestId(`shell-session-rail-row-${session.agentId}`);
      // Confirms the rail did a real, live `fetchSessions()` round trip
      // against the daemon (not a fixture/empty default) before this
      // test ever goes offline.
      await expect(row).toBeVisible({ timeout: 15_000 });

      await context.setOffline(true);
      try {
        // `HostController`'s connection drops out of `"connected"`, so
        // `useSessionListSync` marks the rail stale immediately (it does
        // not wait for a failed fetch -- see that hook's own doc
        // comment).
        await expect(sessionRail.getByTestId("shell-session-rail-stale-banner")).toBeVisible({
          timeout: 20_000,
        });
        // Stale, not cleared: the already-known row is still shown, per
        // plan.md §7.4's "restore a stale cached tail without marking it
        // authoritative".
        await expect(row).toBeVisible();
      } finally {
        await context.setOffline(false);
      }

      // Once the socket can reconnect, the daemon is re-probed and the
      // list is reconciled again -- the stale banner clears and the
      // session is still present (catch-up completed, not just
      // "connection restored").
      await expect(sessionRail.getByTestId("shell-session-rail-stale-banner")).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(row).toBeVisible();
    } finally {
      await session.close();
    }
  });
});
