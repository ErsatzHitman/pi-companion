import type { terminal } from "@picompanion/frontend-core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

afterEach(cleanup);

class NoopTerminalRpcClient implements terminal.TerminalRpcClient {
  async subscribeTerminal(terminalId: string) {
    return { terminalId, slot: 0, error: null };
  }
  unsubscribeTerminal(): void {}
  sendTerminalInput(): void {}
  onTerminalStreamEvent(): () => void {
    return () => {};
  }
}

describe("TerminalRoute", () => {
  it("names the route and shows the host/session/terminal identity as visible text", () => {
    render(<TerminalRoute serverId="host-42" agentId="agent-9" terminalId="term-7" />);

    expect(screen.getByRole("heading", { name: "Terminal" })).toBeTruthy();
    expect(screen.getByText("host-42")).toBeTruthy();
    expect(screen.getByText("agent-9")).toBeTruthy();
    expect(screen.getByText("term-7")).toBeTruthy();
  });

  it("shows a waiting state instead of mounting xterm when there is no client yet", () => {
    render(<TerminalRoute serverId="host-42" agentId="agent-9" terminalId="term-7" />);

    expect(screen.getByTestId("terminal-route-no-client")).toBeTruthy();
    expect(screen.queryByTestId("terminal-view")).toBeNull();
  });

  it("mounts the terminal view once a client is supplied", async () => {
    render(
      <TerminalRoute
        serverId="host-42"
        agentId="agent-9"
        terminalId="term-7"
        client={new NoopTerminalRpcClient()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("terminal-view")).toBeTruthy());
    expect(screen.queryByTestId("terminal-route-no-client")).toBeNull();
  });

  it("has no axe violations in the waiting state", async () => {
    const { container } = render(
      <TerminalRoute serverId="host-42" agentId="agent-9" terminalId="term-7" />,
    );

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
