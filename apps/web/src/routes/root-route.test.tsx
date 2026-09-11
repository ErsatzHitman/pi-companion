import { cleanup, render, screen, within } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { axe } from "jest-axe";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

afterEach(cleanup);

import { CoreProvider } from "../app/core-context.js";
import { routeTree } from "./route-tree.js";

/**
 * Warm the lazy route chunks these tests exercise before any assertion is
 * timed, matching every other route-tree test's precedent (see
 * `screens/host-sessions-screen.test.tsx`'s doc comment for the full
 * rationale: a cold `lazyRouteComponent` dynamic import costs ~7s in a
 * fresh test process, well past `findBy*`'s default wait).
 */
beforeAll(async () => {
  await Promise.all([
    import("./screens/host-screen.js"),
    import("./screens/host-session-screen.js"),
  ]);
}, 120_000);

function renderAt(path: string) {
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

/**
 * T53A3: `root-route.tsx` fills `Shell`'s `sessionRail`/`extensionRail`
 * slots from live route params instead of leaving them `undefined` (which
 * — see `ui/shell.tsx` — always rendered its own empty-state fallback,
 * regardless of whether a host or session was actually open). No
 * `DaemonClientProvider` is mounted here (matching every other route
 * test's precedent, `route-boundaries.test.tsx` included): these tests
 * prove the rails are *wired*, not that a live daemon round trip works —
 * `daemon-client-context.test.tsx` and each feature's own fixture tests
 * already cover that independently.
 */
describe("root route rail wiring (T53A3)", () => {
  it("fills the session rail once a host is open, and leaves the extension rail on Shell's own fallback with no session open", async () => {
    renderAt("/h/host-1");

    await screen.findByRole("heading", { name: "Host" }, { timeout: 15_000 });

    const sessionRail = screen.getByRole("navigation", { name: "Sessions" });
    // Real content (`SessionRailContent`'s own empty state), not Shell's
    // pre-T53A3 "nothing ever mounted here" state -- distinguishable from
    // it only by which component produced the identical copy.
    expect(within(sessionRail).getByTestId("shell-session-rail-empty")).toBeTruthy();
    // The rail's own chrome (head + search + foot) renders around that
    // empty state.
    expect(within(sessionRail).getByTestId("shell-session-rail-search")).toBeTruthy();
    expect(within(sessionRail).getByTestId("shell-session-rail-foot")).toBeTruthy();

    // The settings gear is this header's inbound link to the settings
    // route, which had no entry point anywhere in the app before it.
    expect(screen.getByTestId("shell-settings-trigger")).toBeTruthy();

    const extensionRail = screen.getByRole("complementary", { name: "Pi extensions" });
    // No `agentId` on this route: nothing for the extension rail to show,
    // so it stays on Shell's own fallback exactly as before this task.
    expect(within(extensionRail).getByTestId("shell-extension-rail-empty")).toBeTruthy();
    expect(extensionRail.getAttribute("data-has-content")).toBe("false");
  }, 20_000);

  it("fills both rails once a session is open: live session navigation on the left, live Pi extension state and meters on the right", async () => {
    renderAt("/h/host-1/session/agent-1");

    await screen.findByLabelText("Message Pi", {}, { timeout: 15_000 });

    const sessionRail = screen.getByRole("navigation", { name: "Sessions" });
    expect(within(sessionRail).getByTestId("shell-session-rail-empty")).toBeTruthy();

    const extensionRail = screen.getByRole("complementary", { name: "Pi extensions" });
    expect(extensionRail.getAttribute("data-has-content")).toBe("true");
    // The live rail's own head sits above the meters/extension content.
    expect(within(extensionRail).getByTestId("shell-live-head").textContent).toContain("Live");
    // `Shell`'s own fallback must be gone now that a real `extensionRail`
    // element is passed, even though that real content is itself empty
    // (no live Pi UI elements without a daemon connection).
    expect(within(extensionRail).queryByTestId("shell-extension-rail-empty")).toBeNull();
    expect(within(extensionRail).getByTestId("pi-extension-rail-empty")).toBeTruthy();
    // The context-window/cache meter (T29C2) and session cost meter
    // (T48A2) both mount alongside it, honestly reporting "unknown"
    // without a live `AgentUsage` stream.
    expect(within(extensionRail).getByRole("heading", { name: "Context" })).toBeTruthy();
    expect(within(extensionRail).getByRole("heading", { name: "Cost" })).toBeTruthy();
  }, 20_000);

  it("keeps both rail regions structurally present at once (plan.md §8.3 three-region layout)", async () => {
    renderAt("/h/host-1/session/agent-1");

    await screen.findByLabelText("Message Pi", {}, { timeout: 15_000 });

    expect(screen.getByTestId("shell-regions")).toBeTruthy();
    // T386: the centre column's own `Section title="Session"` heading was
    // removed — the reference draws a `.main-head` row (title + status pill
    // + chips) with no heading above it, and `Shell` already renders the
    // route's visually-hidden `<h1>` ("Session transcript"). The property
    // this pins is that the centre region is filled by the session route,
    // which the composer's labelled input proves.
    expect(screen.getByLabelText("Message Pi")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Pi extensions" })).toBeTruthy();
  }, 20_000);

  it("has no axe violations with both rails filled with live content", async () => {
    const { container } = renderAt("/h/host-1/session/agent-1");

    await screen.findByLabelText("Message Pi", {}, { timeout: 15_000 });
    await screen.findByRole("heading", { name: "Cost" });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});
