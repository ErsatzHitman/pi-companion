import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { composer as coreComposer } from "@picompanion/frontend-core";
import type { StructuredStorage, StructuredStorageListOptions } from "@picompanion/frontend-core";

import { Composer } from "./Composer.js";
import type { AgentModelOption } from "./agent-turn-client.js";
import type {
  PiUiComposerActionState,
  PiUiComposerActionTarget,
  PiUiComposerDraftSource,
  PiUiComposerProposal,
} from "./pi-ui-composer-draft.js";
import {
  FakeAgentTurnClient,
  FakeClock,
  FakeFilePicker,
  InMemoryStructuredStorage,
  makeFakePickedFile,
} from "./test-doubles.js";
import type { DaemonSessionCostClient } from "../telemetry/daemon-session-cost-client.js";
import { useComposer } from "./use-composer.js";

/** Guards a `waitFor` that depends on `useModelThinking`'s own promise chains settling. */
const MODEL_THINKING_SETTLE_WAIT = { timeout: 5_000 } as const;

afterEach(cleanup);

function baseProps() {
  return {
    sessionId: "session-1",
    clock: new FakeClock(1_000),
    structuredStorage: new InMemoryStructuredStorage(),
    filePicker: new FakeFilePicker(),
  };
}

/**
 * FIX-W9 (SHOULD-FIX 1): wraps a real `InMemoryStructuredStorage` but lets
 * a test make exactly the next `put()` call reject — standing in for an
 * `outbox.enqueue` storage write failing mid-flight, a rejection
 * `submit()` (`use-composer.ts`) does not catch itself. `update()` (the
 * draft autosave) never reaches `put` in these tests: it is debounced
 * through `Clock.setTimeout`, and `FakeClock` never fires a timer unless a
 * test explicitly calls `advance()`, so arming `failNextPut` right before
 * a click reliably targets `outbox.enqueue`'s own write, not an unrelated
 * one.
 */
class FlakyStructuredStorage implements StructuredStorage {
  private readonly inner = new InMemoryStructuredStorage();
  failNextPut = false;

  async get<T>(collection: string, id: string): Promise<T | null> {
    return this.inner.get<T>(collection, id);
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("storage write failed");
    }
    return this.inner.put(collection, id, value);
  }

  async delete(collection: string, id: string): Promise<void> {
    return this.inner.delete(collection, id);
  }

  async list<T>(collection: string, options?: StructuredStorageListOptions): Promise<T[]> {
    return this.inner.list<T>(collection, options);
  }

  async clear(collection: string): Promise<void> {
    return this.inner.clear(collection);
  }
}

/**
 * UI-X1 (restoring T386's ring-opens-the-menu popover, reversing T388's
 * metadata-row chips): model/effort, per-message routing, and the
 * session-wide queue mode each live inside their own labelled group in
 * the context ring's own popover again, so a test that reads one of
 * those pickers opens the ring, exactly like `openRingPopover` below —
 * these three names stay so every call site below reads the same as it
 * did before, without touching each of the (many) individual tests.
 * POPOVER-1 replaced the popover's outer wrapper with a local anchored
 * panel (no longer `Sheet`) — see `Composer.tsx`'s own module doc comment
 * for the full contract; nothing here needed to change beyond this
 * comment and `openRingPopover`'s own name, since every call below reads
 * through `getByTestId`/`getByLabelText`, not through `Sheet`'s own DOM
 * shape.
 */
async function openModelChip(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await openRingPopover(user);
}
async function openRoutingChip(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await openRingPopover(user);
}
async function openQueueChip(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await openRingPopover(user);
}
/** The ring's own popover (UI-X1): Mode, Model & effort, Queue and Context. */
async function openRingPopover(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: /^Session controls/ }));
}

type FakeSessionCostAgent = {
  id: string;
  model: string | null;
  lastUsage?: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number };
  activeTurn?: { turnId: string; startedAt: string | null } | null;
};
type FakeSessionCostUpdateMessage = {
  type: "agent_update";
  payload: { kind: "upsert"; agent: FakeSessionCostAgent } | { kind: "remove"; agentId: string };
};

/**
 * A minimal fake `DaemonSessionCostClient` (UI-W11), mirroring
 * `SessionCostMeterContainer.test.tsx`'s own `createFakeDaemon` — this
 * feature only needs to prove the popover forwards a wired
 * `sessionCostClient` through; the adapter's own wire behaviour is
 * already proven there.
 */
function createFakeSessionCostDaemon(): DaemonSessionCostClient & {
  pushUpdate: (agent: FakeSessionCostAgent) => void;
} {
  const handlers = new Set<(message: FakeSessionCostUpdateMessage) => void>();
  return {
    on: ((_type: "agent_update", handler: (message: FakeSessionCostUpdateMessage) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }) as DaemonSessionCostClient["on"],
    pushUpdate(agent) {
      for (const handler of handlers) {
        handler({ type: "agent_update", payload: { kind: "upsert", agent } });
      }
    },
  };
}

