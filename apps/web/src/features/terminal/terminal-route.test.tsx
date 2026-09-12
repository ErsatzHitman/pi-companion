import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

// A real `client` prop mounts `TerminalView`, which dynamically imports
// `@xterm/xterm` — not meaningfully constructible under jsdom (no
// `HTMLCanvasElement.getContext`), so this file mocks it the same
// minimal way `terminal-view.test.tsx` does for its own, more detailed
// coverage of that wiring.
const { FakeTerminal, FakeFitAddon } = vi.hoisted(() => {
  class FakeFitAddonImpl {
    fit(): void {}
  }
  class FakeTerminalImpl {
    rows = 24;
    cols = 80;
    constructor(_options: Record<string, unknown>) {}
    loadAddon(): void {}
    open(el: HTMLElement): void {
      el.setAttribute("data-fake-xterm-mounted", "true");
    }
    write(_data: unknown, callback?: () => void): void {
      callback?.();
    }
    reset(): void {}
    onData() {
      return { dispose: () => {} };
    }
    onResize() {
      return { dispose: () => {} };
    }
    dispose(): void {}
    focus(): void {}
  }
  return { FakeTerminal: FakeTerminalImpl, FakeFitAddon: FakeFitAddonImpl };
});
vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: FakeFitAddon }));

const { TerminalRoute } = await import("./terminal-route.js");
const { NEW_TERMINAL_ROUTE_SEGMENT } = await import("./terminal-route-params.js");

afterEach(cleanup);

/**
 * A `SessionTerminalClient` double. `TerminalView` only needs the
 * `TerminalRpcClient` slice; the two workspace RPCs let the route resolve
 * a real terminal id.
 */
class FakeSessionTerminalClient {
  constructor(
    private readonly terminals: Array<{ id: string; name: string }> = [],
    private readonly createdId = "term-new",
  ) {}

  listTerminals = vi.fn(async () => ({ terminals: this.terminals }));
  createTerminal = vi.fn(async () => ({
    terminal: { id: this.createdId, name: "Terminal" },
    error: null,
  }));

  async subscribeTerminal(terminalId: string) {
    return { terminalId, slot: 0, error: null };
  }
  unsubscribeTerminal(): void {}
  sendTerminalInput(): void {}
  onTerminalStreamEvent(): () => void {
    return () => {};
  }
}

/**
 * `TerminalRoute` renders terminal-switcher `Link`s, so it has to mount
 * inside a real router; the terminal path itself is registered so the
 * links resolve.
 */
function renderTerminalRoute(props: {
  serverId: string;
  agentId: string;
  terminalId: string;
  client?: InstanceType<typeof FakeSessionTerminalClient>;
  workspaceRoot?: string;
}) {
  const rootRoute = createRootRoute({
    component: () => <TerminalRoute {...props} />,
  });
  const terminalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/h/$serverId/session/$agentId/terminal/$terminalId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([terminalRoute]),
    history: createMemoryHistory({
      initialEntries: [
        `/h/${props.serverId}/session/${props.agentId}/terminal/${props.terminalId}`,
      ],
    }),
  });
  return { ...render(<RouterProvider router={router} />), router };
}

describe("TerminalRoute", () => {
  it("names the route and waits for a daemon connection when there is no client", async () => {
    renderTerminalRoute({ serverId: "host-42", agentId: "agent-9", terminalId: "term-7" });

    expect(await screen.findByRole("heading", { name: "Terminal" })).toBeTruthy();
    expect(screen.getByTestId("terminal-route-no-client")).toBeTruthy();
    expect(screen.queryByTestId("terminal-view")).toBeNull();
  });

  it("opens an existing terminal the daemon lists for the session", async () => {
    const client = new FakeSessionTerminalClient([{ id: "term-7", name: "Terminal" }]);
    renderTerminalRoute({
      serverId: "host-42",
      agentId: "agent-9",
      terminalId: "term-7",
      client,
      workspaceRoot: "/work",
    });

    await waitFor(() => expect(screen.getByTestId("terminal-view")).toBeTruthy());
    expect(client.listTerminals).toHaveBeenCalledWith("/work");
    expect(client.createTerminal).not.toHaveBeenCalled();
  });

  it("creates and opens a real terminal when the requested id is the 'new' link segment", async () => {
    const client = new FakeSessionTerminalClient([], "term-created");
    const { router } = renderTerminalRoute({
      serverId: "host-42",
      agentId: "agent-9",
      terminalId: NEW_TERMINAL_ROUTE_SEGMENT,
      client,
      workspaceRoot: "/work",
    });

    await waitFor(() => expect(screen.getByTestId("terminal-view")).toBeTruthy());
    expect(client.createTerminal).toHaveBeenCalledWith("/work", "Terminal");
    // The URL is replaced with the real terminal id so a refresh lands on it.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/h/host-42/session/agent-9/terminal/term-created",
      ),
    );
  });

  it("explains a list failure and recovers via Retry", async () => {
    const client = new FakeSessionTerminalClient();
    client.listTerminals.mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce({
      terminals: [{ id: "term-7", name: "Terminal" }],
    });
    renderTerminalRoute({
      serverId: "host-42",
      agentId: "agent-9",
      terminalId: "term-7",
      client,
      workspaceRoot: "/work",
    });
    const user = userEvent.setup();

    const error = await screen.findByTestId("terminal-route-error");
    expect(error.textContent).toMatch(/socket hang up/i);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("terminal-view")).toBeTruthy());
  });

  it("has no axe violations in the waiting state", async () => {
    const { container } = renderTerminalRoute({
      serverId: "host-42",
      agentId: "agent-9",
      terminalId: "term-7",
    });

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
