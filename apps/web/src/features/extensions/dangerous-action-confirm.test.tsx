import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PiUiAction } from "@picompanion/protocol/pi-ui-bridge/schema";

import { DangerousActionConfirmDialog } from "./dangerous-action-confirm.js";

/**
 * T29B5 — dangerous-action confirmation dialog. Acceptance criteria
 * exercised here (the dialog's own contract; `registry.test.tsx` exercises
 * the full click -> dialog -> dispatch gate through `PiUiElementView`):
 *
 * - "A dangerous action cannot fire without confirmation"
 * - "The confirmation names the action and its consequence"
 */

afterEach(cleanup);

const STOP_ACTION: PiUiAction = {
  id: "stop",
  label: "Stop workflow",
  variant: "danger",
  confirm: "This cancels every remaining step and cannot be resumed.",
};

describe("DangerousActionConfirmDialog", () => {
  it("renders nothing when no action is pending", () => {
    render(
      <DangerousActionConfirmDialog
        action={undefined}
        elementLabel="Deploy workflow"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("dangerous-action-confirm-dialog")).toBeNull();
  });

  it("names the action and states its consequence", () => {
    render(
      <DangerousActionConfirmDialog
        action={STOP_ACTION}
        elementLabel="Deploy workflow"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId("dangerous-action-confirm-dialog");
    expect(dialog.getAttribute("role")).toBe("alertdialog");
    // Names the action.
    expect(dialog.textContent).toContain("Stop workflow");
    // States its consequence, verbatim from the wire `confirm` message.
    expect(dialog.textContent).toContain(
      "This cancels every remaining step and cannot be resumed.",
    );
    // Extra disambiguating context, when given.
    expect(dialog.textContent).toContain("Deploy workflow");
  });

  it("omits the target line when no elementLabel is given", () => {
    render(
      <DangerousActionConfirmDialog
        action={STOP_ACTION}
        elementLabel={undefined}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/^For:/)).toBeNull();
  });

  it("only confirms on an explicit confirm click, never automatically", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DangerousActionConfirmDialog
        action={STOP_ACTION}
        elementLabel="Deploy workflow"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('gives the confirm and cancel buttons distinct accessible names even when the action\'s own label is itself "Cancel"', () => {
    render(
      <DangerousActionConfirmDialog
        action={{ id: "cancel", label: "Cancel", variant: "danger", confirm: "Cancel this row?" }}
        elementLabel="Row 1"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Exactly one enabled "Cancel" (decline) and one "Confirm" (proceed)
    // button, never two buttons sharing the action's own "Cancel" label.
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("cancels via the Cancel button without confirming", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <DangerousActionConfirmDialog
        action={STOP_ACTION}
        elementLabel="Deploy workflow"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on Escape (keyboard operable, plan.md §10.5)", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <DangerousActionConfirmDialog
        action={STOP_ACTION}
        elementLabel="Deploy workflow"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations while open", async () => {
    const { container } = render(
      <DangerousActionConfirmDialog
        action={STOP_ACTION}
        elementLabel="Deploy workflow"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