describe("Composer", () => {
  it("has an accessible, labelled input", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    expect(screen.getByLabelText("Message Pi")).toBeTruthy();
  });

  it("is keyboard operable: focusing then Enter sends, Shift+Enter inserts a newline", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    await user.keyboard("Line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.keyboard("Line two");
    expect(input.value).toBe("Line one\nLine two");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("shows a visible focus treatment on the input", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);
    const input = screen.getByLabelText("Message Pi");
    // T386: the context ring is now the first tab stop in the prompt row
    // (the mockup draws it before the textarea), so this asserts the input's
    // own focus treatment directly rather than counting tabs to reach it.
    await user.click(input);
    expect(document.activeElement).toBe(input);
  });

  it("disables Send until the draft has non-whitespace content", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);
    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton.hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByLabelText("Message Pi"), "Hi");
    expect(sendButton.hasAttribute("disabled")).toBe(false);
  });

  it("submits the prompt and clears the draft when Send is clicked", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);
    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;

    await user.type(input, "Hello Pi");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(input.value).toBe(""));
  });

  it("has no axe violations", async () => {
    const { container } = render(<Composer {...baseProps()} testId="composer" />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("renders no Stop control at all without a client wired — it is shown only while abortable", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("FIX-L2: hides Stop on an idle session even though a turn-control client is wired — the live-browser-audit defect (canAbort used to mean only 'a client is wired', true for a session's whole life after its turns finish)", async () => {
    const client = new FakeAgentTurnClient();
    // A long-lived session that already ran and completed a turn: the
    // client stays wired for the rest of the session's life, and the
    // fake's own turn status defaults to idle, exactly like a real daemon
    // reporting `status: "idle"` after a turn ends.
    client.turnStatus = { hasActiveTurn: false };
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    await waitFor(() => expect(client.getAgentTurnStatusCalls).toEqual(["session-1"]));
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("shows an enabled Stop control once a turn is actually active, and it calls cancelAgent", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.turnStatus = { hasActiveTurn: true };
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const stopButton = await screen.findByRole("button", { name: "Stop" });
    expect(stopButton.hasAttribute("disabled")).toBe(false);

    await user.click(stopButton);

    await waitFor(() => expect(client.canceledAgentIds).toEqual(["session-1"]));
  });

  it("FIX-CI5: Stop is keyboard-reachable and keyboard-operable while a turn is active, not mouse-only", async () => {
    // `apps/web/e2e/keyboard-navigation.spec.ts` used to prove this by tabbing
    // to Stop, but it walks an IDLE session, where FIX-L2 correctly removes the
    // control entirely. Driving a real running turn from that spec was measured
    // and does not work: the daemon's `agent_update`/`status: "running"` push
    // does not reliably reach the client for a turn short enough to assert
    // against, so the browser-level assertion was moved here rather than
    // dropped. This is the same property stated at the level that can actually
    // hold it: Stop takes focus and responds to the keyboard, never a control
    // reachable only by pointer.
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.turnStatus = { hasActiveTurn: true };
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const stopButton = await screen.findByRole("button", { name: "Stop" });

    // Reachable: a real <button> that is not removed from the tab order and not
    // hidden from assistive technology.
    expect(stopButton.tagName).toBe("BUTTON");
    expect(stopButton.getAttribute("tabindex")).not.toBe("-1");
    expect(stopButton.getAttribute("aria-hidden")).toBeNull();

    // Focusable by keyboard, and focus actually lands on it.
    stopButton.focus();
    expect(document.activeElement).toBe(stopButton);

    // Operable by keyboard alone: Enter on the focused control aborts, exactly
    // as clicking it does.
    await user.keyboard("{Enter}");

    await waitFor(() => expect(client.canceledAgentIds).toEqual(["session-1"]));
  });

  it("reflects an in-flight abort promptly with visible, non-colour status text, keeping Stop visible but disabled", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.turnStatus = { hasActiveTurn: true };
    let resolveCancel: () => void = () => {};
    client.cancelAgentImpl = () =>
      new Promise((resolve) => {
        resolveCancel = resolve;
      });
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    await screen.findByRole("button", { name: "Stop" });

    await user.click(screen.getByRole("button", { name: "Stop" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Stopping");
    expect(screen.getByRole("button", { name: "Stop" }).hasAttribute("disabled")).toBe(true);

    resolveCancel();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("submits a prompt through a wired client and clears any prior send error", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    await user.type(screen.getByLabelText("Message Pi"), "Hello Pi");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(client.sentMessages).toEqual([
        expect.objectContaining({ agentId: "session-1", text: "Hello Pi" }),
      ]),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows no queue status text while the queue is empty", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    expect(screen.queryByTestId("composer-queue-status")).toBeNull();
  });

  it("shows live queue depth and its steer/follow-up split in text, not colour alone", async () => {
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} sessionId="session-1" client={client} testId="composer" />);

    expect(screen.queryByTestId("composer-queue-status")).toBeNull();

    act(() => {
      client.emitQueueUpdate("session-1", {
        steering: ["steer this"],
        followUp: ["then this"],
      });
    });

    const queueStatus = await screen.findByTestId("composer-queue-status");
    expect(queueStatus.textContent).toContain("2 queued");
    expect(queueStatus.textContent).toContain("1 to steer");
    expect(queueStatus.textContent).toContain("1 to follow up");
    // PromptBar's own counter reflects the same live depth.
    expect(screen.getByTestId("composer").textContent).toContain("2 queued");
  });

  it("has no axe violations with a live queue and a wired client", async () => {
    const client = new FakeAgentTurnClient();
    const { container } = render(
      <Composer {...baseProps()} sessionId="session-1" client={client} testId="composer" />,
    );

    act(() => {
      client.emitQueueUpdate("session-1", { steering: ["a"], followUp: ["b"] });
    });
    await screen.findByTestId("composer-queue-status");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  it("appears optimistically in the transcript view model once submitted", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), generateClientMessageId: () => "client-1" };

    // A minimal harness standing in for the (separately owned) transcript
    // feature: it renders whatever `useComposer` reports as the current
    // visible rows, proving the same hook the real `Composer` uses drives
    // an optimistic transcript entry the instant a prompt is sent — before
    // any daemon acknowledgment.
    function Harness() {
      const state = useComposer(props);
      return (
        <div>
          <ul aria-label="Transcript">
            {state.visibleRows.map((row) => (
              <li key={row.id} data-pending={row.pending ?? false}>
                {(row.item as { text: string }).text}
              </li>
            ))}
          </ul>
          <input
            aria-label="Message Pi"
            value={state.draftText}
            onChange={(event) => state.setDraftText(event.target.value)}
          />
          <button type="button" onClick={() => void state.submit()}>
            Send
          </button>
        </div>
      );
    }

    render(<Harness />);
    expect(screen.queryByText("Hello Pi")).toBeNull();

    await user.type(screen.getByLabelText("Message Pi"), "Hello Pi");
    await user.click(screen.getByRole("button", { name: "Send" }));

    const pendingRow = await screen.findByText("Hello Pi");
    expect(pendingRow.getAttribute("data-pending")).toBe("true");
  });
});

const DAEMON_COMMANDS = [
  { name: "compact", description: "Compact the conversation history", argumentHint: "[reason]" },
  { name: "undo", description: "Undo the last change", argumentHint: "" },
] as const;

describe("Composer slash-command completion (T28B4)", () => {
  it("lists the daemon-provided commands via listCommands, not a hard-coded set", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = DAEMON_COMMANDS;
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await waitFor(() => expect(client.listCommandsCalls).toEqual(["session-1"]));

    // No standalone "Commands" toggle (T388): typing the bare "/" prefix is
    // the palette's only trigger now.
    fireEvent.change(screen.getByLabelText("Message Pi"), { target: { value: "/" } });

    const listbox = await screen.findByRole("listbox", { name: "Slash commands" });
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("/compact"),
      expect.stringContaining("/undo"),
    ]);
    // Sourced from this session's client, not a literal baked into the component.
    expect(client.listCommandsCalls).toEqual(["session-1"]);
  });

  it('opens automatically once the whole draft is a bare "/" prefix, moving focus into the palette', async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = DAEMON_COMMANDS;
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await waitFor(() => expect(client.listCommandsCalls).toEqual(["session-1"]));

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/" } });

    const paletteInput = await screen.findByRole("combobox", { name: "Slash commands" });
    await waitFor(() => expect(document.activeElement).toBe(paletteInput));
  });

  it("supports arrow-key selection: ArrowDown then Enter inserts the command into the draft and returns focus to the message input", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = DAEMON_COMMANDS;
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await waitFor(() => expect(client.listCommandsCalls).toEqual(["session-1"]));

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/" } });

    const paletteInput = await screen.findByRole("combobox", { name: "Slash commands" });
    await waitFor(() => expect(document.activeElement).toBe(paletteInput));

    // The first option is active by default; ArrowDown moves to the second.
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(input.value).toBe("/undo "));
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("combobox", { name: "Slash commands" })).toBeNull();
  });

  it("dismisses on Escape, returning focus to the message input without changing the draft", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = DAEMON_COMMANDS;
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await waitFor(() => expect(client.listCommandsCalls).toEqual(["session-1"]));

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/comp" } });

    const paletteInput = await screen.findByRole("combobox", { name: "Slash commands" });
    await waitFor(() => expect(document.activeElement).toBe(paletteInput));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("combobox", { name: "Slash commands" })).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("/comp");
  });

  it("filtering the palette to no matches shows a plain-text empty state, not an error", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = DAEMON_COMMANDS;
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await waitFor(() => expect(client.listCommandsCalls).toEqual(["session-1"]));

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/" } });

    const paletteInput = await screen.findByRole("combobox", { name: "Slash commands" });
    await waitFor(() => expect(document.activeElement).toBe(paletteInput));

    await user.keyboard("zzz-not-a-real-command");
    expect(await screen.findByText("No matching commands")).toBeTruthy();
  });

  it("an unrecognized slash command in the draft submits as plain text rather than erroring", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = DAEMON_COMMANDS;
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await waitFor(() => expect(client.listCommandsCalls).toEqual(["session-1"]));

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/madeup-command" } });

    const paletteInput = await screen.findByRole("combobox", { name: "Slash commands" });
    await waitFor(() => expect(document.activeElement).toBe(paletteInput));

    // Bail out of the palette without picking a suggestion and send the
    // draft — an unrecognized slash command — exactly as typed.
    await userEvent.setup().keyboard("{Escape}");
    await userEvent.setup().click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(client.sentMessages).toEqual([
        expect.objectContaining({ agentId: "session-1", text: "/madeup-command" }),
      ]),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it('typing a bare "/" with no daemon-reported commands opens no palette (there is nothing to show)', async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = [];
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await waitFor(() => expect(client.listCommandsCalls).toEqual(["session-1"]));

    fireEvent.change(screen.getByLabelText("Message Pi"), { target: { value: "/" } });

    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();
  });

  it("has no axe violations with the palette open", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = DAEMON_COMMANDS;
    const { container } = render(<Composer {...baseProps()} client={client} testId="composer" />);
    await waitFor(() => expect(client.listCommandsCalls).toEqual(["session-1"]));

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/" } });
    await screen.findByRole("combobox", { name: "Slash commands" });

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

const MODEL_WITH_THINKING: AgentModelOption = {
  id: "pi-default",
  label: "Pi Default",
  isDefault: true,
  thinkingOptions: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
  ],
};

