import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { PiExtensionScreenHost } from "./PiExtensionScreenHost.js";

/**
 * `PiExtensionScreenHost` — the web `screen`-placement destination
 * (plan.md §11.3, §11.5). Before this component, a `screen` element (btw's
 * secondary-conversation panel is the reference's own example) reached no
 * screen at all. These tests cover the placement filter, the btw-shaped
 * composed panel rendering through the shared registry, action dispatch,
 * and axe.
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

/** plan.md §11.7: btw's full-screen panel — status, markdown thread, form composer. */
const btwScreen: PiUiElement = {
  id: "btw",
  ns: "btw",
  kind: "panel",
  placement: "screen",
  title: "btw · opencode/deepseek-v4-flash · high",
  actions: [
    { id: "stop", label: "Stop", variant: "danger", confirm: "Stop btw?" },
    { id: "history", label: "History" },
    { id: "close", label: "Close", variant: "secondary" },
  ],
  payload: {
    kind: "panel",
    sections: [
      {
        id: "btw-status",
        ns: "btw",
        kind: "status",
        payload: { kind: "status", text: "busy · 4s", tone: "accent" },
      },
      {
        id: "btw-thread",
        ns: "btw",
        kind: "markdown",
        payload: {
          kind: "markdown",
          text: "**you** · 10:21 — synthetic question",
        },
      },
      {
        id: "btw-composer",
        ns: "btw",
        kind: "form",
        title: "Ask btw",
        payload: {
          kind: "form",
          fields: [
            {
              kind: "text",
              id: "prompt",
              label: "Ask btw",
              multiline: true,
            },
          ],
          submitLabel: "Ask",
        },
      },
    ],
  },
} as PiUiElement;

const pinnedSibling: PiUiElement = {
  id: "fleet",
  ns: "subagents",
  kind: "roster",
  placement: "pinned",
  payload: { kind: "roster", rows: [] },
};

function renderHost(elements: PiUiElement[], controller = makeController()) {
  return render(
    <PiExtensionScreenHost elements={elements} agentId="agt_1" actionController={controller} />,
  );
}

describe("PiExtensionScreenHost", () => {
  it("renders a screen-placement panel, composing every section through the shared registry", () => {
    renderHost([btwScreen]);

    const host = screen.getByTestId("pi-extension-screen-host");
    expect(within(host).getByTestId("pi-panel-btw-btw")).toBeTruthy();
    expect(within(host).getByText("btw · opencode/deepseek-v4-flash · high")).toBeTruthy();
    expect(within(host).getByText("busy · 4s")).toBeTruthy();
    const thread = within(host).getByTestId("pi-markdown-btw-btw-thread");
    expect(thread.querySelector("strong")?.textContent).toBe("you");
    expect(within(host).getByLabelText("Ask btw")).toBeTruthy();
  });

  it("excludes every non-screen placement (plan.md §11.5)", () => {
    renderHost([pinnedSibling]);
    expect(screen.queryByTestId("pi-extension-screen-host")).toBeNull();
  });

  it("renders nothing when there is no screen-placement element", () => {
    const { container } = renderHost([]);
    expect(container.firstChild).toBeNull();
  });

  it("dispatches the screen element's own action against its composite id", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = makeController((message) => sent.push(message as Record<string, unknown>));
    const user = userEvent.setup();

    renderHost([btwScreen], controller);
    await user.click(screen.getByRole("button", { name: "History" }));

    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        agentId: "agt_1",
        elementId: "btw",
        actionId: "history",
      }),
    ]);
  });

  it("has no axe violations", async () => {
    const { container } = renderHost([btwScreen]);
    expect(await axe(container)).toHaveNoViolations();
  });
});
