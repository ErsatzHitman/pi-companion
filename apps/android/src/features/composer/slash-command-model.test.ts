import { describe, expect, it } from "vitest";

import {
  INITIAL_SLASH_COMMANDS_STATE,
  createSlashCommandsController,
  describeSlashCommand,
  isBareSlashPrefix,
  slashCommandDraftText,
  type DaemonSlashCommandSource,
  type SlashCommand,
} from "./slash-command-model";

const COMMANDS: readonly SlashCommand[] = [
  { name: "help", description: "Show help", argumentHint: "" },
  { name: "compact", description: "Compact the conversation", argumentHint: "[reason]" },
  { name: "review", description: "Review a diff", argumentHint: "", kind: "skill" },
];

/** A counting fake shaped like `DaemonSlashCommandSource` — mirrors web's `FakeAgentTurnClient.listCommands` shape but returns the real payload shape (`{ commands, error }`) `DaemonClient.listCommands` actually resolves. */
function createFakeClient(): DaemonSlashCommandSource & {
  calls: string[];
  commandsToReturn: readonly SlashCommand[];
  errorToReturn: string | null;
  rejectWith: Error | null;
} {
  const fake = {
    calls: [] as string[],
    commandsToReturn: [] as readonly SlashCommand[],
    errorToReturn: null as string | null,
    rejectWith: null as Error | null,
    async listCommands(agentId: string) {
      fake.calls.push(agentId);
      if (fake.rejectWith) throw fake.rejectWith;
      return { commands: fake.commandsToReturn, error: fake.errorToReturn };
    },
  };
  return fake;
}

describe("isBareSlashPrefix", () => {
  it("is true for a bare slash and for a slash plus a space-free token", () => {
    expect(isBareSlashPrefix("/")).toBe(true);
    expect(isBareSlashPrefix("/help")).toBe(true);
    expect(isBareSlashPrefix("/comp")).toBe(true);
  });

  it("is false once a space starts an argument, for empty text, and for text with no leading slash", () => {
    expect(isBareSlashPrefix("")).toBe(false);
    expect(isBareSlashPrefix("hello")).toBe(false);
    expect(isBareSlashPrefix("/compact done")).toBe(false);
    expect(isBareSlashPrefix("/ compact")).toBe(false);
  });
});

describe("slashCommandDraftText / describeSlashCommand", () => {
  it('formats the replacement draft as "/name " with a trailing space', () => {
    expect(slashCommandDraftText(COMMANDS[0])).toBe("/help ");
    expect(slashCommandDraftText(COMMANDS[1])).toBe("/compact ");
  });

  it("appends the argument hint when present, and a skill suffix for skill-sourced commands", () => {
    expect(describeSlashCommand(COMMANDS[0])).toBe("Show help");
    expect(describeSlashCommand(COMMANDS[1])).toBe("Compact the conversation [reason]");
    expect(describeSlashCommand(COMMANDS[2])).toBe("Review a diff · skill");
  });
});