describe("Composer model and thinking-level pickers (T28B5)", () => {
  it("is visible but disabled and explained, rather than silently missing, without a client wired", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);
    await openModelChip(user);
    const modelSelect = screen.getByLabelText("Model") as HTMLSelectElement;
    const thinkingSelect = screen.getByLabelText("Thinking level") as HTMLSelectElement;
    expect(modelSelect.hasAttribute("disabled")).toBe(true);
    expect(thinkingSelect.hasAttribute("disabled")).toBe(true);
    const status = screen.getByTestId("composer-model-thinking-status");
    expect(status.textContent).toContain("Connect to a daemon");
  });

  it("shows the current model and thinking level without opening either native select", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "pi-default",
      thinkingOptionId: "medium",
      effectiveThinkingOptionId: "medium",
    };
    client.availableModelsByProvider.set("pi", { models: [MODEL_WITH_THINKING], error: null });
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openModelChip(user);

    const modelSelect = (await screen.findByLabelText("Model")) as HTMLSelectElement;
    await waitFor(() => expect(modelSelect.value).toBe("pi-default"), MODEL_THINKING_SETTLE_WAIT);

    const thinkingSelect = screen.getByLabelText("Thinking level") as HTMLSelectElement;
    expect(thinkingSelect.value).toBe("medium");
  });

  it("changing the model round-trips through the daemon and persists the new selection", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.availableModelsByProvider.set("pi", {
      models: [MODEL_WITH_THINKING, { id: "pi-lite", label: "Pi Lite" }],
      error: null,
    });
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openModelChip(user);

    const modelSelect = (await screen.findByLabelText("Model")) as HTMLSelectElement;
    await waitFor(
      () => expect(within(modelSelect).queryByText("Pi Lite")).not.toBeNull(),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.selectOptions(modelSelect, "pi-lite");

    await waitFor(
      () =>
        expect(client.setAgentModelCalls).toEqual([{ agentId: "session-1", modelId: "pi-lite" }]),
      MODEL_THINKING_SETTLE_WAIT,
    );
    await waitFor(() => expect(modelSelect.value).toBe("pi-lite"), MODEL_THINKING_SETTLE_WAIT);
  });

  it("changing the thinking level round-trips through the daemon and persists the new selection", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "pi-default",
      thinkingOptionId: null,
      effectiveThinkingOptionId: "medium",
    };
    client.availableModelsByProvider.set("pi", { models: [MODEL_WITH_THINKING], error: null });
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openModelChip(user);

    const thinkingSelect = (await screen.findByLabelText("Thinking level")) as HTMLSelectElement;
    await waitFor(
      () => expect(within(thinkingSelect).queryByText("Low")).not.toBeNull(),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.selectOptions(thinkingSelect, "low");

    await waitFor(
      () =>
        expect(client.setAgentThinkingOptionCalls).toEqual([
          { agentId: "session-1", thinkingOptionId: "low" },
        ]),
      MODEL_THINKING_SETTLE_WAIT,
    );
    await waitFor(() => expect(thinkingSelect.value).toBe("low"), MODEL_THINKING_SETTLE_WAIT);
  });

  it("explains, rather than silently omits, a connection that cannot change the model", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    (client as { listAvailableModels?: unknown }).listAvailableModels = undefined;
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openModelChip(user);

    const status = await screen.findByTestId("composer-model-thinking-status");
    expect(status.textContent).toContain("cannot change the model");
    const modelSelect = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(modelSelect.hasAttribute("disabled")).toBe(true);
  });

  it("explains, rather than silently drops, a current selection that fell out of the fetched model list", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "retired-model",
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
    };
    client.availableModelsByProvider.set("pi", { models: [MODEL_WITH_THINKING], error: null });
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openModelChip(user);

    const modelSelect = (await screen.findByLabelText("Model")) as HTMLSelectElement;
    await waitFor(
      () => expect(modelSelect.value).toBe("retired-model"),
      MODEL_THINKING_SETTLE_WAIT,
    );
    const option = within(modelSelect).getByText("retired-model (unavailable)");
    expect(option).toBeTruthy();
  });

  it("has no axe violations once the model/thinking pickers have loaded", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "pi-default",
      thinkingOptionId: "medium",
      effectiveThinkingOptionId: "medium",
    };
    client.availableModelsByProvider.set("pi", { models: [MODEL_WITH_THINKING], error: null });
    const { container } = render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openModelChip(user);

    const modelSelect = (await screen.findByLabelText("Model")) as HTMLSelectElement;
    await waitFor(() => expect(modelSelect.value).toBe("pi-default"), MODEL_THINKING_SETTLE_WAIT);

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  describe("attachments (T28B6)", () => {
    it("opens the platform file picker and stages a selected file as uploading, then uploaded", async () => {
      const user = userEvent.setup();
      const client = new FakeAgentTurnClient();
      const filePicker = new FakeFilePicker();
      filePicker.enqueue([makeFakePickedFile({ name: "notes.txt", mimeType: "text/plain" })]);
      render(
        <Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />,
      );

      await user.click(screen.getByRole("button", { name: "Attach files" }));

      expect(filePicker.pickFilesCalls).toHaveLength(1);
      await waitFor(() =>
        expect(screen.getByTestId("composer-attachments").textContent).toContain("notes.txt"),
      );
      await waitFor(() =>
        expect(screen.getByTestId("composer-attachments").textContent).not.toContain("uploading"),
      );
      expect(client.uploadFileCalls).toEqual([
        expect.objectContaining({ fileName: "notes.txt", mimeType: "text/plain" }),
      ]);
    });

    it("disables Send while an attachment is still uploading, even with draft text present", async () => {
      const user = userEvent.setup();
      const client = new FakeAgentTurnClient();
      let resolveUpload: (() => void) | undefined;
      client.uploadFileImpl = () =>
        new Promise((resolve) => {
          resolveUpload = () =>
            resolve({
              type: "uploaded_file",
              id: "upload-1",
              fileName: "slow.txt",
              mimeType: "text/plain",
              size: 3,
              path: "/uploads/upload-1",
            });
        });
      const filePicker = new FakeFilePicker();
      filePicker.enqueue([makeFakePickedFile({ name: "slow.txt" })]);
      render(
        <Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />,
      );

      await user.type(screen.getByLabelText("Message Pi"), "Hello");
      await user.click(screen.getByRole("button", { name: "Attach files" }));

      const sendButton = screen.getByRole("button", { name: "Send" });
      await waitFor(() => expect(sendButton.hasAttribute("disabled")).toBe(true));

      resolveUpload?.();
      await waitFor(() => expect(sendButton.hasAttribute("disabled")).toBe(false));
    });

    it("shows a clear, non-colour-only error for an oversized attachment without uploading it", async () => {
      const user = userEvent.setup();
      const client = new FakeAgentTurnClient();
      const filePicker = new FakeFilePicker();
      filePicker.enqueue([makeFakePickedFile({ name: "huge.bin", size: 200 * 1024 * 1024 })]);
      render(
        <Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />,
      );

      await user.click(screen.getByRole("button", { name: "Attach files" }));

      const tray = await screen.findByTestId("composer-attachments");
      expect(tray.textContent).toContain("huge.bin");
      expect(tray.textContent?.toLowerCase()).toContain("failed");
      expect(client.uploadFileCalls).toEqual([]);
      // A "Retry" control appears for the errored attachment, not just a
      // colour change (plan.md §10.5: status paired with visible text/controls).
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });

    it("retries an errored upload and clears the error once it succeeds", async () => {
      const user = userEvent.setup();
      const client = new FakeAgentTurnClient();
      let attempt = 0;
      client.uploadFileImpl = async (input) => {
        attempt += 1;
        if (attempt === 1) throw new Error("Connection dropped mid-upload");
        return {
          type: "uploaded_file",
          id: "upload-2",
          fileName: input.fileName,
          mimeType: input.mimeType,
          size: input.bytes.byteLength,
          path: "/uploads/upload-2",
        };
      };
      const filePicker = new FakeFilePicker();
      filePicker.enqueue([makeFakePickedFile({ name: "diagram.png" })]);
      render(
        <Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />,
      );

      await user.click(screen.getByRole("button", { name: "Attach files" }));
      await waitFor(() =>
        expect(screen.getByTestId("composer-attachments").textContent).toContain("failed"),
      );

      await user.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
      expect(screen.getByTestId("composer-attachments").textContent).toContain("diagram.png");
      expect(attempt).toBe(2);
    });

    it("removing a staged attachment drops its chip", async () => {
      const user = userEvent.setup();
      const client = new FakeAgentTurnClient();
      const filePicker = new FakeFilePicker();
      filePicker.enqueue([makeFakePickedFile({ name: "remove-me.txt" })]);
      render(
        <Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />,
      );

      await user.click(screen.getByRole("button", { name: "Attach files" }));
      await waitFor(() =>
        expect(screen.getByTestId("composer-attachments").textContent).toContain("remove-me.txt"),
      );

      await user.click(screen.getByRole("button", { name: /^Remove/ }));

      expect(screen.queryByTestId("composer-attachments")).toBeNull();
    });

    it("sends the uploaded attachment's reference with the message and clears the tray", async () => {
      const user = userEvent.setup();
      const client = new FakeAgentTurnClient();
      const filePicker = new FakeFilePicker();
      filePicker.enqueue([makeFakePickedFile({ name: "report.pdf", mimeType: "application/pdf" })]);
      render(
        <Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />,
      );

      await user.click(screen.getByRole("button", { name: "Attach files" }));
      await waitFor(() =>
        expect(screen.getByTestId("composer-attachments").textContent).not.toContain("uploading"),
      );

      await user.type(screen.getByLabelText("Message Pi"), "See attached");
      await user.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() =>
        expect(client.sentMessages).toEqual([
          expect.objectContaining({
            agentId: "session-1",
            text: "See attached",
            options: expect.objectContaining({
              attachments: [expect.objectContaining({ fileName: "report.pdf" })],
            }),
          }),
        ]),
      );
      expect(screen.queryByTestId("composer-attachments")).toBeNull();
    });

    it("allows sending an uploaded attachment with no draft text", async () => {
      const user = userEvent.setup();
      const client = new FakeAgentTurnClient();
      const filePicker = new FakeFilePicker();
      filePicker.enqueue([makeFakePickedFile({ name: "only-attachment.png" })]);
      render(
        <Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />,
      );

      await user.click(screen.getByRole("button", { name: "Attach files" }));
      await waitFor(() =>
        expect(screen.getByTestId("composer-attachments").textContent).not.toContain("uploading"),
      );

      const sendButton = screen.getByRole("button", { name: "Send" });
      expect(sendButton.hasAttribute("disabled")).toBe(false);

      await user.click(sendButton);

      await waitFor(() =>
        expect(client.sentMessages).toEqual([
          expect.objectContaining({ agentId: "session-1", text: "" }),
        ]),
      );
    });

    it("has no axe violations with staged uploaded and errored attachments", async () => {
      const client = new FakeAgentTurnClient();
      const filePicker = new FakeFilePicker();
      filePicker.enqueue([
        makeFakePickedFile({ name: "ok.txt" }),
        makeFakePickedFile({ name: "too-big.bin", size: 200 * 1024 * 1024 }),
      ]);
      const { container } = render(
        <Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />,
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Attach files" }));
      await waitFor(() =>
        expect(screen.getByTestId("composer-attachments").textContent).toContain("too-big.bin"),
      );
      await waitFor(() =>
        expect(screen.getByTestId("composer-attachments").textContent).not.toContain("uploading"),
      );

      expect(await axe(container)).toHaveNoViolations();
    }, 20_000);
  });
});

