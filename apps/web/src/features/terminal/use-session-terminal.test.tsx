import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SessionTerminalClient, TerminalSummary } from "./use-session-terminal.js";
import { useSessionTerminal } from "./use-session-terminal.js";

/**
 * A fake `SessionTerminalClient` backed by a mutable terminal list, so a
 * `createTerminal` call shows up in the next `listTerminals` exactly as a
 * real daemon would report it. `createdIds` supplies one id per create.
 */
function makeClient(createdIds: string[]): {
  client: SessionTerminalClient;
  terminals: TerminalSummary[];
} {
  const terminals: TerminalSummary[] = [];
  let created = 0;
  const client: SessionTerminalClient = {
    listTerminals: vi.fn(async () => ({ terminals })),
    createTerminal: vi.fn(async () => {
      const id = createdIds[created] ?? `term-${created + 1}`;
      created += 1;
      const terminal: TerminalSummary = { id, name: "Terminal" };
      terminals.push(terminal);
      return { terminal, error: null };
    }),
    subscribeTerminal: vi.fn(async (terminalId: string) => ({
      terminalId,
      slot: 0,
      error: null,
    })),
    unsubscribeTerminal: vi.fn(),
    sendTerminalInput: vi.fn(),
    onTerminalStreamEvent: vi.fn(() => () => {}),
  };
  return { client, terminals };
}

describe("useSessionTerminal", () => {
  it("stays in no-client until a connection exists", () => {
    const { result } = renderHook(() =>
      useSessionTerminal({ client: null, workspaceRoot: "/work", requestedTerminalId: "new" }),
    );
    expect(result.current.state.status).toBe("no-client");
  });

  it("waits rather than listing against an unresolved workspace root", () => {
    const { client } = makeClient([]);
    const { result } = renderHook(() =>
      useSessionTerminal({ client, workspaceRoot: "", requestedTerminalId: "new" }),
    );
    expect(result.current.state.status).toBe("loading");
    expect(client.listTerminals).not.toHaveBeenCalled();
  });

  it("opens a terminal the daemon already lists", async () => {
    const { client, terminals } = makeClient([]);
    terminals.push({ id: "term-7", name: "Terminal" });
    const { result } = renderHook(() =>
      useSessionTerminal({
        client,
        workspaceRoot: "/work",
        requestedTerminalId: "term-7",
      }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state.terminalId).toBe("term-7");
    expect(client.createTerminal).not.toHaveBeenCalled();
  });

  it("creates a fresh terminal each time the requested id is the new segment", async () => {
    const { client, terminals } = makeClient(["term-a", "term-b"]);
    const { result, rerender } = renderHook(
      ({ request }: { request: string }) =>
        useSessionTerminal({ client, workspaceRoot: "/work", requestedTerminalId: request }),
      { initialProps: { request: "new" } },
    );

    await waitFor(() => expect(result.current.state.terminalId).toBe("term-a"));
    expect(client.createTerminal).toHaveBeenCalledTimes(1);

    // The route replaces the URL with the created id; the list now reports it.
    rerender({ request: "term-a" });
    await waitFor(() => expect(result.current.state.terminalId).toBe("term-a"));
    expect(client.createTerminal).toHaveBeenCalledTimes(1);

    // A second "New terminal" visit must create another, not reopen `term-a`.
    rerender({ request: "new" });
    await waitFor(() => expect(result.current.state.terminalId).toBe("term-b"));
    expect(client.createTerminal).toHaveBeenCalledTimes(2);
    expect(terminals.map((entry) => entry.id)).toEqual(["term-a", "term-b"]);
  });

  it("does not spawn a duplicate terminal under React StrictMode's double effect", async () => {
    const { client } = makeClient(["term-a"]);
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    renderHook(
      () => useSessionTerminal({ client, workspaceRoot: "/work", requestedTerminalId: "new" }),
      { wrapper },
    );

    await waitFor(() => expect(client.createTerminal).toHaveBeenCalled());
    expect(client.createTerminal).toHaveBeenCalledTimes(1);
  });

  it("explains a list failure", async () => {
    const { client } = makeClient([]);
    client.listTerminals = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const { result } = renderHook(() =>
      useSessionTerminal({ client, workspaceRoot: "/work", requestedTerminalId: "new" }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error?.description).toBe("socket hang up");
  });
});
