import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * `primitives.css` rule-text pins for two rules jsdom never applies
 * (jsdom does not load stylesheets, so `getComputedStyle` proves nothing
 * here — same reasoning and the same `readFileSync`+`ruleBodyFor`
 * pattern as `features/rail/pi-extension-rail.test.tsx`'s own CSS
 * describe block, followed rather than reinvented).
 */
describe("primitives.css (declared rule text, not getComputedStyle)", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "primitives.css"), "utf8");
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const ruleBodyFor = (selector: string) => {
    const at = stripped.indexOf(`${selector} {`);
    expect(at, `${selector} not found in primitives.css`).toBeGreaterThanOrEqual(0);
    const close = stripped.indexOf("}", at);
    expect(close, `${selector} has no closing brace`).toBeGreaterThan(at);
    return stripped.slice(at, close);
  };

  it("applies the pc-status-pill-breathe keyframe animation to an info-tone pill's dot", () => {
    expect(ruleBodyFor(".pc-status-pill--info .pc-status-pill__dot")).toMatch(
      /animation:\s*pc-status-pill-breathe\s+1\.6s\s+ease-in-out\s+infinite/,
    );
  });

  it("declares the pc-status-pill-breathe keyframes with a full-opacity start/end and a dimmed midpoint", () => {
    const at = stripped.indexOf("@keyframes pc-status-pill-breathe");
    expect(at, "pc-status-pill-breathe keyframes not found").toBeGreaterThanOrEqual(0);
    const close = stripped.indexOf("}", stripped.indexOf("}", at) + 1);
    const body = stripped.slice(at, close);
    expect(body).toMatch(/opacity:\s*1/);
    expect(body).toMatch(/opacity:\s*0\.25/);
  });

  it("turns the breathe animation off under prefers-reduced-motion for the info-tone pill's dot", () => {
    const at = stripped.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at, "no prefers-reduced-motion block found").toBeGreaterThanOrEqual(0);
    const scopeStart = stripped.indexOf(".pc-status-pill--info .pc-status-pill__dot", at);
    expect(
      scopeStart,
      "prefers-reduced-motion block does not guard .pc-status-pill--info .pc-status-pill__dot",
    ).toBeGreaterThan(at);
    const bodyStart = stripped.indexOf("{", scopeStart);
    const bodyClose = stripped.indexOf("}", bodyStart);
    expect(stripped.slice(bodyStart, bodyClose)).toMatch(/animation:\s*none/);
  });

  it("styles .pc-chip-emphasis with the ink colour token and medium font weight", () => {
    const body = ruleBodyFor(".pc-chip-emphasis");
    expect(body).toMatch(/color:\s*var\(--color-ink\)/);
    expect(body).toMatch(/font-weight:\s*var\(--font-weight-medium\)/);
  });

  /**
   * Pins the mockup's `.tool-out { font-size: 11.5px; color: var(--ink-2) }`
   * (C:/Users/aksha/Downloads/pi-ui-goal/web-spec.html) — `.pc-code-block`
   * used to be `--code-code-foreground` (the PRIMARY ink role,
   * `packages/design-tokens/src/tokens.ts`'s `codeForeground: p.ink`) and
   * `--font-size-sm` (11px, one step short of the mockup's 11.5px).
   */
  it("colours pc-code-block at the secondary ink role and the 11.5px size step", () => {
    const body = ruleBodyFor(".pc-code-block");
    expect(body).toMatch(/color:\s*var\(--color-ink-2\)/);
    expect(body).toMatch(/font-size:\s*var\(--font-size-md\)/);
  });

  /**
   * Pins the mockup's `.sw`/`.sw[aria-pressed="true"]` track
   * (C:/Users/aksha/Downloads/pi-ui-goal/web-spec.html): no `box-shadow` on
   * the track in either state, and a solid `--accent` fill when checked —
   * not the `--color-accent-tint` near-white tint this rule used to draw
   * alongside a 1px accent ring.
   */
  it("draws pc-toggle's track with no box-shadow, and a solid accent fill when checked", () => {
    const unchecked = ruleBodyFor(".pc-toggle");
    expect(unchecked).not.toMatch(/box-shadow/);
    const checked = ruleBodyFor('.pc-toggle[aria-checked="true"]');
    expect(checked).not.toMatch(/box-shadow/);
    expect(checked).toMatch(/background-color:\s*var\(--color-accent\)/);
    expect(checked).not.toMatch(/--color-accent-tint/);
  });
});
