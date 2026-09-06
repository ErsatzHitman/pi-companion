import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RenameSessionDialog } from "./RenameSessionDialog.js";
import type { RenameSessionController } from "./use-rename-session.js";
import type { SessionSummary } from "./types.js";

afterEach(cleanup);

const SESSION: SessionSummary = {
  id: "s-1",
  title: "Refactor router",
  provider: "pi",
  cwd: "/repo/demo",
  status: "idle",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function makeController(overrides: Partial<RenameSessionController> = {}): RenameSessionController {
  return {
    renameDialogOpen: false,
    renameTarget: null,
    renameDraft: "",
    renamePhase: "idle",
    renameValidationError: null,
    renameErrorMessage: null,
    requestRename: vi.fn(),
    setRenameDraft: vi.fn(),
    confirmRename: vi.fn(),
    cancelRename: vi.fn(),
    reconcileTitle: vi.fn(),
    ...overrides,
  };
}

describe("RenameSessionDialog (T38A4)", () => {
  it("renders nothing when closed", () => {
    render(<RenameSessionDialog controller={makeController()} />);
    expect(screen.queryByTestId("rename-session-dialog")).toBeNull();
  });

  it("names the target session, prefills the draft, and requires an explicit confirm click", async () => {
    const confirmRename = vi.fn();
    const controller = makeController({
      renameDialogOpen: true,
      renameTarget: SESSION,
      renameDraft: "Refactor router",
      confirmRename,
    });
    const user = userEvent.setup();
    render(<RenameSessionDialog controller={controller} />);

    const dialog = screen.getByTestId("rename-session-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.textContent).toContain("Refactor router");
    expect((screen.getByTestId("rename-session-name-field") as HTMLInputElement).value).toBe(
      "Refactor router",
    );
    expect(confirmRename).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(confirmRename).toHaveBeenCalledTimes(1);
  });

  it("types into the field through setRenameDraft, one keystroke at a time", async () => {
    const setRenameDraft = vi.fn();
    const controller = makeController({
      renameDialogOpen: true,
      renameTarget: SESSION,
      renameDraft: "",
      setRenameDraft,
    });
    const user = userEvent.setup();
    render(<RenameSessionDialog controller={controller} />);

    await user.type(screen.getByTestId("rename-session-name-field"), "Hi");

    expect(setRenameDraft).toHaveBeenCalledTimes(2);
    expect(setRenameDraft).toHaveBeenNthCalledWith(1, "H");
    expect(setRenameDraft).toHaveBeenNthCalledWith(2, "i");
  });

  it("cancels via cancelRename without confirming", async () => {
    const cancelRename = vi.fn();
    const confirmRename = vi.fn();
    const controller = makeController({
      renameDialogOpen: true,
      renameTarget: SESSION,
      cancelRename,
      confirmRename,
    });
    const user = userEvent.setup();
    render(<RenameSessionDialog controller={controller} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelRename).toHaveBeenCalledTimes(1);
    expect(confirmRename).not.toHaveBeenCalled();
  });

  it("falls back to 'Untitled session' in the description for a session with no title", () => {
    const controller = makeController({
      renameDialogOpen: true,
      renameTarget: { ...SESSION, title: null },
    });
    render(<RenameSessionDialog controller={controller} />);
    expect(screen.getByTestId("rename-session-dialog").textContent).toContain("Untitled session");
  });

  it("shows a validation error inline (never calling the client) when the draft is invalid", () => {
    const controller = makeController({
      renameDialogOpen: true,
      renameTarget: SESSION,
      renameDraft: "",
      renameValidationError: "Enter a name for this session.",
    });
    render(<RenameSessionDialog controller={controller} />);

    const field = screen.getByTestId("rename-session-name-field");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Enter a name for this session.");
  });

  it("shows a daemon error banner, worded through explainSessionsActionError, when a submit fails", () => {
    const controller = makeController({
      renameDialogOpen: true,
      renameTarget: SESSION,
      renameErrorMessage: "SESSIONS_NOT_CONNECTED",
    });
    render(<RenameSessionDialog controller={controller} />);

    const banner = screen.getByTestId("rename-session-error-banner");
    expect(banner.textContent).toMatch(/not connected/i);
    expect(banner.textContent).toMatch(/renaming a session/i);
  });

  it("shows a 'Renaming…' confirm label while a submit is in flight", () => {
    const controller = makeController({
      renameDialogOpen: true,
      renameTarget: SESSION,
      renamePhase: "renaming",
    });
    render(<RenameSessionDialog controller={controller} />);
    expect(screen.getByRole("button", { name: "Renaming…" })).toBeTruthy();
  });

  it("has no axe violations while open", async () => {
    const controller = makeController({ renameDialogOpen: true, renameTarget: SESSION });
    const { container } = render(<RenameSessionDialog controller={controller} />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
