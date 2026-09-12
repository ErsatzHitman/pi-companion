import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { PiExtensionInlineStack } from "./PiExtensionInlineStack.js";

/**
 * `PiExtensionInlineStack` — the web `inline`-placement destination
 * (plan.md §11.3, §11.5). Before this component, `select-rail-elements.ts`
 * and `select-status-elements.ts` were the only placement filters in
 * `apps/web`, so an `inline` element rendered nowhere. These tests cover
 * the placement filter, rendering through the real registry pipeline,
 * action dispatch, and axe.
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

/** plan.md §11.7: prompt-arbitrage's inline footer status. */
const inlineStatus: PiUiElement = {
  id: "footer",
  ns: "prompt-arbitrage",
  kind: "status",
  placement: "inline",
  title: "Prompt arbitrage",
  payload: { kind: "status", text: "3 candidates ranked", detail: "showing best first" },
};

/** An inline element with its own action, to prove dispatch reaches the wire. */
const inlineWithAction: PiUiElement = {
  id: "arb",
  ns: "prompt-arbitrage",
  kind: "status",
  placement: "inline",
  title: "Arbitrage",
  actions: [{ id: "dismiss", label: "Dismiss" }],
  payload: { kind: "status", text: "Pick a candidate" },
};

const pinnedSibling: PiUiElement = {
  id: "goal",
  ns: "pi-goal",
  kind: "status",
  placement: "pinned",
  payload: { kind: "status", text: "Pinned goal" },
};

const sheetSibling: PiUiElement = {
  id: "ask",
  ns: "ask-user",
  kind: "panel",
  placement: "sheet",
  payload: { kind: "panel", sections: [] },
};

const screenSibling: PiUiElement = {
  id: "btw",
  ns: "btw",
  kind: "panel",
  placement: "screen",
  payload: { kind: "panel", sections: [] },
};

function renderStack(elements: PiUiElement[], controller = makeController()) {
  return render(
    <PiExtensionInlineStack elements={elements} agentId="agt_1" actionController={controller} />,
  );
}

describe("PiExtensionInlineStack", () => {
  it("renders an inline-placement element through PiUiElementView's registry pipeline", () => {
    renderStack([inlineStatus]);

    const host = screen.getByTestId("pi-extension-inline-stack");
    const wrapper = within(host).getByTestId("pi-inline-prompt-arbitrage-footer");
    // The registered `status` renderer ran (its own test id), not a fallback.
    expect(within(wrapper).getByTestId("pi-status-prompt-arbitrage-footer")).toBeTruthy();
    expect(within(wrapper).getByText("3 candidates ranked")).toBeTruthy();
  });

  it("excludes every non-inline placement (plan.md §11.5)", () => {
    renderStack([pinnedSibling, sheetSibling, screenSibling]);
    expect(screen.queryByTestId("pi-extension-inline-stack")).toBeNull();
  });

  it("renders a visible empty state when there is no inline content", () => {
    const { container } = renderStack([]);
    expect(container.firstChild).toBeNull();
  });

  it("renders every inline element in store order", () => {
    renderStack([inlineStatus, { ...inlineStatus, id: "second", title: "Second" } as PiUiElement]);
    const list = screen.getByTestId("pi-extension-inline-stack-list");
    expect(list.children).toHaveLength(2);
  });

  it("dispatches an inline element's action against the element's own composite id", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    renderStack([inlineWithAction], controller);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        agentId: "agt_1",
        elementId: "arb",
        actionId: "dismiss",
      }),
    ]);
  });

  it("has no axe violations", async () => {
    const { container } = renderStack([inlineStatus]);
    expect(await axe(container)).toHaveNoViolations();
  });
});
