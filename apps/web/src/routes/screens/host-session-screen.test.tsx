import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@picompanion/client";

afterEach(cleanup);

import { CoreProvider } from "../../app/core-context.js";
import { routeTree } from "../route-tree.js";
import { adaptEditFromHereForkClient } from "./host-session-screen.js";

/**
 * Warm the lazy route chunk BEFORE any assertion is timed. See
 * `host-sessions-screen.test.tsx` for the full rationale: cold dynamic-import
 * transform (~7s per route) inside `findBy*` made these route files flaky in
 * roughly half of full-suite runs. This moves the cost out of the timed window
 * rather than inflating the timeout to conceal it.
 */
beforeAll(async () => {
  await import("./host-session-screen.js");
}, 120_000);

/**
 * T28B3: proves `HostSessionScreen` (wired through the real, production
 * `routeTree`, the same way `host-session-files-screen.test.tsx` and
 * `host-session-terminal-screen.test.tsx`-equivalent route wiring is
 * proven for their own features) mounts the real composer rather than
 * only the `RoutePlaceholder` stub `apps/web/src/features/composer` is
 * otherwise never reached from. `Composer.test.tsx`/`use-composer.test.ts`
 * cover the feature's own behavior in depth with injected fake clients;
 * this only proves the route delivers it, wired to this app's real
 * `platform.clock`/`platform.structuredStorage` (`ComposerContainer`).
 */
describe("HostSessionScreen route wiring (T28B3)", () => {
  it("renders the composer's labelled input alongside the route placeholder", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ["/h/host-1/session/agent-1"],
      }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    // Same generous, explicit ceiling `host-session-files-screen.test.tsx`
    // uses for a first lazy-route chunk import in a fresh test process.
    expect(await screen.findByLabelText("Message Pi", {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Session" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  }, 20_000);

  /**
   * T105: this route must mount `EditFromHereSurface` (composing the
   * real transcript with the real `editFromHere` call site), not a bare
   * `<Transcript>` — the region this asserts on is the same
   * `data-testid="host-session-transcript"` node either would render
   * with no entries loaded (`Transcript`'s own `EmptyState` fallback), so
   * this only proves the region is mounted at all; deleting the mount
   * line removes it, failing this assertion — see this file's own
   * mutation proof in the task report.
   */
  it("mounts the edit-from-here transcript surface", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ["/h/host-1/session/agent-1"],
      }),
    });
    render(
      <CoreProvider>
        <RouterProvider router={router} />
      </CoreProvider>,
    );

    expect(
      await screen.findByTestId("host-session-transcript", {}, { timeout: 15_000 }),
    ).toBeTruthy();
  }, 20_000);
});

/**
 * T105: `adaptEditFromHereForkClient` is the one place this route adapts
 * a real `DaemonClient` to `features/transcript`'s narrow
 * `EditFromHereForkClient` — see this file's own module doc for why it
 * is a duck-typed structural check rather than an import from
 * `features/sessions/`. `client: null` (every existing production case
 * today, since no real `DaemonClient` implements `forkAgent` yet — the
 * disclosed gap `use-edit-from-here.ts`'s module doc names) must resolve
 * to `undefined`, not throw; a client that *does* implement it must be
 * unwrapped correctly. A mutation that skips the `agent.id` unwrap (e.g.
 * returns `agent` itself as `agentId`) fails the second assertion below —
 * see this file's own mutation proof in the task report.
 */
describe("adaptEditFromHereForkClient (T105)", () => {
  it("returns undefined for a client without forkAgent (today's real DaemonClient)", () => {
    expect(adaptEditFromHereForkClient(null)).toBeUndefined();
    expect(adaptEditFromHereForkClient({} as unknown as DaemonClient)).toBeUndefined();
  });

  it("adapts a client that does implement forkAgent, unwrapping agent.id to agentId", async () => {
    const forkAgent = vi.fn(async (_agentId: string, _options: unknown) => ({
      agent: { id: "forked-agent-7" },
    }));
    const fakeClient = { forkAgent } as unknown as DaemonClient;

    const adapted = adaptEditFromHereForkClient(fakeClient);
    expect(adapted).toBeDefined();

    const result = await adapted!.forkAgent("source-session", { entryId: "m1", entryIndex: 0 });

    expect(forkAgent).toHaveBeenCalledTimes(1);
    expect(forkAgent).toHaveBeenCalledWith("source-session", { entryId: "m1", entryIndex: 0 });
    expect(result).toEqual({ agentId: "forked-agent-7" });
  });
});
