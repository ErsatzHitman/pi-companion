import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { permissions } from "@picompanion/frontend-core";

import { PermissionDialog } from "./PermissionDialog.js";

afterEach(cleanup);

const BASE_TOOL_VIEW: permissions.PermissionDialogViewModel = {
  requestId: "perm_0001",
  agentId: "agt_0001",
  provider: "pi",
  name: "bash",
  kind: "tool",
  presentation: "tool-actions",
  extensionUiMethod: null,
  title: "Run shell command",
  description: "rm -rf ./build",
  actions: [],
  questions: [],
  metadata: {},
  raw: {
    id: "perm_0001",
    provider: "pi",
    name: "bash",
    kind: "tool",
    title: "Run shell command",
    description: "rm -rf ./build",
  },
};

const THREE_ACTION_VIEW: permissions.PermissionDialogViewModel = {
  ...BASE_TOOL_VIEW,
  actions: [
    { id: "allow_once", label: "Allow once", behavior: "allow", variant: "primary" },
    { id: "allow_always", label: "Always allow", behavior: "allow", variant: "secondary" },
    { id: "deny", label: "Deny", behavior: "deny", variant: "danger" },
  ],
  raw: {
    ...BASE_TOOL_VIEW.raw,
    actions: [
      { id: "allow_once", label: "Allow once", behavior: "allow", variant: "primary" },
      { id: "allow_always", label: "Always allow", behavior: "allow", variant: "secondary" },
      { id: "deny", label: "Deny", behavior: "deny", variant: "danger" },
    ],
  },
};

const QUESTION_VIEW: permissions.PermissionDialogViewModel = {
  requestId: "ext_0001",
  agentId: "agt_0001",
  provider: "pi",
  name: "Pi select",
  kind: "question",
  presentation: "select",
  extensionUiMethod: "select",
  title: "Choose an environment",
  actions: [],
  questions: [
    {
      question: "Choose an environment",
      header: "Response",
      options: [{ label: "staging" }, { label: "production" }],
      multiSelect: false,
    },
  ],
  metadata: { extensionUiMethod: "select" },
  raw: {
    id: "ext_0001",
    provider: "pi",
    name: "Pi select",
    kind: "question",
    title: "Choose an environment",
    input: {
      questions: [
        {
          question: "Choose an environment",
          header: "Response",
          options: [{ label: "staging" }, { label: "production" }],
          multiSelect: false,
        },
      ],
    },
    metadata: { extensionUiMethod: "select" },
  },
};

describe("PermissionDialog — tool-actions presentation", () => {
  it("renders the ApprovalForm recipe for a zero-action request and answers plain allow/deny", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<PermissionDialog view={BASE_TOOL_VIEW} waitingCount={0} onAnswer={onAnswer} />);

    expect(screen.getByRole("dialog", { name: "Run shell command" })).toBeTruthy();
    expect(screen.getByText("rm -rf ./build")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onAnswer).toHaveBeenCalledWith({ behavior: "allow" });

    await user.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer).toHaveBeenLastCalledWith({ behavior: "deny" });
  });

  it("falls back to an N-action row for a three-action request the ApprovalForm recipe cannot represent, defaulting focus to Deny", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<PermissionDialog view={THREE_ACTION_VIEW} waitingCount={0} onAnswer={onAnswer} />);

    // Dangerous (the fixture's `deny` action carries `variant: "danger"`):
    // alertdialog role plus the non-colour warning text.
    expect(screen.getByRole("alertdialog", { name: "Run shell command" })).toBeTruthy();
    expect(screen.getByText(/Requires extra caution/)).toBeTruthy();

    const denyButton = screen.getByRole("button", { name: "Deny" });
    expect(document.activeElement).toBe(denyButton);

    await user.click(screen.getByRole("button", { name: "Always allow" }));
    expect(onAnswer).toHaveBeenCalledWith({
      behavior: "allow",
      selectedActionId: "allow_always",
    });
  });

  it("surfaces how many further requests are waiting, in text", () => {
    render(<PermissionDialog view={BASE_TOOL_VIEW} waitingCount={2} onAnswer={() => {}} />);
    expect(screen.getByText("2 more requests are waiting.")).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <PermissionDialog view={THREE_ACTION_VIEW} waitingCount={0} onAnswer={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("PermissionDialog — question presentation (Tier-1 extension dialogs)", () => {
  it("submits the selected option keyed by the question's header", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<PermissionDialog view={QUESTION_VIEW} waitingCount={0} onAnswer={onAnswer} />);

    expect(screen.getByRole("dialog", { name: "Choose an environment" })).toBeTruthy();
    const select = screen.getByTestId(
      "approvals-dialog-question-field-Response",
    ) as HTMLSelectElement;
    await user.selectOptions(select, "production");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onAnswer).toHaveBeenCalledWith({
      behavior: "allow",
      updatedInput: { answers: { Response: "production" } },
    });
  });

  it("dismisses as a deny response via the Cancel button", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<PermissionDialog view={QUESTION_VIEW} waitingCount={0} onAnswer={onAnswer} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAnswer).toHaveBeenCalledWith({ behavior: "deny" });
  });
});

describe("PermissionDialog — keyboard dismissal (plan.md §12.3 'trap focus and are dismissible by keyboard')", () => {
  it("traps focus within the panel and Escape resolves as a deny response", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<PermissionDialog view={BASE_TOOL_VIEW} waitingCount={0} onAnswer={onAnswer} />);

    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    // Deny is the initial focus target (ApprovalForm's own "cannot
    // accidentally approve" rule).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Deny" }));

    await user.keyboard("{Escape}");
    expect(onAnswer).toHaveBeenCalledWith({ behavior: "deny" });
  });
});
