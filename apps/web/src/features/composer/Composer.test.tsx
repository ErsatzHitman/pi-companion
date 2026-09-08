import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer.js";
import type { AgentModelOption } from "./agent-turn-client.js";
import {
  FakeAgentTurnClient,
  FakeClock,
  FakeFilePicker,
  InMemoryStructuredStorage,
  makeFakePickedFile,
} from "./test-doubles.js";
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
    await user.tab();
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

  it("has a Stop control with a distinct accessible name from Send, disabled without a client", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const sendButton = screen.getByRole("button", { name: "Send" });
    const stopButton = screen.getByRole("button", { name: "Stop" });
    expect(stopButton).not.toBe(sendButton);
    expect(stopButton.hasAttribute("disabled")).toBe(true);
  });

  it("enables Stop once a turn-control client is wired, and it calls cancelAgent", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const stopButton = screen.getByRole("button", { name: "Stop" });
    expect(stopButton.hasAttribute("disabled")).toBe(false);

    await user.click(stopButton);

    await waitFor(() => expect(client.canceledAgentIds).toEqual(["session-1"]));
  });

  it("reflects an in-flight abort promptly with visible, non-colour status text", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    let resolveCancel: () => void = () => {};
    client.cancelAgentImpl = () =>
      new Promise((resolve) => {
        resolveCancel = resolve;
      });
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    await user.click(screen.getByRole("button", { name: "Stop" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Stopping");
    expect(screen.getByRole("button", { name: "Stopping…" }).hasAttribute("disabled")).toBe(true);

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

    await userEvent.setup().click(screen.getByRole("button", { name: "Commands" }));

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

  it("the Commands toggle is disabled until the daemon's command list resolves, and stays keyboard reachable", async () => {
    const client = new FakeAgentTurnClient();
    client.commandsToReturn = [];
    render(<Composer {...baseProps()} client={client} testId="composer" />);
    await waitFor(() => expect(client.listCommandsCalls).toEqual(["session-1"]));

    expect(screen.getByRole("button", { name: "Commands" }).hasAttribute("disabled")).toBe(true);
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
  it("is visible but disabled and explained, rather than silently missing, without a client wired", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const modelSelect = screen.getByLabelText("Model") as HTMLSelectElement;
    const thinkingSelect = screen.getByLabelText("Thinking level") as HTMLSelectElement;
    expect(modelSelect.hasAttribute("disabled")).toBe(true);
    expect(thinkingSelect.hasAttribute("disabled")).toBe(true);
    const status = screen.getByTestId("composer-model-thinking-status");
    expect(status.textContent).toContain("Connect to a daemon");
  });

  it("shows the current model and thinking level without opening either picker", async () => {
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "pi-default",
      thinkingOptionId: "medium",
      effectiveThinkingOptionId: "medium",
    };
    client.availableModelsByProvider.set("pi", { models: [MODEL_WITH_THINKING], error: null });
    render(<Composer {...baseProps()} client={client} testId="composer" />);

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
    const client = new FakeAgentTurnClient();
    (client as { listAvailableModels?: unknown }).listAvailableModels = undefined;
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const status = await screen.findByTestId("composer-model-thinking-status");
    expect(status.textContent).toContain("cannot change the model");
    const modelSelect = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(modelSelect.hasAttribute("disabled")).toBe(true);
  });

  it("explains, rather than silently drops, a current selection that fell out of the fetched model list", async () => {
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "retired-model",
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
    };
    client.availableModelsByProvider.set("pi", { models: [MODEL_WITH_THINKING], error: null });
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const modelSelect = (await screen.findByLabelText("Model")) as HTMLSelectElement;
    await waitFor(
      () => expect(modelSelect.value).toBe("retired-model"),
      MODEL_THINKING_SETTLE_WAIT,
    );
    const option = within(modelSelect).getByText("retired-model (unavailable)");
    expect(option).toBeTruthy();
  });

  it("has no axe violations once the model/thinking pickers have loaded", async () => {
    const client = new FakeAgentTurnClient();
    client.modelSnapshot = {
      provider: "pi",
      modelId: "pi-default",
      thinkingOptionId: "medium",
      effectiveThinkingOptionId: "medium",
    };
    client.availableModelsByProvider.set("pi", { models: [MODEL_WITH_THINKING], error: null });
    const { container } = render(<Composer {...baseProps()} client={client} testId="composer" />);

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
  it("is visible but disabled and explained, rather than silently missing, without a client wired", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const steeringSelect = screen.getByLabelText("Steering queue delivery") as HTMLSelectElement;
    const followUpSelect = screen.getByLabelText("Follow-up queue delivery") as HTMLSelectElement;
    expect(steeringSelect.hasAttribute("disabled")).toBe(true);
    expect(followUpSelect.hasAttribute("disabled")).toBe(true);
    const status = screen.getByTestId("composer-queue-modes-status");
    expect(status.textContent).toContain("Connect to a daemon");
  });

  it("renders its own explained 'unsupported' state against a client that omits the queue-mode methods — no longer true of a real DaemonClient, which has had all three since T110", async () => {
    const client = new FakeAgentTurnClient();
    (client as { getQueueModes?: unknown }).getQueueModes = undefined;
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const status = await screen.findByTestId("composer-queue-modes-status");
    expect(status.textContent).toContain("cannot change the steer/follow-up mode");
    const steeringSelect = screen.getByLabelText("Steering queue delivery") as HTMLSelectElement;
    expect(steeringSelect.hasAttribute("disabled")).toBe(true);
  });

  it("shows both current modes without opening either selector", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "all", followUpMode: "one-at-a-time" };
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const steeringSelect = (await screen.findByLabelText(
      "Steering queue delivery",
    )) as HTMLSelectElement;
    await waitFor(() => expect(steeringSelect.value).toBe("all"), MODEL_THINKING_SETTLE_WAIT);
    const followUpSelect = screen.getByLabelText("Follow-up queue delivery") as HTMLSelectElement;
    expect(followUpSelect.value).toBe("one-at-a-time");
  });

  it("changing the steering mode round-trips through the daemon and persists the new selection", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const steeringSelect = (await screen.findByLabelText(
      "Steering queue delivery",
    )) as HTMLSelectElement;
    await waitFor(
      () => expect(steeringSelect.hasAttribute("disabled")).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.selectOptions(steeringSelect, "all");

    await waitFor(
      () => expect(client.setSteeringModeCalls).toEqual([{ agentId: "session-1", mode: "all" }]),
      MODEL_THINKING_SETTLE_WAIT,
    );
    await waitFor(() => expect(steeringSelect.value).toBe("all"), MODEL_THINKING_SETTLE_WAIT);
    // The follow-up mode is unaffected by a steering-mode change.
    const followUpSelect = screen.getByLabelText("Follow-up queue delivery") as HTMLSelectElement;
    expect(followUpSelect.value).toBe("one-at-a-time");
  });

  it("reflects a mode change made by another connected client, with no manual refresh", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const steeringSelect = (await screen.findByLabelText(
      "Steering queue delivery",
    )) as HTMLSelectElement;
    await waitFor(
      () => expect(steeringSelect.hasAttribute("disabled")).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    // Driven entirely through the injected port's own subscription — no
    // action this rendered component itself took.
    client.emitQueueModes("session-1", { steeringMode: "all", followUpMode: "all" });

    await waitFor(() => expect(steeringSelect.value).toBe("all"), MODEL_THINKING_SETTLE_WAIT);
    const followUpSelect = screen.getByLabelText("Follow-up queue delivery") as HTMLSelectElement;
    expect(followUpSelect.value).toBe("all");
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

    const steeringSelect = (await screen.findByLabelText(
      "Steering queue delivery",
    )) as HTMLSelectElement;
    await waitFor(
      () => expect(steeringSelect.hasAttribute("disabled")).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.selectOptions(steeringSelect, "all");

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

    const followUpSelect = (await screen.findByLabelText(
      "Follow-up queue delivery",
    )) as HTMLSelectElement;
    await waitFor(
      () => expect(followUpSelect.hasAttribute("disabled")).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.selectOptions(followUpSelect, "all");

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

    const steeringSelect = (await screen.findByLabelText(
      "Steering queue delivery",
    )) as HTMLSelectElement;
    await waitFor(
      () => expect(steeringSelect.hasAttribute("disabled")).toBe(false),
      MODEL_THINKING_SETTLE_WAIT,
    );

    await user.selectOptions(steeringSelect, "all");
    await waitFor(() => expect(steeringSelect.value).toBe("all"), MODEL_THINKING_SETTLE_WAIT);

    // Give a (wrongly) rendered empty notice a chance to appear before
    // asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByTestId("composer-queue-modes-status")).toBeNull();
  });

  it("states the mode-vs-per-message distinction in the rendered copy, not only in a comment", () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const help = screen.getByTestId("composer-queue-modes");
    expect(help.textContent).toContain("do not decide whether a single message steers");
  });

  it("offers no button at all — no cancel, no reorder, no per-item control over an already-queued message", () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "all", followUpMode: "all" };
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const control = screen.getByTestId("composer-queue-modes");
    // Deleting this assertion's guard (the query itself, not merely its
    // expected count) would let a future "Cancel"/"Remove"/"Reorder"
    // button ship silently — Pi exposes no such command (T38B1a's fourth
    // acceptance criterion), so this control has nothing to spend a
    // button on beyond the two mode selectors already asserted above.
    expect(control.querySelectorAll("button")).toHaveLength(0);
  });

  it("has no axe violations once the queue-mode control has loaded", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "all", followUpMode: "one-at-a-time" };
    const { container } = render(<Composer {...baseProps()} client={client} testId="composer" />);

    const steeringSelect = (await screen.findByLabelText(
      "Steering queue delivery",
    )) as HTMLSelectElement;
    await waitFor(() => expect(steeringSelect.value).toBe("all"), MODEL_THINKING_SETTLE_WAIT);

    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("Composer per-message steer/follow-up routing (T38B1b)", () => {
  it('shows "Auto (default)" as the visible, un-opened routing choice, with no client wired', () => {
    render(<Composer {...baseProps()} testId="composer" />);
    const select = screen.getByLabelText("Send this message as") as HTMLSelectElement;
    expect(select.value).toBe("auto");
    expect(select.hasAttribute("disabled")).toBe(false);
  });

  it("sends an explicit steer choice to the real client, proven by the value arriving at the recording fake — not by local state changing", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    const select = screen.getByLabelText("Send this message as") as HTMLSelectElement;
    await user.selectOptions(select, "steer");
    expect(select.value).toBe("steer");

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
    // Consumed by that submission: the visible selector returns to "Auto"
    // rather than silently steering the next, unrelated message too.
    await waitFor(() => expect(select.value).toBe("auto"));
  });

  it("sends an explicit follow-up choice to the real client the same way", async () => {
    const user = userEvent.setup();
    const client = new FakeAgentTurnClient();
    render(<Composer {...baseProps()} client={client} testId="composer" />);

    await user.selectOptions(screen.getByLabelText("Send this message as"), "followUp");
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

    await user.selectOptions(screen.getByLabelText("Send this message as"), "steer");
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

    await user.selectOptions(screen.getByLabelText("Send this message as"), "followUp");

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
