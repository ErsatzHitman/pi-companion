import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BootstrapConnectStatus } from "./BootstrapConnectStatus.js";

afterEach(cleanup);

describe("BootstrapConnectStatus (T27A5)", () => {
  it("announces a connecting hint through role=status, without a retry action", () => {
    render(
      <BootstrapConnectStatus
        label="my-mac"
        phase="connecting"
        message="Connecting to my-mac…"
        onRetry={vi.fn()}
        onUseManual={vi.fn()}
      />,
    );

    const statuses = screen.getAllByRole("status");
    expect(statuses.some((el) => el.textContent?.includes("Connecting to my-mac"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Connect to a different daemon" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("surfaces a distinct, non-colour-only error state with a retry action", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <BootstrapConnectStatus
        label="my-mac"
        phase="error"
        message="Could not connect to my-mac."
        onRetry={onRetry}
        onUseManual={vi.fn()}
      />,
    );

    expect(screen.getByTestId("bootstrap-connect-error-banner").textContent).toContain(
      "Could not connect to my-mac.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("lets the user explicitly switch to manual entry", async () => {
    const user = userEvent.setup();
    const onUseManual = vi.fn();
    render(
      <BootstrapConnectStatus
        label="my-mac"
        phase="success"
        message="Connected to my-mac."
        onRetry={vi.fn()}
        onUseManual={onUseManual}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Connect to a different daemon" }));
    expect(onUseManual).toHaveBeenCalledTimes(1);
  });

  it("has no detectable accessibility violations in any phase", async () => {
    for (const phase of ["connecting", "success", "error"] as const) {
      const { container, unmount } = render(
        <BootstrapConnectStatus
          label="my-mac"
          phase={phase}
          message={`status for ${phase}`}
          onRetry={vi.fn()}
          onUseManual={vi.fn()}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  }, 15_000);
});
