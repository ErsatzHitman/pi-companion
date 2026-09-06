import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscoveredSessionList } from "./DiscoveredSessionList.js";
import type { DiscoveredSession } from "./discovered-sessions-client.js";
import type { DiscoveredSessionsController } from "./use-discovered-sessions.js";

afterEach(cleanup);

const DISCOVERED: DiscoveredSession = {
  providerId: "pi",
  providerLabel: "Pi",
  providerHandleId: "pi-terminal-handle-0001",
  cwd: "/repo/terminal-project",
  title: null,
  firstPromptPreview: "help me refactor this",
  lastPromptPreview: "run the tests",
  lastActivityAt: "2026-08-31T09:00:00.000Z",
};

function makeController(
  overrides: Partial<DiscoveredSessionsController> = {},
): DiscoveredSessionsController {
  return {
    phase: "idle",
    sessions: [],
    errorMessage: null,
    importingHandleId: null,
    discover: vi.fn(),
    importDiscovered: vi.fn(),
    ...overrides,
  };
}

describe("DiscoveredSessionList (T27B5)", () => {
  it("collapses to nothing when there is nothing discovered", () => {
    render(<DiscoveredSessionList controller={makeController()} />);
    expect(screen.queryByTestId("discovered-session-list")).toBeNull();
  });

  it("shows a loading state while the first discovery request is in flight", () => {
    render(<DiscoveredSessionList controller={makeController({ phase: "loading" })} />);
    expect(screen.getByTestId("discovered-session-list-loading")).toBeTruthy();
  });

  it("shows an error state when discovery fails with nothing yet found", () => {
    render(
      <DiscoveredSessionList
        controller={makeController({ phase: "error", errorMessage: "Not connected" })}
      />,
    );
    const errorState = screen.getByTestId("discovered-session-list-error");
    expect(errorState.textContent).toMatch(/not connected/i);
  });

  it("renders discovered sessions in their own labelled section, distinct from imported ones", () => {
    render(<DiscoveredSessionList controller={makeController({ sessions: [DISCOVERED] })} />);

    const section = screen.getByTestId("discovered-session-list");
    expect(section.textContent).toContain("Discovered sessions");
    expect(
      screen.getByTestId(`discovered-session-row-${DISCOVERED.providerHandleId}`),
    ).toBeTruthy();
    // Untitled discovered sessions fall back to a distinct label from
    // `SessionRow`'s "Untitled session".
    expect(section.textContent).toContain("Untitled Pi session");
  });

  it("clicking Import calls importDiscovered with the row's session", async () => {
    const importDiscovered = vi.fn();
    const user = userEvent.setup();
    render(
      <DiscoveredSessionList
        controller={makeController({ sessions: [DISCOVERED], importDiscovered })}
      />,
    );

    await user.click(
      screen.getByTestId(`discovered-session-import-${DISCOVERED.providerHandleId}`),
    );
    expect(importDiscovered).toHaveBeenCalledWith(DISCOVERED);
  });

  it("disables the Import button for the row currently importing", () => {
    render(
      <DiscoveredSessionList
        controller={makeController({
          sessions: [DISCOVERED],
          importingHandleId: DISCOVERED.providerHandleId,
        })}
      />,
    );

    const button = screen.getByTestId(
      `discovered-session-import-${DISCOVERED.providerHandleId}`,
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toMatch(/importing/i);
  });

  it("has no axe violations with discovered sessions listed", async () => {
    const { container } = render(
      <DiscoveredSessionList controller={makeController({ sessions: [DISCOVERED] })} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