describe("Composer steer/follow-up mode control (T38B1a)", () => {
  it("is visible but disabled and explained, rather than silently missing, without a client wired", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);
    await openQueueChip(user);
    const steeringSelect = screen.getByLabelText("Steering queue delivery") as HTMLSelectElement;
    const followUpSelect = screen.getByLabelText("Follow-up queue delivery") as HTMLSelectElement;
    expect(steeringSelect.hasAttribute("disabled")).toBe(true);
    expect(followUpSelect.hasAttribute("disabled")).toBe(true);
    const status = screen.getByTestId("composer-queue-modes-status");
    expect(status.textContent).toContain("Connect to a daemon");
  });

  it("renders its own explained 'unsupported' state against a client that omits the queue-mode methods — no longer true of a real DaemonClient, which has had all three since T110", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    (client as { getQueueModes?: unknown }).getQueueModes = undefined;
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openQueueChip(user);

    const status = await screen.findByTestId("composer-queue-modes-status");
    expect(status.textContent).toContain("cannot change the steer/follow-up mode");
    const steeringSelect = screen.getByLabelText("Steering queue delivery") as HTMLSelectElement;
    expect(steeringSelect.hasAttribute("disabled")).toBe(true);
  });

  it("shows both current modes as a segmented control, without opening either (SEGMENTED-1)", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "all", followUpMode: "one-at-a-time" };
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openQueueChip(user);

    const steeringTablist = await screen.findByRole("tablist", { name: "Steering queue delivery" });
    await waitFor(
      () =>
        expect(
          within(steeringTablist)
            .getByRole("tab", { name: "All together" })
            .getAttribute("aria-selected"),
        ).toBe("true"),
      MODEL_THINKING_SETTLE_WAIT,
    );
    const followUpTablist = screen.getByRole("tablist", { name: "Follow-up queue delivery" });
    expect(
      within(followUpTablist)
        .getByRole("tab", { name: "One at a time (default)" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("changing the steering mode round-trips through the daemon and persists the new selection", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openQueueChip(user);

    const steeringTablist = await screen.findByRole("tablist", { name: "Steering queue delivery" });
    await waitFor(
      () =>
        expect(
          within(steeringTablist)
            .getByRole("tab", { name: "All together" })
            .hasAttribute("disabled"),
        ).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.click(within(steeringTablist).getByRole("tab", { name: "All together" }));

    await waitFor(
      () => expect(client.setSteeringModeCalls).toEqual([{ agentId: "session-1", mode: "all" }]),
      MODEL_THINKING_SETTLE_WAIT,
    );
    await waitFor(
      () =>
        expect(
          within(steeringTablist)
            .getByRole("tab", { name: "All together" })
            .getAttribute("aria-selected"),
        ).toBe("true"),
      MODEL_THINKING_SETTLE_WAIT,
    );
    // The follow-up mode is unaffected by a steering-mode change.
    const followUpTablist = screen.getByRole("tablist", { name: "Follow-up queue delivery" });
    expect(
      within(followUpTablist)
        .getByRole("tab", { name: "One at a time (default)" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("reflects a mode change made by another connected client, with no manual refresh", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openQueueChip(user);

    const steeringTablist = await screen.findByRole("tablist", { name: "Steering queue delivery" });
    await waitFor(
      () =>
        expect(
          within(steeringTablist)
            .getByRole("tab", { name: "All together" })
            .hasAttribute("disabled"),
        ).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    // Driven entirely through the injected port's own subscription — no
    // action this rendered component itself took.
    client.emitQueueModes("session-1", { steeringMode: "all", followUpMode: "all" });

    await waitFor(
      () =>
        expect(
          within(steeringTablist)
            .getByRole("tab", { name: "All together" })
            .getAttribute("aria-selected"),
        ).toBe("true"),
      MODEL_THINKING_SETTLE_WAIT,
    );
    const followUpTablist = screen.getByRole("tablist", { name: "Follow-up queue delivery" });
    expect(
      within(followUpTablist)
        .getByRole("tab", { name: "All together" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("renders the daemon's provider notice after changing the steering mode (T127), proven in the DOM", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    client.steeringNoticeToReturn = {
      type: "info",
      message: "steering mode applies from the next turn",
    };
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openQueueChip(user);

    const steeringTablist = await screen.findByRole("tablist", { name: "Steering queue delivery" });
    await waitFor(
      () =>
        expect(
          within(steeringTablist)
            .getByRole("tab", { name: "All together" })
            .hasAttribute("disabled"),
        ).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.click(within(steeringTablist).getByRole("tab", { name: "All together" }));

    const status = await screen.findByTestId("composer-queue-modes-status");
    await waitFor(
      () => expect(status.textContent).toContain("steering mode applies from the next turn"),
      MODEL_THINKING_SETTLE_WAIT,
    );
  });

  it("renders the daemon's provider notice after changing the follow-up mode (T127), independent of the steering notice", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    client.followUpNoticeToReturn = {
      type: "warning",
      message: "follow-up mode applies from the next turn",
    };
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openQueueChip(user);

    const followUpTablist = await screen.findByRole("tablist", {
      name: "Follow-up queue delivery",
    });
    await waitFor(
      () =>
        expect(
          within(followUpTablist)
            .getByRole("tab", { name: "All together" })
            .hasAttribute("disabled"),
        ).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.click(within(followUpTablist).getByRole("tab", { name: "All together" }));

    const status = await screen.findByTestId("composer-queue-modes-status");
    await waitFor(
      () => expect(status.textContent).toContain("follow-up mode applies from the next turn"),
      MODEL_THINKING_SETTLE_WAIT,
    );
  });

  it("renders no status element at all for a `null` notice — an empty shell is exactly the failure mode this must not repeat (T127)", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    // `steeringNoticeToReturn` defaults to `null` — the common case, since
    // the daemon attaches a notice only sometimes.
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openQueueChip(user);

    const steeringTablist = await screen.findByRole("tablist", { name: "Steering queue delivery" });
    await waitFor(
      () =>
        expect(
          within(steeringTablist)
            .getByRole("tab", { name: "All together" })
            .hasAttribute("disabled"),
        ).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.click(within(steeringTablist).getByRole("tab", { name: "All together" }));
    await waitFor(
      () =>
        expect(
          within(steeringTablist)
            .getByRole("tab", { name: "All together" })
            .getAttribute("aria-selected"),
        ).toBe("true"),
      MODEL_THINKING_SETTLE_WAIT,
    );

    // Give a (wrongly) rendered empty notice a chance to appear before
    // asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId("composer-queue-modes-status")).toBeNull();
  });

  it("states the mode-vs-per-message distinction in the rendered copy, not only in a comment", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);
    await openQueueChip(user);
    const help = screen.getByTestId("composer-queue-modes");
    expect(help.textContent).toContain("do not decide whether a single message steers");
  });

  it("offers no cancel/remove/reorder control over an already-queued message (narrowed for SEGMENTED-1)", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "all", followUpMode: "all" };
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openQueueChip(user);

    const control = screen.getByTestId("composer-queue-modes");
    // SEGMENTED-1 wired `SegmentedControl` in for the ready-with-a-known-mode
    // case (plan.md §ATOMS-1 change 5, fix-plan.md item 5) — real `<button
    // role="tab">` elements by design (the ARIA tablist pattern), so a
    // literal "zero buttons anywhere in this control" assertion no longer
    // holds and was never the actual invariant: the control's own name and
    // this file's own comment always meant no PER-MESSAGE cancel, remove, or
    // reorder command, because Pi exposes none (T38B1a's fourth acceptance
    // criterion) — never "no buttons at all". A queue-MODE selector is a
    // whole-session setting, not a per-item control, so its own two segment
    // tabs ("One at a time (default)"/"All together") are exactly what this
    // invariant always permitted. Narrowed, not deleted, to the invariant it
    // actually names: every button inside this control must be one of the
    // two known mode-segment tabs, never a cancel/remove/reorder/delete/move
    // command — deleting this assertion's guard entirely would let a future
    // "Cancel"/"Remove"/"Reorder" button ship silently, which is exactly
    // what it exists to catch.
    const buttons = Array.from(control.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0); // the two segmented-control tabs
    const forbiddenNamePattern = /cancel|remove|reorder|delete|move/i;
    for (const button of buttons) {
      const accessibleName = button.getAttribute("aria-label") ?? button.textContent ?? "";
      expect(accessibleName).not.toMatch(forbiddenNamePattern);
    }
  });

  it("has no axe violations once the queue-mode control has loaded", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "all", followUpMode: "one-at-a-time" };
    const { container } = render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openQueueChip(user);

    const steeringTablist = await screen.findByRole("tablist", { name: "Steering queue delivery" });
    await waitFor(
      () =>
        expect(
          within(steeringTablist)
            .getByRole("tab", { name: "All together" })
            .getAttribute("aria-selected"),
        ).toBe("true"),
      MODEL_THINKING_SETTLE_WAIT,
    );

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("Composer per-message steer/follow-up routing (T38B1b)", () => {
  it('shows "Auto (default)" as the visible, un-opened routing choice, with no client wired', async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);
    await openRoutingChip(user);
    const select = screen.getByLabelText("Send this message as") as HTMLSelectElement;
    expect(select.value).toBe("auto");
    expect(select.hasAttribute("disabled")).toBe(false);
  });

  it("sends an explicit steer choice to the real client, proven by the value arriving at the recording fake — not by local state changing", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openRoutingChip(user);

    const select = screen.getByLabelText("Send this message as") as HTMLSelectElement;
    await user.selectOptions(select, "steer");
    expect(select.value).toBe("steer");

    // The choice is made for the next message, so the popover is dismissed
    // before typing it — the same order a reader works through in the UI.
    // Escape closes it from anywhere inside it (POPOVER-1's document-level
    // listener, `Composer.tsx`), not only from the message textarea.
    await user.keyboard("{Escape}");

    await user.type(screen.getByLabelText("Message Pi"), "steer this one");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(client.sentMessages).toEqual([
        expect.objectContaining({
          text: "steer this one",
          options: expect.objectContaining({ streamingBehavior: "steer" }),
        }),
      ]),
    );
    // Consumed by that submission: re-opening the controls shows the
    // selector back at "Auto", rather than silently steering the next,
    // unrelated message too. (The popover unmounts its content on close,
    // so the value has to be re-read from a freshly opened popover.)
    await openRoutingChip(user);
    expect((screen.getByLabelText("Send this message as") as HTMLSelectElement).value).toBe("auto");
  });

  it("sends an explicit follow-up choice to the real client the same way", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openRoutingChip(user);

    await user.selectOptions(screen.getByLabelText("Send this message as"), "followUp");
    await user.keyboard("{Escape}");
    await user.type(screen.getByLabelText("Message Pi"), "queue this one");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(client.sentMessages).toEqual([
        expect.objectContaining({
          text: "queue this one",
          options: expect.objectContaining({ streamingBehavior: "followUp" }),
        }),
      ]),
    );
  });

  it("a plain send with the Auto default carries no streamingBehavior at all", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    await user.type(screen.getByLabelText("Message Pi"), "plain send");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(client.sentMessages).toHaveLength(1));
    expect(client.sentMessages[0]?.options).not.toHaveProperty("streamingBehavior");
  });

  it("the resulting queue position is reflected in the live T28B3 queue display", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} sessionId="session-1" client={client} testId="composer" />);
    await openRoutingChip(user);

    await user.selectOptions(screen.getByLabelText("Send this message as"), "steer");
    await user.keyboard("{Escape}");
    await user.type(screen.getByLabelText("Message Pi"), "steer this one");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(client.sentMessages).toHaveLength(1));

    // Stands in for the daemon accepting the steer and reporting it back
    // on the live queue — the same `pi_queue_update` push `describeQueue`
    // already renders (T28B3); this control adds no display of its own.
    act(() => {
      client.emitQueueUpdate("session-1", { steering: ["steer this one"], followUp: [] });
    });

    const queueStatus = await screen.findByTestId("composer-queue-status");
    expect(queueStatus.textContent).toContain("1 to steer");
  });

  it("has no axe violations with the routing selector changed", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    const { container } = render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openRoutingChip(user);

    await user.selectOptions(screen.getByLabelText("Send this message as"), "followUp");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("Composer prompt row, footer, ring and Escape (T386)", () => {
  it("renders the mockup's footer as visible text: the state sentence and the keyboard contract", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const footerState = screen.getByTestId("composer-foot-state");
    expect(footerState.textContent).toBe(
      "Auto — steers the turn in flight, or starts a new one when idle",
    );
    // The visible glyph line is the mockup's; a visually-hidden sentence
    // carries the same contract for screen readers (the textarea's
    // aria-describedby points at it).
    expect(screen.getByText("⏎ send · ⇧⏎ newline · Esc interrupt")).toBeTruthy();
    expect(
      screen.getByText(
        "Press Enter to send, Shift+Enter for a new line, Escape to interrupt the running turn.",
      ),
    ).toBeTruthy();
  });

  it("the footer sentence follows the per-message routing choice", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    await openRoutingChip(user);
    await user.selectOptions(screen.getByLabelText("Send this message as"), "steer");
    await user.keyboard("{Escape}");

    expect(screen.getByTestId("composer-foot-state").textContent).toBe(
      "Steering — this goes to the turn already running",
    );
  });

  it("Escape in the prompt bar interrupts the running turn through the same abort the Stop button uses", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const input = screen.getByLabelText("Message Pi");
    await user.click(input);
    await user.keyboard("half-written draft");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(client.canceledAgentIds).toEqual(["session-1"]));
    // Escape interrupts; it never throws the draft away.
    expect((input as HTMLTextAreaElement).value).toBe("half-written draft");
  });

  it("Escape is a no-op without a client to interrupt", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);

    const input = screen.getByLabelText("Message Pi");
    await user.click(input);
    await user.keyboard("kept");
    await user.keyboard("{Escape}");

    expect((input as HTMLTextAreaElement).value).toBe("kept");
  });

  it("the context ring opens the session-controls popover, showing the context summary, an honest cost readout, and the Mode/Model/Queue pickers (UI-X1, UI-W11)", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);

    const ring = screen.getByTestId("composer-context-ring");
    expect(ring.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("composer-session-controls")).toBeNull();

    await user.click(ring);

    expect(ring.getAttribute("aria-expanded")).toBe("true");
    const popover = screen.getByTestId("composer-session-controls");
    expect(popover).toBeTruthy();
    // POPOVER-1: an anchored, undimmed popover, not a modal dialog.
    expect(popover.getAttribute("role")).toBe("dialog");
    expect(popover.getAttribute("aria-modal")).toBeNull();
    expect(popover.getAttribute("aria-label")).toBe("Session controls");
    expect(screen.getByTestId("composer-context-summary").textContent).toContain(
      "not been reported",
    );
    // UI-W11: `SessionCostMeterContainer` mounts unconditionally (it needs
    // only `sessionId`, not `contextTelemetry`) directly after
    // `ContextMeter`, and with no live `sessionCostClient` shows its own
    // honest "not priced yet" state — never a fabricated $0.00.
    expect(within(popover).getByTestId("composer-session-cost-meter-unknown")).toBeTruthy();
    // UI-X1: Mode, Model & effort and Queue moved back into this popover
    // (reversing T388's metadata-row chips), so the picker IS here now.
    expect(within(popover).getByLabelText("Model")).toBeTruthy();
  });

  it("POPOVER-1: moves focus into the popover's first focusable control on open, and restores it to the ring on Escape", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);

    const ring = screen.getByTestId("composer-context-ring");
    await user.click(ring);

    const popover = screen.getByTestId("composer-session-controls");
    await waitFor(() => expect(popover.contains(document.activeElement)).toBe(true));

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("composer-session-controls")).toBeNull();
    expect(document.activeElement).toBe(ring);
  });

  it("POPOVER-1: a click outside the popover closes it without stealing focus from whatever was actually clicked", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);

    await user.click(screen.getByTestId("composer-context-ring"));
    expect(screen.getByTestId("composer-session-controls")).toBeTruthy();

    // The message textarea is unrelated composer chrome, outside the
    // popover — clicking it must close the popover (POPOVER-1's
    // document-level outside-click listener) and land focus on the
    // element actually clicked, never snap it back to the ring.
    const input = screen.getByLabelText("Message Pi");
    await user.click(input);

    expect(screen.queryByTestId("composer-session-controls")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("draws a 'Compact now' row at the end of the Context group, in the ring's own popover (UI-W12)", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);
    await openRingPopover(user);

    const compactNow = screen.getByTestId("composer-compact-now");
    expect(compactNow.textContent).toContain("Compact now");
  });

  it("the Compact now row sends the literal '/compact' message through the same submit path a typed message takes, exactly once (UI-W12)", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await openRingPopover(user);

    await user.click(screen.getByTestId("composer-compact-now"));

    await waitFor(() => expect(client.sentMessages).toHaveLength(1));
    expect(client.sentMessages[0]?.text).toBe("/compact");
    expect(client.sentMessages[0]?.agentId).toBe("session-1");
    // Closes on press rather than waiting on the round trip, and nothing
    // else re-opens it, so a second click can't double-send.
    expect(screen.queryByTestId("composer-session-controls")).toBeNull();
  });

  it("BUG 1 (FIX-W5): a draft already exactly '/compact' sends once on click, and a later keystroke merely passing through that exact string does not auto-submit", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.type(input, "/compact");
    await openRingPopover(user);

    await user.click(screen.getByTestId("composer-compact-now"));

    // (a) One click, with the draft already exactly '/compact', sends
    // exactly one message whose text is '/compact'.
    await waitFor(() => expect(client.sentMessages).toHaveLength(1));
    expect(client.sentMessages[0]?.text).toBe("/compact");
    await waitFor(() => expect(input.value).toBe(""));

    // (b) Typing a longer message that passes through the literal
    // '/compact' string on its way to something longer must not resurrect
    // the click above and steal the rest of the sentence: the stale-ref
    // bug fired a second, truncated send right at the keystroke where the
    // draft matched '/compact' exactly.
    await user.type(input, "/compact the last 3 turns please");

    await waitFor(() => expect(input.value).toBe("/compact the last 3 turns please"));
    expect(client.sentMessages).toHaveLength(1);
  });

  it("BUG 2 (FIX-W5): restores the user's own in-progress draft once the compact send is enqueued, instead of discarding it", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.type(input, "don't forget the deploy notes");
    await openRingPopover(user);

    await user.click(screen.getByTestId("composer-compact-now"));

    await waitFor(() => expect(client.sentMessages).toHaveLength(1));
    expect(client.sentMessages[0]?.text).toBe("/compact");
    await waitFor(() => expect(input.value).toBe("don't forget the deploy notes"));
  });

  it("BUG 3 (FIX-W5): clears staged attachments before a compact send rather than sending them along with '/compact'", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([makeFakePickedFile({ name: "notes.txt", mimeType: "text/plain" })]);
    render(<Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />);

    await user.click(screen.getByRole("button", { name: "Attach files" }));
    await waitFor(() =>
      expect(screen.getByTestId("composer-attachments").textContent).toContain("notes.txt"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("composer-attachments").textContent).not.toContain("uploading"),
    );

    await openRingPopover(user);
    await user.click(screen.getByTestId("composer-compact-now"));

    await waitFor(() => expect(client.sentMessages).toHaveLength(1));
    expect(client.sentMessages[0]?.text).toBe("/compact");
    expect(client.sentMessages[0]?.options?.attachments).toBeUndefined();
    expect(screen.queryByTestId("composer-attachments")).toBeNull();
  });

  it("FIX-W9 (BLOCKER): a message typed while the compact send is still in flight survives — the restore never clobbers newer text with the stale pre-compact draft", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    let releaseSend: (() => void) | undefined;
    client.sendAgentMessageImpl = () =>
      new Promise((resolve) => {
        releaseSend = resolve;
      });
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.type(input, "don't forget the deploy notes");
    await openRingPopover(user);

    await user.click(screen.getByTestId("composer-compact-now"));

    // The compact send is now durably underway — recorded on the fake
    // client — but hung inside client.sendAgentMessage (not yet released),
    // and the draft has already been cleared to make room for it.
    await waitFor(() => expect(client.sentMessages).toHaveLength(1));
    expect(client.sentMessages[0]?.text).toBe("/compact");
    await waitFor(() => expect(input.value).toBe(""));

    // The textarea is never disabled while a send is in flight (only the
    // Send button is, per PromptBar) — the user types a brand-new message
    // during the wait.
    await user.type(input, "NEW urgent message");
    expect(input.value).toBe("NEW urgent message");

    // Release the hung send; the compact submission now durably completes
    // and its restore runs.
    releaseSend?.();
    await waitFor(() => expect(client.sentMessages).toHaveLength(1));
    // Give a (buggy) unconditional restore a chance to fire before
    // asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(input.value).toBe("NEW urgent message");
    // Exactly one message was ever sent — the compact one; the newer text
    // is still sitting in the draft, unsent.
    expect(client.sentMessages).toHaveLength(1);
  });

  it("FIX-W9 (SHOULD-FIX 1): a rejection that escapes submit()'s own catch (an outbox.enqueue storage failure) restores the captured draft and surfaces its own error, rather than losing the text behind an unhandled rejection", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    const structuredStorage = new FlakyStructuredStorage();
    render(
      <Composer
        {...baseProps()}
        structuredStorage={structuredStorage}
        client={client}
        testId="composer"
      />,
    );

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.type(input, "don't lose this either");
    await openRingPopover(user);

    structuredStorage.failNextPut = true;
    await user.click(screen.getByTestId("composer-compact-now"));

    // outbox.enqueue's own storage.put rejected before ever reaching
    // client.sendAgentMessage — no message was ever sent.
    await waitFor(() => expect(screen.queryByTestId("composer-compact-error")).not.toBeNull());
    expect(client.sentMessages).toEqual([]);
    // The captured draft is restored rather than lost, and the failure is
    // surfaced as its own visible, non-colour-only status text.
    expect(input.value).toBe("don't lose this either");
    expect(screen.getByTestId("composer-compact-error").textContent).toContain(
      "storage write failed",
    );
  });

  it("the Compact now row is disabled with a real explanation when there is no live client (UI-W12)", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} testId="composer" />);
    await openRingPopover(user);

    const compactNow = screen.getByTestId("composer-compact-now");
    expect(compactNow.hasAttribute("disabled")).toBe(true);
    expect(compactNow.textContent).toContain("Connect to a session");
  });

  it("UI-W11: reflects live agent_update cost pushes from a wired sessionCostClient inside the session-controls popover", async () => {
    const user = userEvent.setup();
    const daemon = createFakeSessionCostDaemon();
    render(<Composer {...baseProps()} sessionCostClient={daemon} testId="composer" />);

    await openRingPopover(user);
    expect(screen.getByTestId("composer-session-cost-meter-unknown")).toBeTruthy();

    act(() => {
      daemon.pushUpdate({
        id: "session-1",
        model: "claude-sonnet-4",
        activeTurn: { turnId: "turn_1", startedAt: "2026-08-31T12:00:00.000Z" },
        lastUsage: { inputTokens: 1_000_000, outputTokens: 0 },
      });
    });

    expect(screen.getByTestId("composer-session-cost-meter-readout").textContent).toBe(
      "$3.0000 this session",
    );
  });

  it("draws the ring's percentage from the telemetry prop the route supplies", () => {
    render(
      <Composer
        {...baseProps()}
        contextTelemetry={{
          contextWindow: {
            status: "known",
            usedTokens: 131_600,
            maxTokens: 200_000,
            usedFraction: 0.658,
          },
          cacheShare: { status: "unknown" },
        }}
        testId="composer"
      />,
    );
    expect(
      screen.getByTestId("composer-context-ring").querySelector(".pc-context-ring__pct"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Session controls — 66% of context used" }),
    ).toBeTruthy();
  });

  it("has no axe violations with the session-controls popover open", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    const { container } = render(<Composer {...baseProps()} client={client} testId="composer" />);

    await openRingPopover(user);

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

function makeBrowserFile(name: string, mimeType: string): File {
  return new File(["x"], name, { type: mimeType });
}

describe("Composer drag-and-drop, paste, and inline previews (T279)", () => {
  it("stages a dropped file through the same tray a picked file uses", async () => {
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    fireEvent.drop(screen.getByTestId("composer"), {
      dataTransfer: { types: ["Files"], files: [makeBrowserFile("dropped.txt", "text/plain")] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("composer-attachments").textContent).toContain("dropped.txt"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("composer-attachments").textContent).not.toContain("uploading"),
    );
    expect(client.uploadFileCalls).toEqual([expect.objectContaining({ fileName: "dropped.txt" })]);
  });

  it("prevents the default dragover action, so a drop is not lost to browser navigation", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const wrapper = screen.getByTestId("composer");

    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"] } });
    wrapper.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("shows the drop-target hint only while a file drag is over the composer — quiet otherwise", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const wrapper = screen.getByTestId("composer");

    expect(screen.queryByTestId("composer-drop-hint")).toBeNull();

    fireEvent.dragEnter(wrapper, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByTestId("composer-drop-hint")).toBeTruthy();

    fireEvent.dragLeave(wrapper, { dataTransfer: { types: ["Files"] } });
    expect(screen.queryByTestId("composer-drop-hint")).toBeNull();
  });

  it("hides the drop-target hint again once the drop completes", async () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const wrapper = screen.getByTestId("composer");

    fireEvent.dragEnter(wrapper, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByTestId("composer-drop-hint")).toBeTruthy();

    fireEvent.drop(wrapper, {
      dataTransfer: { types: ["Files"], files: [makeBrowserFile("a.txt", "text/plain")] },
    });

    expect(screen.queryByTestId("composer-drop-hint")).toBeNull();
  });

  it("a dropped file over the existing 100 MiB ceiling is rejected exactly like an oversized picked file", async () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const oversized = Object.defineProperty(
      makeBrowserFile("huge.bin", "application/octet-stream"),
      "size",
      {
        value: 200 * 1024 * 1024,
      },
    );

    fireEvent.drop(screen.getByTestId("composer"), {
      dataTransfer: { types: ["Files"], files: [oversized] },
    });

    const tray = await screen.findByTestId("composer-attachments");
    expect(tray.textContent).toContain("huge.bin");
    expect(tray.textContent?.toLowerCase()).toContain("failed");
  });

  it("pasting a bare URL is never swallowed: no attachment is staged", () => {
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    fireEvent.paste(screen.getByLabelText("Message Pi"), {
      clipboardData: {
        items: [{ kind: "string", getAsFile: () => null }],
        getData: () => "https://example.com",
      },
    });

    expect(screen.queryByTestId("composer-attachments")).toBeNull();
    expect(client.uploadFileCalls).toEqual([]);
  });

  it("pasting an image stages it as an attachment with an inline preview", async () => {
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const image = makeBrowserFile("", "image/png");
    fireEvent.paste(screen.getByLabelText("Message Pi"), {
      clipboardData: {
        items: [
          { kind: "file", getAsFile: () => image },
          { kind: "string", getAsFile: () => null },
        ],
        getData: () => "https://example.com/cat.png",
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId("composer-attachments").textContent).toContain("pasted-image-"),
    );
    await waitFor(() => expect(client.uploadFileCalls).toHaveLength(1));
  });

  it("has no axe violations while the drop hint is showing", async () => {
    const { container } = render(<Composer {...baseProps()} testId="composer" />);
    fireEvent.dragEnter(screen.getByTestId("composer"), { dataTransfer: { types: ["Files"] } });

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  describe("with a stubbed URL.createObjectURL (jsdom has none of its own)", () => {
    afterEach(() => {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    });

    it("renders an inline preview thumbnail for a dropped image attachment", async () => {
      URL.createObjectURL = vi.fn(
        () => "blob:mock-preview",
      ) as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
      render(<Composer {...baseProps()} testId="composer" />);

      fireEvent.drop(screen.getByTestId("composer"), {
        dataTransfer: { types: ["Files"], files: [makeBrowserFile("photo.png", "image/png")] },
      });

      const preview = await screen.findByAltText("");
      expect(preview.tagName).toBe("IMG");
      expect(preview.getAttribute("src")).toBe("blob:mock-preview");
    });

    it("renders an inline preview thumbnail for an image chosen through the file picker", async () => {
      URL.createObjectURL = vi.fn(
        () => "blob:picked-preview",
      ) as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
      const client = new FakeAgentTurnClient();
      const filePicker = new FakeFilePicker();
      filePicker.enqueue([makeFakePickedFile({ name: "photo.png", mimeType: "image/png" })]);
      render(
        <Composer {...baseProps()} filePicker={filePicker} client={client} testId="composer" />,
      );

      await userEvent.setup().click(screen.getByRole("button", { name: "Attach files" }));

      const preview = await screen.findByAltText("");
      expect(preview.tagName).toBe("IMG");
      expect(preview.getAttribute("src")).toBe("blob:picked-preview");
    });

    it("revokes the preview's object URL when the attachment is removed", async () => {
      const revokeObjectURL = vi.fn();
      URL.createObjectURL = vi.fn(
        () => "blob:mock-preview",
      ) as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
      render(<Composer {...baseProps()} testId="composer" />);

      fireEvent.drop(screen.getByTestId("composer"), {
        dataTransfer: { types: ["Files"], files: [makeBrowserFile("photo.png", "image/png")] },
      });
      await screen.findByAltText("");

      await userEvent.setup().click(screen.getByRole("button", { name: /^Remove/ }));

      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-preview");
    });
  });
});

describe("Composer editor-text bridge (T293)", () => {
  /** Minimal fake `DaemonEditorTextSource`, driven by the test. */
  class FakeDaemonEditorTextSource {
    readonly respondToEditorText = vi.fn(async () => undefined);
    private readonly handlers = new Set<
      (message: {
        type: "agent_editor_text_request";
        payload: { agentId: string; requestId: string };
      }) => void
    >();

    on(
      _type: "agent_editor_text_request",
      handler: (message: {
        type: "agent_editor_text_request";
        payload: { agentId: string; requestId: string };
      }) => void,
    ): () => void {
      this.handlers.add(handler);
      return () => this.handlers.delete(handler);
    }

    emitRequest(agentId: string, requestId: string): void {
      for (const handler of this.handlers) {
        handler({ type: "agent_editor_text_request", payload: { agentId, requestId } });
      }
    }
  }

  it("answers a live getEditorText request with whatever is currently typed", async () => {
    const user = userEvent.setup();
    const editorTextClient = new FakeDaemonEditorTextSource();
    render(
      <Composer
        {...baseProps()}
        sessionId="session-editor-text"
        editorTextClient={editorTextClient}
        testId="composer"
      />,
    );

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.click(input);
    await user.keyboard("draft in progress");

    act(() => {
      editorTextClient.emitRequest("session-editor-text", "req-1");
    });

    expect(editorTextClient.respondToEditorText).toHaveBeenCalledWith(
      "session-editor-text",
      "req-1",
      "draft in progress",
    );
  });

  it("ignores a request for a different sessionId", () => {
    const editorTextClient = new FakeDaemonEditorTextSource();
    render(
      <Composer
        {...baseProps()}
        sessionId="session-editor-text"
        editorTextClient={editorTextClient}
        testId="composer"
      />,
    );

    act(() => {
      editorTextClient.emitRequest("some-other-session", "req-1");
    });

    expect(editorTextClient.respondToEditorText).not.toHaveBeenCalled();
  });

  it("never answers when no editorTextClient is supplied", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} sessionId="session-editor-text" testId="composer" />);
    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.click(input);
    await user.keyboard("hello");

    // Nothing to assert on directly (there is no client to have received a
    // call) — this proves only that mounting without the prop does not
    // throw, matching every other daemon-backed feature's "no live client
    // yet" degradation in this file.
    expect(input.value).toBe("hello");
  });
});

describe("Composer @file/@skill references and per-session drafts (T389)", () => {
  function skill(name: string, description: string) {
    return { name, description, argumentHint: "", kind: "skill" as const };
  }

  it("opens the candidate list from the daemon's skill list and inserts on Enter without sending", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = [skill("release", "Cut a release"), skill("review", "Review a diff")];
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.click(input);
    await user.type(input, "@");

    const list = await screen.findByTestId("composer-references");
    expect(list.textContent).toContain("@release");
    expect(list.textContent).toContain("@review");

    // First candidate is `release` (id order); ArrowDown highlights `review`.
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(input.value).toBe("@review ");
    expect(screen.queryByTestId("composer-references")).toBeNull();
    // Enter chose a candidate — it must not also have sent the message.
    expect(client.sentMessages).toEqual([]);

    const chips = await screen.findByTestId("composer-resolved-references");
    expect(chips.textContent).toContain("@review");
  });

  it("Escape dismisses the candidate list instead of interrupting the turn", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = [skill("review", "Review a diff")];
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.click(input);
    await user.type(input, "@");
    await screen.findByTestId("composer-references");

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("composer-references")).toBeNull();
    expect(client.canceledAgentIds).toEqual([]);
    expect(input.value).toBe("@");
  });

  it("offers @file candidates from the supplied listing port", async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...baseProps()}
        fileReferenceSource={{
          listFiles: async () => [{ kind: "file", id: "src/index.ts", label: "src/index.ts" }],
        }}
        testId="composer"
      />,
    );

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.click(input);
    await user.type(input, "@src");

    const list = await screen.findByTestId("composer-references");
    expect(list.textContent).toContain("src/index.ts");

    await user.keyboard("{Enter}");
    expect(input.value).toBe("@src/index.ts ");
  });

  it("keeps the context ring honest: no telemetry, no percentage", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const ring = screen.getByTestId("composer-context-ring");
    expect(ring.querySelector(".pc-context-ring__pct")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Session controls — context usage not reported" }),
    ).toBeTruthy();
  });

  it("restores the session's persisted draft on mount", async () => {
    const clock = new FakeClock(1_000);
    const storage = new InMemoryStructuredStorage();
    await new coreComposer.DraftStore(storage, clock).save(
      coreComposer.draftKeyForSession({ serverId: "", agentId: "session-1" }),
      { text: "restored draft" },
    );
    render(
      <Composer
        sessionId="session-1"
        clock={clock}
        structuredStorage={storage}
        filePicker={new FakeFilePicker()}
        testId="composer"
      />,
    );

    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).toBe("restored draft"));
  });

  it("has no axe violations with the candidate list open", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = [skill("review", "Review a diff")];
    const { container } = render(<Composer {...baseProps()} client={client} testId="composer" />);

    const input = screen.getByLabelText("Message Pi");
    await user.click(input);
    await user.type(input, "@");
    await screen.findByTestId("composer-references");

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

/**
 * Pi UI Bridge `composer`-kind proposals (plan.md §11.3 "composer update
 * with undo"). The proposal card lives in `features/extensions`, so this
 * suite proves only the composer half: a settled accept/undo delivered
 * through `piUiComposerDrafts` reaches the same textarea the user types in.
 */
describe("Composer — Pi UI composer proposals", () => {
  interface FakeProposal {
    text: string;
    mode?: "replace" | "prefill" | "append";
    previousText?: string;
  }

  function fakeDraftSource(proposal: FakeProposal): PiUiComposerDraftSource & {
    settle: (actionId: string) => void;
  } {
    const listeners = new Set<
      (target: PiUiComposerActionTarget, state: PiUiComposerActionState) => void
    >();
    return {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      resolveProposal(): PiUiComposerProposal {
        return {
          namespace: "composer",
          elementId: "composer",
          payload: {
            kind: "composer",
            text: proposal.text,
            ...(proposal.mode === undefined ? {} : { mode: proposal.mode }),
            ...(proposal.previousText === undefined ? {} : { previousText: proposal.previousText }),
          },
        };
      },
      settle(actionId: string): void {
        const target: PiUiComposerActionTarget = {
          agentId: "session-1",
          namespace: "composer",
          elementId: "composer",
          actionId,
        };
        const state: PiUiComposerActionState = {
          target,
          requestId: "req-1",
          status: "success",
          staleRevision: false,
          source: "result",
          settledAt: 1,
        };
        for (const listener of listeners) listener(target, state);
      },
    };
  }

  it("accept fills the live draft and undo restores what it replaced", () => {
    const source = fakeDraftSource({
      text: "Synthetic rewritten prompt",
      mode: "prefill",
      previousText: "synthetic original draft",
    });
    render(<Composer {...baseProps()} piUiComposerDrafts={source} testId="composer" />);
    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;

    act(() => source.settle("accept"));
    expect(input.value).toBe("Synthetic rewritten prompt");

    act(() => source.settle("undo"));
    expect(input.value).toBe("synthetic original draft");
  });

  it("a decline leaves the draft exactly as typed", async () => {
    const user = userEvent.setup();
    const source = fakeDraftSource({ text: "Synthetic rewritten prompt" });
    render(<Composer {...baseProps()} piUiComposerDrafts={source} testId="composer" />);
    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.type(input, "typed");

    act(() => source.settle("decline"));

    expect(input.value).toBe("typed");
  });

  it("a blank proposal is a no-op", async () => {
    const user = userEvent.setup();
    const source = fakeDraftSource({ text: "   " });
    render(<Composer {...baseProps()} piUiComposerDrafts={source} testId="composer" />);
    const input = screen.getByLabelText("Message Pi") as HTMLTextAreaElement;
    await user.type(input, "typed");

    act(() => source.settle("accept"));

    expect(input.value).toBe("typed");
  });
});
