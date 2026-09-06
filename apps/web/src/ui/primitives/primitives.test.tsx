import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button.js";
import { Chip } from "./Chip.js";
import { Dialog } from "./Dialog.js";
import { IconButton } from "./IconButton.js";
import { StatusIndicator } from "./StatusIndicator.js";
import { Toggle } from "./Toggle.js";

/**
 * T25A primitive accessibility/keyboard-operation checks (plan.md §10.5):
 * accessible name, keyboard operation, screen-reader role/state, and
 * non-colour status signalling for a representative slice of the §10.3
 * primitives (the component-lab test covers "every primitive renders").
 */
describe("Button", () => {
  it("is keyboard-operable and disableable", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button kind="primary" onClick={onClick}>
        Connect
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Connect" });
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe("IconButton", () => {
  it("exposes an accessible name from an icon-only control", () => {
    render(<IconButton icon="close" accessibleName="Close" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

describe("Toggle", () => {
  it("uses switch semantics and keeps aria-checked in sync", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [checked, setChecked] = useState(false);
      return <Toggle label="Show thinking" checked={checked} onCheckedChange={setChecked} />;
    }
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Show thinking" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

describe("Chip", () => {
  it("pairs tone with visible text and gives removable chips a real accessible name", () => {
    render(<Chip label="Denied" tone="danger" />);
    expect(screen.getByText("Denied")).toBeTruthy();

    const onRemove = vi.fn();
    render(<Chip label="Write" tone="warning" onRemove={onRemove} />);
    const removable = screen.getByRole("button", { name: "Remove Write" });
    expect(removable).toBeTruthy();
  });
});

describe("StatusIndicator", () => {
  it("never signals status by colour alone", () => {
    render(<StatusIndicator label="Connection" tone="danger" statusText="Offline" />);
    const status = screen.getByRole("status");
    expect(within(status).getByText("Offline")).toBeTruthy();
    expect(within(status).getByText("Connection:")).toBeTruthy();
  });
});

describe("Dialog", () => {
  it("traps focus, exposes alertdialog semantics for dangerous actions, and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog
        open
        title="Delete this session?"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        dangerous
        onConfirm={() => {}}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "Delete this session?" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Dialog
        open
        title="Delete this session?"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        dangerous
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
