import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FakeAgentTurnClient } from "./test-doubles.js";
import { useSlashCommands } from "./use-slash-commands.js";

const COMMANDS = [
  { name: "help", description: "Show help", argumentHint: "" },
  { name: "compact", description: "Compact the conversation", argumentHint: "[reason]" },
] as const;

describe("useSlashCommands", () => {
  it("starts with an empty command list and closed palette", () => {
    const { result } = renderHook(() =>
      useSlashCommands({ sessionId: "session-1", draftText: "" }),
    );

    expect(result.current.commands).toEqual([]);
    expect(result.current.isOpen).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("stays at an empty list when no client is wired (no client yet seam), never erroring", () => {
    const { result } = renderHook(() =>
      useSlashCommands({ sessionId: "session-1", draftText: "/help" }),
    );

    expect(result.current.commands).toEqual([]);
    expect(result.current.isOpen).toBe(false);
  });

  it("loads the daemon-provided command list once a listCommands-capable client is wired", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = COMMANDS;

    const { result } = renderHook(() =>
      useSlashCommands({ sessionId: "session-1", client, draftText: "" }),
    );

    await waitFor(() => expect(result.current.commands).toEqual(COMMANDS));
    expect(client.listCommandsCalls).toEqual(["session-1"]);
  });

  it("auto-opens once the whole draft is a bare slash prefix and commands are loaded", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = COMMANDS;

    const { result, rerender } = renderHook(
      ({ draftText }) => useSlashCommands({ sessionId: "session-1", client, draftText }),
      { initialProps: { draftText: "" } },
    );
    await waitFor(() => expect(result.current.commands).toEqual(COMMANDS));
    expect(result.current.isOpen).toBe(false);

    rerender({ draftText: "/" });
    expect(result.current.isOpen).toBe(true);

    rerender({ draftText: "/comp" });
    expect(result.current.isOpen).toBe(true);

    // Once a space starts an argument, the bare-prefix auto-trigger no
    // longer applies (though a manual `open()` still would).
    rerender({ draftText: "/compact done" });
    expect(result.current.isOpen).toBe(false);
  });

  it("stays closed for a bare slash prefix when there are no commands to offer", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = [];

    const { result, rerender } = renderHook(
      ({ draftText }) => useSlashCommands({ sessionId: "session-1", client, draftText }),
      { initialProps: { draftText: "" } },
    );

    rerender({ draftText: "/" });
    expect(result.current.isOpen).toBe(false);
  });

  it("dismiss() closes an auto-triggered palette and stays closed while still in the same slash prefix", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = COMMANDS;

    const { result, rerender } = renderHook(
      ({ draftText }) => useSlashCommands({ sessionId: "session-1", client, draftText }),
      { initialProps: { draftText: "/" } },
    );
    await waitFor(() => expect(result.current.isOpen).toBe(true));

    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);

    // Still typing within the same dismissed slash prefix: an explicit
    // dismissal is not fought by every further keystroke.
    rerender({ draftText: "/h" });
    expect(result.current.isOpen).toBe(false);

    // Leaving the bare-prefix shape entirely (clearing the draft) and
    // retyping "/" is a fresh trigger.
    rerender({ draftText: "" });
    rerender({ draftText: "/" });
    expect(result.current.isOpen).toBe(true);
  });

  it("open() shows the palette manually even without a bare slash prefix", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = COMMANDS;

    const { result } = renderHook(() =>
      useSlashCommands({ sessionId: "session-1", client, draftText: "hello there" }),
    );
    await waitFor(() => expect(result.current.commands).toEqual(COMMANDS));
    expect(result.current.isOpen).toBe(false);

    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.dismiss());
    expect(result.current.isOpen).toBe(false);
  });

  it("surfaces a listCommands failure without throwing", async () => {
    const client = new FakeAgentTurnClient();
    client.listCommandsError = "provider unavailable";

    const { result } = renderHook(() =>
      useSlashCommands({ sessionId: "session-1", client, draftText: "" }),
    );

    await waitFor(() => expect(result.current.error).toBe("provider unavailable"));
    expect(result.current.commands).toEqual([]);
  });

  it("ignores an in-flight listCommands resolution after the agent changes", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = COMMANDS;
    let resolveFirst: (() => void) | undefined;
    const firstCall = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const originalListCommands = client.listCommands.bind(client);
    client.listCommands = async (agentId: string) => {
      if (agentId === "session-a") await firstCall;
      return originalListCommands(agentId);
    };

    const { result, rerender } = renderHook(
      ({ sessionId }) => useSlashCommands({ sessionId, client, draftText: "" }),
      { initialProps: { sessionId: "session-a" } },
    );

    rerender({ sessionId: "session-b" });
    await waitFor(() => expect(result.current.commands).toEqual(COMMANDS));

    resolveFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The stale session-a resolution must not clobber session-b's result.
    expect(result.current.commands).toEqual(COMMANDS);
  });
});