describe("createSlashCommandsController", () => {
  it("starts with an empty command list and closed palette", () => {
    const controller = createSlashCommandsController({ agentId: "session-1" });
    expect(controller.getState()).toEqual(INITIAL_SLASH_COMMANDS_STATE);
  });

  it("stays at an empty list when no client is wired (no client yet seam), never throwing", async () => {
    const controller = createSlashCommandsController({ agentId: "session-1" });
    controller.notifyDraftChanged("/help");
    await controller.load();
    expect(controller.getState().commands).toEqual([]);
    expect(controller.getState().isOpen).toBe(false);
    expect(controller.getState().error).toBeNull();
  });

  it("loads the daemon-provided command list once a listCommands-capable client is wired", async () => {
    const client = createFakeClient();
    client.commandsToReturn = COMMANDS;
    const controller = createSlashCommandsController({ agentId: "session-1", client });

    await controller.load();

    expect(controller.getState().commands).toEqual(COMMANDS);
    expect(client.calls).toEqual(["session-1"]);
  });

  it("auto-opens once the whole draft is a bare slash prefix and commands are loaded", async () => {
    const client = createFakeClient();
    client.commandsToReturn = COMMANDS;
    const controller = createSlashCommandsController({ agentId: "session-1", client });
    await controller.load();
    expect(controller.getState().isOpen).toBe(false);

    controller.notifyDraftChanged("/");
    expect(controller.getState().isOpen).toBe(true);

    controller.notifyDraftChanged("/comp");
    expect(controller.getState().isOpen).toBe(true);

    // Once a space starts an argument, the bare-prefix auto-trigger no
    // longer applies (though a manual open() still would).
    controller.notifyDraftChanged("/compact done");
    expect(controller.getState().isOpen).toBe(false);
  });

  it("stays closed for a bare slash prefix when there are no commands to offer", async () => {
    const client = createFakeClient();
    client.commandsToReturn = [];
    const controller = createSlashCommandsController({ agentId: "session-1", client });
    await controller.load();

    controller.notifyDraftChanged("/");
    expect(controller.getState().isOpen).toBe(false);
  });

  it("dismiss() closes an auto-triggered palette and stays closed while still in the same slash prefix", async () => {
    const client = createFakeClient();
    client.commandsToReturn = COMMANDS;
    const controller = createSlashCommandsController({ agentId: "session-1", client });
    await controller.load();
    controller.notifyDraftChanged("/");
    expect(controller.getState().isOpen).toBe(true);

    controller.dismiss();
    expect(controller.getState().isOpen).toBe(false);

    // Still typing within the same dismissed slash prefix: an explicit
    // dismissal is not fought by every further keystroke.
    controller.notifyDraftChanged("/h");
    expect(controller.getState().isOpen).toBe(false);

    // Leaving the bare-prefix shape entirely (clearing the draft) and
    // retyping "/" is a fresh trigger.
    controller.notifyDraftChanged("");
    controller.notifyDraftChanged("/");
    expect(controller.getState().isOpen).toBe(true);
  });

  it("open() shows the palette manually even without a bare slash prefix", async () => {
    const client = createFakeClient();
    client.commandsToReturn = COMMANDS;
    const controller = createSlashCommandsController({ agentId: "session-1", client });
    await controller.load();
    controller.notifyDraftChanged("hello there");
    expect(controller.getState().isOpen).toBe(false);

    controller.open();
    expect(controller.getState().isOpen).toBe(true);

    controller.dismiss();
    expect(controller.getState().isOpen).toBe(false);
  });

  it("surfaces a listCommands rejection as state.error without throwing, leaving commands empty", async () => {
    const client = createFakeClient();
    client.rejectWith = new Error("provider unavailable");
    const controller = createSlashCommandsController({ agentId: "session-1", client });

    await controller.load();

    expect(controller.getState().error).toBe("provider unavailable");
    expect(controller.getState().commands).toEqual([]);
  });

  it("surfaces the payload's own error field as state.error, leaving commands at the payload's own (empty) list", async () => {
    const client = createFakeClient();
    client.commandsToReturn = [];
    client.errorToReturn = "agent not found: session-1";
    const controller = createSlashCommandsController({ agentId: "session-1", client });

    await controller.load();

    expect(controller.getState().error).toBe("agent not found: session-1");
    expect(controller.getState().commands).toEqual([]);
  });

  it("load() re-fetches rather than trusting a stale cached value", async () => {
    const client = createFakeClient();
    client.commandsToReturn = [COMMANDS[0]];
    const controller = createSlashCommandsController({ agentId: "session-1", client });
    await controller.load();
    expect(controller.getState().commands).toEqual([COMMANDS[0]]);

    client.commandsToReturn = COMMANDS;
    await controller.load();
    expect(controller.getState().commands).toEqual(COMMANDS);
    expect(client.calls).toEqual(["session-1", "session-1"]);
  });

  it("never exposes a select/validate step: the controller has no method that could block or alter a send", () => {
    const controller = createSlashCommandsController({ agentId: "session-1" });
    const methodNames = Object.keys(controller).sort();
    expect(methodNames).toEqual(["dismiss", "getState", "load", "notifyDraftChanged", "open"]);
  });
});
