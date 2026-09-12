import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RewindDialog } from "./RewindDialog.js";
import type { RewindDialogProps } from "./RewindDialog.js";
import type { UndoneTurn } from "./undone-turns.js";

afterEach(cleanup);

const UNDONE: readonly UndoneTurn[] = [
  {
    messageId: "msg-2",
    snippet: "actually, use TypeScript instead",
    mode: "conversation" as const,
  },
  { messageId: "msg-1", snippet: "add a login form", mode: "both" as const },
];

function props(overrides: Partial<RewindDialogProps> = {}): RewindDialogProps {
  return {
    open: true,
    target: { messageId: "msg-2", snippet: "actually, use TypeScript instead" },
    mode: "conversation" as const,
    status: "idle",
    message: null,
    turnRunning: false,
    connected: true,
    canSubmit: true,
    undoneTurns: [],
    onSelectMode: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onRestoreAnyway: vi.fn(),
    onReturnToTurn: vi.fn(),
    ...overrides,
  };
}

describe("RewindDialog (T395)", () => {
  it("offers exactly the three daemon scopes with an honest sentence each", () => {
    render(<RewindDialog {...props()} />);

    expect(screen.getByRole("radio", { name: /Conversation only/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Files only/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Conversation and files/ })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);

    expect(screen.getByText(/Rewinds the chat to this message/)).toBeTruthy();
    expect(screen.getByText(/Restores the workspace's files/)).toBeTruthy();
    expect(screen.getByText(/Rewinds the chat and restores the files/)).toBeTruthy();
  });

  it("renders the unsupported outcome's own honest message, never a force retry", () => {
    render(
      <RewindDialog
        {...props({
          status: "unsupported",
          mode: "files" as const,
          message: "the provider cannot rewind files",
        })}
      />,
    );

    expect(screen.getByTestId("rewind-dialog-notice").textContent).toContain(
      "This provider can't rewind the files here.",
    );
    expect(screen.getByTestId("rewind-dialog-daemon-message").textContent).toBe(
      "the provider cannot rewind files",
    );
    expect(screen.queryByTestId("rewind-dialog-restore-anyway")).toBeNull();
    expect(screen.getByTestId("rewind-dialog-close")).toBeTruthy();
  });

  it("renders the failed outcome's own honest message", () => {
    render(<RewindDialog {...props({ status: "failed", message: "the daemon is busy" })} />);

    expect(screen.getByTestId("rewind-dialog-notice").textContent).toContain("The rewind failed.");
    expect(screen.getByTestId("rewind-dialog-daemon-message").textContent).toBe(
      "the daemon is busy",
    );
    expect(screen.queryByTestId("rewind-dialog-restore-anyway")).toBeNull();
  });

  it("explains a conflict and re-issues only when Restore anyway is pressed", async () => {
    const user = userEvent.setup();
    const onRestoreAnyway = vi.fn();
    const onSubmit = vi.fn();
    render(
      <RewindDialog
        {...props({
          status: "conflict",
          message: "work tree changed since the snapshot",
          onRestoreAnyway,
          onSubmit,
        })}
      />,
    );

    expect(screen.getByTestId("rewind-dialog-notice").textContent).toContain(
      "The work tree changed since this snapshot",
    );
    // Opening a conflict never silently retries.
    expect(onRestoreAnyway).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("rewind-dialog-restore-anyway"));
    expect(onRestoreAnyway).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables Submit and explains the gate while a turn is running", () => {
    render(<RewindDialog {...props({ turnRunning: true, canSubmit: false })} />);

    const submit = screen.getByTestId("rewind-dialog-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId("rewind-dialog-turn-running").textContent).toContain(
      "A turn is still running",
    );
  });

  it("renders the undone list as an explicit local record and returns through the controller", async () => {
    const user = userEvent.setup();
    const onReturnToTurn = vi.fn();
    render(<RewindDialog {...props({ undoneTurns: UNDONE, onReturnToTurn })} />);

    expect(screen.getByTestId("rewind-dialog-undone-hint").textContent).toContain(
      "Local record of rewinds in this browser session — not daemon state.",
    );
    expect(screen.getByText("actually, use TypeScript instead")).toBeTruthy();
    expect(screen.getByText("add a login form")).toBeTruthy();

    await user.click(screen.getByTestId("rewind-dialog-return-msg-2"));
    expect(onReturnToTurn).toHaveBeenCalledTimes(1);
    expect(onReturnToTurn).toHaveBeenCalledWith(UNDONE[0]);
  });

  it("has no axe violations with the scopes and the undone list rendered", async () => {
    const { container } = render(<RewindDialog {...props({ undoneTurns: UNDONE })} />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
