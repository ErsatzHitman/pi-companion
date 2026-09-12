import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { PiExtensionSheetHost } from "./PiExtensionSheetHost.js";

/**
 * `PiExtensionSheetHost` — the web `sheet`-placement destination
 * (plan.md §11.3, §11.5). The `Sheet` primitive already existed (used by
 * QR pairing) but no extension element ever reached it before this host.
 * These tests cover the placement filter, opening on a new element, the
 * "dismiss resolves nothing" contract, re-open only for a genuinely new
 * element, action dispatch, and axe.
 */

afterEach(cleanup);

/** Deterministic, manually-advanced `Clock` (no real timers; plan.md §7.3). */
class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;

  now(): number {
    return this.time;
  }
  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    void callback;
    void delayMs;
    return id as unknown as TimerHandle;
  }
  clearTimeout(): void {}
  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    return this.setTimeout(callback, intervalMs);
  }
  clearInterval(): void {}
}

function makeController(
  sendRequest: (message: unknown) => void = () => {},
): extensions.ExtensionActionController {
  return new extensions.ExtensionActionController({
    clock: new FakeClock(),
    sendRequest: sendRequest as never,
  });
}

/** plan.md §11.7: ask-user's sheet panel. */
const askUserSheet: PiUiElement = {
  id: "ask",
  ns: "ask-user",
  kind: "panel",
  placement: "sheet",
  title: "Confirm deployment",
  actions: [{ id: "dismiss", label: "Dismiss" }],
  payload: {
    kind: "panel",
    sections: [
      {
        id: "body",
        kind: "markdown",
        payload: { kind: "markdown", text: "Deploy to **staging**?" },
      },
    ],
  },
} as PiUiElement;

/** plan.md §11.7: loop's sheet panel. */
const loopSheet: PiUiElement = {
  id: "run-7",
  ns: "loop",
  kind: "panel",
  placement: "sheet",
  title: "Loop run #7",
  payload: { kind: "panel", sections: [] },
} as PiUiElement;

const pinnedSibling: PiUiElement = {
  id: "fleet",
  ns: "subagents",
  kind: "roster",
  placement: "pinned",
  payload: { kind: "roster", rows: [] },
};

const inlineSibling: PiUiElement = {
  id: "footer",
  ns: "prompt-arbitrage",
  kind: "status",
  placement: "inline",
  payload: { kind: "status", text: "inline" },
};

const screenSibling: PiUiElement = {
  id: "btw",
  ns: "btw",
  kind: "panel",
  placement: "screen",
  payload: { kind: "panel", sections: [] },
};

function renderHost(elements: PiUiElement[], controller = makeController()) {
  return render(
    <PiExtensionSheetHost elements={elements} agentId="agt_1" actionController={controller} />,
  );
}

describe("PiExtensionSheetHost", () => {
  it("renders nothing until a sheet-placement element exists", () => {
    const { container } = renderHost([]);
    expect(container.firstChild).toBeNull();
  });

  it("opens the Sheet primitive on a new sheet element and renders it through the registry", () => {
    renderHost([askUserSheet]);

    const sheet = screen.getByTestId("pi-extension-sheet-host");
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(within(sheet).getByTestId("pi-panel-ask-user-ask")).toBeTruthy();
    expect(sheet.querySelector(".pc-sheet__title")?.textContent).toBe("Confirm deployment");
    const body = within(sheet).getByTestId("pi-markdown-ask-user-body");
    expect(body.textContent).toContain("staging");
  });

  it("excludes every non-sheet placement (plan.md §11.5)", () => {
    renderHost([pinnedSibling, inlineSibling, screenSibling]);
    expect(screen.queryByTestId("pi-extension-sheet-host")).toBeNull();
  });

  it("dismisses on Escape and resolves nothing — no action request is sent", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    renderHost([askUserSheet], controller);
    expect(screen.getByTestId("pi-extension-sheet-host")).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("pi-extension-sheet-host")).toBeNull();
    // The element is still live in the store (the caller's props are
    // unchanged), so a dismissal that dispatched anything would show here.
    expect(sent).toEqual([]);
  });

  it("dispatches a sheet element's action against that element's composite id", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    renderHost([askUserSheet], controller);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        agentId: "agt_1",
        elementId: "ask",
        actionId: "dismiss",
      }),
    ]);
  });

  it("does not re-open a dismissed element on a later render, but opens a genuinely new one", async () => {
    const user = userEvent.setup();
    const controller = makeController();

    const { rerender } = renderHost([askUserSheet], controller);
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("pi-extension-sheet-host")).toBeNull();

    // Same element, fresh props array (as a live store revision would
    // deliver): stays closed.
    rerender(
      <PiExtensionSheetHost
        elements={[askUserSheet]}
        agentId="agt_1"
        actionController={controller}
      />,
    );
    expect(screen.queryByTestId("pi-extension-sheet-host")).toBeNull();

    // A new `ns:id` is a new sheet and opens.
    rerender(
      <PiExtensionSheetHost
        elements={[askUserSheet, loopSheet]}
        agentId="agt_1"
        actionController={controller}
      />,
    );
    const sheet = screen.getByTestId("pi-extension-sheet-host");
    expect(sheet.querySelector(".pc-sheet__title")?.textContent).toBe("Loop run #7");
  });

  it("has no axe violations while open", async () => {
    const { container } = renderHost([askUserSheet]);
    expect(await axe(container)).toHaveNoViolations();
  });
});
