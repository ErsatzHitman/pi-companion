import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeleteSessionDialog } from "./DeleteSessionDialog.js";
import type { SessionActionsController } from "./use-session-actions.js";
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

function makeController(
  overrides: Partial<SessionActionsController> = {},
): SessionActionsController {
  return {
    archivingSessionId: null,
    deleteDialogOpen: false,
    deleteTarget: null,
    deletePhase: "idle",
    archive: vi.fn(),
    requestDelete: vi.fn(),
    confirmDelete: vi.fn(),
    cancelDelete: vi.fn(),
    ...overrides,
  };
}

describe("DeleteSessionDialog (T27B4)", () => {
  it("renders nothing when closed", () => {
    render(<DeleteSessionDialog controller={makeController()} />);
    expect(screen.queryByTestId("delete-session-dialog")).toBeNull();
  });

  it("names the target session and requires an explicit confirm click", async () => {
    const confirmDelete = vi.fn();
    const controller = makeController({
      deleteDialogOpen: true,
      deleteTarget: SESSION,
      confirmDelete,
    });
    const user = userEvent.setup();
    render(<DeleteSessionDialog controller={controller} />);

    const dialog = screen.getByTestId("delete-session-dialog");
    expect(dialog.getAttribute("role")).toBe("alertdialog");
    expect(dialog.textContent).toContain("Refactor router");
    expect(confirmDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirmDelete).toHaveBeenCalledTimes(1);
  });

  it("cancels via cancelDelete without confirming", async () => {
    const cancelDelete = vi.fn();
    const confirmDelete = vi.fn();
    const controller = makeController({
      deleteDialogOpen: true,
      deleteTarget: SESSION,
      confirmDelete,
      cancelDelete,
    });
    const user = userEvent.setup();
    render(<DeleteSessionDialog controller={controller} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelDelete).toHaveBeenCalledTimes(1);
    expect(confirmDelete).not.toHaveBeenCalled();
  });

  it("falls back to 'Untitled session' for a session with no title", () => {
    const controller = makeController({
      deleteDialogOpen: true,
      deleteTarget: { ...SESSION, title: null },
    });
    render(<DeleteSessionDialog controller={controller} />);
    expect(screen.getByTestId("delete-session-dialog").textContent).toContain("Untitled session");
  });

  it("has no axe violations while open", async () => {
    const controller = makeController({ deleteDialogOpen: true, deleteTarget: SESSION });
    const { container } = render(<DeleteSessionDialog controller={controller} />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
