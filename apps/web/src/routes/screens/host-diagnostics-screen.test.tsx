import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CoreProvider } from "../../app/core-context.js";
import { routeTree } from "../route-tree.js";

afterEach(cleanup);

/**
 * Warm the lazy route chunk before any assertion is timed — see
 * `host-sessions-screen.test.tsx`/`host-settings-screen.test.tsx`'s
 * identical comment for why.
 */
beforeAll(async () => {
  await import("./host-diagnostics-screen.js");
}, 120_000);

/**
 * T41B1's "mount it" acceptance criterion: "Registration is not
 * receipt" — this proves `/h/:serverId/diagnostics` resolves through the
 * real, production `routeTree` all the way to `HostDiagnosticsScreen`'s
 * rendered DOM (a value of the mounted kind actually arriving), not
 * merely that a route object exists in `route-tree.ts`.
 *
 * Runs with no `DaemonClientProvider` (same as
 * `host-settings-screen.test.tsx`), so `useDaemonClientContext()`
 * returns its documented disconnected default — this also doubles as
 * this route's own "works while disconnected" proof at the mount level;
 * the exhaustive field-by-field disconnected assertions live in
 * `features/diagnostics/DiagnosticsScreen.test.tsx`.
 */
describe("HostDiagnosticsScreen route wiring (T41B1)", () => {
  it("resolves /h/:serverId/diagnostics to the real DiagnosticsScreen content", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/h/host-1/diagnostics"] }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    expect(await screen.findByTestId("host-diagnostics", {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByTestId("host-diagnostics-connection-status-value").textContent).toBe("idle");
    expect(screen.getByTestId("host-diagnostics-versions-app-version-value").textContent).toBe(
      "0.3.0-beta.2",
    );
  }, 20_000);
});
