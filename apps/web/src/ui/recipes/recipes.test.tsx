import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalForm } from "./ApprovalForm.js";
import { CommandSearch } from "./CommandSearch.js";
import { DiffSummary } from "./DiffSummary.js";
import { PromptBar } from "./PromptBar.js";
import { ThinkingSection } from "./ThinkingSection.js";
import { ToolChips } from "./ToolChips.js";
import { WorkflowSteps } from "./WorkflowSteps.js";

/**
 * T25B recipe accessibility/keyboard-operation checks (plan.md §10.5):
 * accessible name, keyboard operation, screen-reader role/state, and
 * non-colour status signalling for a representative slice of the §10.4
 * recipes (the recipe-lab test covers "every recipe renders + no axe
 * violations across the whole page").
 */
afterEach(cleanup);

describe("ThinkingSection", () => {
  it("is a keyboard-operable disclosure with an exposed expanded state", async () => {
    const user = userEvent.setup();
    render(<ThinkingSection summary="Thought for 4s" body="Reasoning body" durationLabel="4s" />);
    const trigger = screen.getByRole("button", { name: /Thought for 4s/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ThinkingSection
        summary="Thought for 4s"
        body="Reasoning body"
        durationLabel="4s"
        defaultExpanded
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("ApprovalForm", () => {
  it("exposes an accessible group name and keyboard-operable Approve/Deny", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(
      <ApprovalForm
        toolLabel="Write file"
        detail="src/x.ts"
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );
    expect(screen.getByRole("group", { name: /Write file needs your approval/ })).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve" });
    approve.focus();
    await user.keyboard("{Enter}");
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("shows a non-colour warning for dangerous actions", () => {
    render(
      <ApprovalForm
        toolLabel="Run command"
        detail="rm -rf build/"
        dangerous
        onApprove={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(screen.getByText(/Requires extra caution/)).toBeTruthy();
  });
});

describe("ToolChips", () => {
  it("pairs every tone with visible status text", () => {
    render(
      <ToolChips
        ariaLabel="Tool permissions"
        items={[
          { id: "write", label: "Write", tone: "warning", statusText: "Needs approval" },
          { id: "net", label: "Network", tone: "danger", statusText: "Denied" },
        ]}
      />,
    );
    expect(screen.getByRole("list", { name: "Tool permissions" })).toBeTruthy();
    expect(screen.getByText("Needs approval")).toBeTruthy();
    expect(screen.getByText("Denied")).toBeTruthy();
  });
});

describe("PromptBar", () => {
  it("has a labelled input and sends on Enter", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState("");
      const onSend = vi.fn();
      return (
        <PromptBar
          label="Prompt"
          placeholder="Ask Pi…"
          value={value}
          canSend={value.length > 0}
          queuedCount={0}
          onValueChange={setValue}
          onSend={() => {
            onSend(value);
            setValue("");
          }}
          testId="prompt-bar"
        />
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("Prompt");
    await user.type(input, "Hello");
    await user.keyboard("{Enter}");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });
});

describe("CommandSearch", () => {
  it("supports arrow-key navigation and Enter to choose an option", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CommandSearch
        label="Search commands"
        placeholder="Search…"
        items={[
          { id: "compact", label: "/compact", hint: "Compact the transcript" },
          { id: "clear", label: "/clear", hint: "Start a new session" },
        ]}
        onSelect={onSelect}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Search commands" });
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith({
      id: "clear",
      label: "/clear",
      hint: "Start a new session",
    });
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <CommandSearch
        label="Search commands"
        placeholder="Search…"
        items={[{ id: "compact", label: "/compact", hint: "Compact the transcript" }]}
        onSelect={() => {}}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Search commands" });
    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("WorkflowSteps", () => {
  it("marks the active step with aria-current and shows non-colour status text", () => {
    render(
      <WorkflowSteps
        ariaLabel="Pairing progress"
        items={[
          { id: "scan", label: "Scan pairing code", status: "complete" },
          { id: "connect", label: "Establish connection", status: "active" },
        ]}
      />,
    );
    const activeItem = screen.getByText("Establish connection").closest("li");
    expect(activeItem?.getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("In progress")).toBeTruthy();
  });
});

describe("DiffSummary", () => {
  it("exposes a word summary via aria-label alongside the +/- text", () => {
    render(<DiffSummary path="src/x.ts" added={3} removed={1} modified={0} />);
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    expect(screen.getByLabelText("src/x.ts: 3 added, 1 removed")).toBeTruthy();
  });
});
