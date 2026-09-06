import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extensions, type Clock, type TimerHandle } from "@picompanion/frontend-core";
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import {
  PI_UI_MAX_PAYLOAD_BYTES,
  PiUiRendererRegistry,
  estimatePiUiPayloadBytes,
  isPiUiPayloadOversized,
  piUiActionTarget,
  piUiRendererRegistry,
  type PiUiElementRendererProps,
} from "./registry.js";
import { PiUiElementView } from "./registry-view.js";

/**
 * T29A1 web renderer registry (plan.md §11.4). Acceptance criteria
 * exercised here:
 *
 * - "An element that throws is contained by its own boundary"
 * - "An unknown kind produces one visible diagnostic, not transcript text"
 * - "Oversized payloads are capped with an explanation"
 *
 * Plus the registry lookup table itself, the payload size helpers, and the
 * bound `dispatchAction`/`getActionState` wiring into T21C's
 * `ExtensionActionController`.
 */

afterEach(() => {
  cleanup();
  piUiRendererRegistry.clear();
});

/** Deterministic, manually-advanced `Clock` (no real timers; plan.md §7.3). */
class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }
  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id as unknown as TimerHandle;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }
  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    return this.setTimeout(callback, intervalMs);
  }
  clearInterval(handle: TimerHandle): void {
    this.clearTimeout(handle);
  }
  advance(ms: number): void {
    this.time += ms;
    for (const [id, timer] of [...this.timers.entries()].sort((a, b) => a[0] - b[0])) {
      if (timer.at <= this.time && this.timers.has(id)) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}

function statusElement(overrides: Partial<PiUiElement> = {}): PiUiElement {
  return {
    id: "mode",
    ns: "plan-mode",
    kind: "status",
    placement: "status",
    title: "Plan mode",
    payload: { kind: "status", text: "Reviewing changes" },
    ...overrides,
  } as PiUiElement;
}

function makeController(): extensions.ExtensionActionController {
  return new extensions.ExtensionActionController({
    clock: new FakeClock(),
    sendRequest: () => {},
  });
}

describe("PiUiRendererRegistry", () => {
  it("registers, looks up, and lists renderers by kind", () => {
    const registry = new PiUiRendererRegistry();
    expect(registry.has("status")).toBe(false);
    expect(registry.kinds()).toEqual([]);

    function StatusRenderer() {
      return <span>status</span>;
    }
    registry.register("status", StatusRenderer);

    expect(registry.has("status")).toBe(true);
    expect(registry.get("status")).toBe(StatusRenderer);
    expect(registry.kinds()).toEqual(["status"]);
  });

  it("register overwrites a prior registration for the same kind", () => {
    const registry = new PiUiRendererRegistry();
    function First() {
      return <span>first</span>;
    }
    function Second() {
      return <span>second</span>;
    }
    registry.register("widget", First);
    registry.register("widget", Second);
    expect(registry.get("widget")).toBe(Second);
    expect(registry.kinds()).toEqual(["widget"]);
  });
});

describe("payload size helpers", () => {
  it("estimates UTF-8 byte size, not UTF-16 code units", () => {
    expect(estimatePiUiPayloadBytes(undefined)).toBe(0);
    expect(estimatePiUiPayloadBytes({ kind: "status", text: "abc" })).toBeGreaterThan(0);
    // "é" is 1 UTF-16 code unit but 2 UTF-8 bytes once JSON-quoted.
    const ascii = estimatePiUiPayloadBytes({ kind: "status", text: "a" });
    const accented = estimatePiUiPayloadBytes({ kind: "status", text: "é" });
    expect(accented).toBeGreaterThan(ascii);
  });

  it("flags a payload over the cap and stays under the default cap for a normal payload", () => {
    expect(isPiUiPayloadOversized({ kind: "status", text: "hi" })).toBe(false);
    expect(isPiUiPayloadOversized({ kind: "log", lines: [] }, 100 /* generous custom cap */)).toBe(
      false,
    );
    expect(isPiUiPayloadOversized({ kind: "markdown", text: "x".repeat(100) }, 10)).toBe(true);
  });

  it("PI_UI_MAX_PAYLOAD_BYTES is a sane default (64 KiB)", () => {
    expect(PI_UI_MAX_PAYLOAD_BYTES).toBe(64 * 1024);
  });
});

describe("piUiActionTarget", () => {
  it("composes the composite action identity", () => {
    expect(piUiActionTarget("agt_1", { ns: "loop", id: "controls" }, "stop")).toEqual({
      agentId: "agt_1",
      namespace: "loop",
      elementId: "controls",
      actionId: "stop",
    });
  });
});

describe("PiUiElementView: unknown-kind fallback", () => {
  it("renders one visible diagnostic for a kind outside the frozen vocabulary, not transcript text", () => {
    const element = statusElement({ kind: "not-a-real-kind" as never, payload: undefined });
    render(
      <PiUiElementView element={element} agentId="agt_1" actionController={makeController()} />,
    );

    // Exactly one diagnostic banner, carrying the unrecognized kind name.
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0]!.textContent).toMatch(/not-a-real-kind/);
    // The raw element is available, but only behind an explicit disclosure —
    // never dumped as bare transcript text next to the banner.
    expect(screen.getByRole("button", { name: "Show raw details" })).toBeTruthy();
  });

  it("renders a diagnostic when a known kind has no renderer registered yet", () => {
    const element = statusElement();
    render(
      <PiUiElementView element={element} agentId="agt_1" actionController={makeController()} />,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText(/No renderer available yet/)).toBeTruthy();
  });

  it("renders a diagnostic when the canonical payload could not be validated", () => {
    // No renderer registered, so a payload-shape problem and a missing
    // renderer both currently fall through this same path; register one so
    // this case specifically exercises the "no payload" branch's message.
    function StatusRenderer(props: PiUiElementRendererProps<"status">) {
      return <span>{props.payload.text}</span>;
    }
    piUiRendererRegistry.register("status", StatusRenderer);

    const element = statusElement({ payload: undefined });
    render(
      <PiUiElementView element={element} agentId="agt_1" actionController={makeController()} />,
    );
    expect(screen.getByText(/could not be validated/)).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const element = statusElement({ kind: "not-a-real-kind" as never, payload: undefined });
    const { container } = render(
      <PiUiElementView element={element} agentId="agt_1" actionController={makeController()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("PiUiElementView: oversized payload cap", () => {
  it("caps an oversized payload and explains the limit instead of rendering it", () => {
    function StatusRenderer(props: PiUiElementRendererProps<"status">) {
      return <span>{props.payload.text}</span>;
    }
    piUiRendererRegistry.register("status", StatusRenderer);

    const hugeText = "x".repeat(200);
    const element = statusElement({ payload: { kind: "status", text: hugeText } });
    render(
      <PiUiElementView
        element={element}
        agentId="agt_1"
        actionController={makeController()}
        maxPayloadBytes={50}
      />,
    );

    expect(screen.getByText(/too large to render/)).toBeTruthy();
    expect(screen.getByText(/exceeds the 50-byte limit/)).toBeTruthy();
    // The registered renderer never runs, and the huge string never reaches the DOM.
    expect(screen.queryByText(hugeText)).toBeNull();
    expect(document.body.textContent).not.toContain(hugeText);
  });
});

describe("PiUiElementView: per-element error boundary", () => {
  function ThrowingRenderer(): never {
    throw new Error("boom from extension renderer");
  }
  function OkRenderer(props: PiUiElementRendererProps<"status">) {
    return <span data-testid="ok-rendered">{props.payload.text}</span>;
  }

  beforeEach(() => {
    // React logs the caught error to the console by default; keep test
    // output clean without hiding a real assertion failure.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("contains a throwing element without taking down a sibling element", () => {
    piUiRendererRegistry.register("status", ThrowingRenderer as never);
    piUiRendererRegistry.register("widget", OkRenderer as never);

    const throwing = statusElement();
    const ok = statusElement({
      id: "sibling",
      kind: "widget",
      payload: { kind: "widget", text: "still fine" } as never,
    });

    render(
      <>
        <PiUiElementView element={throwing} agentId="agt_1" actionController={makeController()} />
        <PiUiElementView element={ok} agentId="agt_1" actionController={makeController()} />
      </>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/status.*failed to render/);
    expect(alert.textContent).toMatch(/boom from extension renderer/);
    expect(screen.getByTestId("ok-rendered").textContent).toBe("still fine");
  });

  it("logs the caught error with namespace/kind/elementId fields", () => {
    piUiRendererRegistry.register("status", ThrowingRenderer as never);
    const errorLog = vi.fn();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: errorLog,
      child: (): unknown => logger,
    };

    render(
      <PiUiElementView
        element={statusElement()}
        agentId="agt_1"
        actionController={makeController()}
        logger={logger as never}
      />,
    );

    expect(errorLog).toHaveBeenCalledWith(
      "Pi UI element renderer threw",
      expect.objectContaining({ ns: "plan-mode", elementId: "mode", kind: "status" }),
    );
  });
});

describe("PiUiElementView: registered renderer + action dispatch", () => {
  function ActionRenderer(props: PiUiElementRendererProps<"status">) {
    const state = props.getActionState("acknowledge");
    return (
      <div>
        <span data-testid="text">{props.payload.text}</span>
        <span data-testid="state">{state.status}</span>
        <button type="button" onClick={() => void props.dispatchAction("acknowledge")}>
          Acknowledge
        </button>
      </div>
    );
  }

  it("dispatches through the bound ExtensionActionController for this element's identity", async () => {
    piUiRendererRegistry.register("status", ActionRenderer);
    const sent: unknown[] = [];
    const controller = new extensions.ExtensionActionController({
      clock: new FakeClock(),
      sendRequest: (message) => sent.push(message),
    });
    const user = userEvent.setup();

    render(
      <PiUiElementView
        element={statusElement()}
        agentId="agt_1"
        actionController={controller}
        revision={3}
      />,
    );

    expect(screen.getByTestId("state").textContent).toBe("idle");
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));

    expect(sent).toEqual([
      expect.objectContaining({
        type: "pi.ui.action.request",
        agentId: "agt_1",
        elementId: "mode",
        actionId: "acknowledge",
      }),
    ]);
    // `dispatchAction` is bound to this exact element's composite identity:
    // the controller now reports it pending under (agt_1, plan-mode, mode,
    // acknowledge), independent of whether the naive test renderer above
    // re-renders to reflect it.
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "plan-mode",
        elementId: "mode",
        actionId: "acknowledge",
      }).status,
    ).toBe("pending");
  });

  it("shows the dev-mode revision badge", () => {
    piUiRendererRegistry.register("status", ActionRenderer);
    render(
      <PiUiElementView
        element={statusElement()}
        agentId="agt_1"
        actionController={makeController()}
        revision={7}
      />,
    );
    expect(screen.getByText("rev 7")).toBeTruthy();
  });

  it("has no axe violations for a normally-rendered element", async () => {
    piUiRendererRegistry.register("status", ActionRenderer);
    const { container } = render(
      <PiUiElementView
        element={statusElement()}
        agentId="agt_1"
        actionController={makeController()}
        revision={1}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("PiUiElementView: dangerous-action confirmation gate (T29B5)", () => {
  const dangerousAction = {
    id: "clear-all",
    label: "Clear all",
    variant: "danger" as const,
    confirm: "This removes every stored item and cannot be undone.",
  };

  function DangerousActionRenderer(props: PiUiElementRendererProps<"status">) {
    const state = props.getActionState(dangerousAction.id);
    return (
      <div>
        <span data-testid="state">{state.status}</span>
        <button
          type="button"
          onClick={() => void props.dispatchAction(dangerousAction.id, { action: dangerousAction })}
        >
          {dangerousAction.label}
        </button>
      </div>
    );
  }

  it("never sends a request for a confirm-bearing action until the user confirms", async () => {
    piUiRendererRegistry.register("status", DangerousActionRenderer);
    const sent: unknown[] = [];
    const controller = new extensions.ExtensionActionController({
      clock: new FakeClock(),
      sendRequest: (message) => sent.push(message),
    });
    const user = userEvent.setup();

    render(
      <PiUiElementView element={statusElement()} agentId="agt_1" actionController={controller} />,
    );

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    // A confirm-bearing action never reaches the daemon on the triggering
    // click — `ExtensionActionController.dispatch` would otherwise throw
    // `ExtensionActionConfirmationRequiredError` synchronously.
    expect(sent).toEqual([]);
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("names the action and states its consequence in the confirmation dialog", async () => {
    piUiRendererRegistry.register("status", DangerousActionRenderer);
    const user = userEvent.setup();

    render(
      <PiUiElementView
        element={statusElement()}
        agentId="agt_1"
        actionController={makeController()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Clear all");
    expect(dialog.textContent).toContain("This removes every stored item and cannot be undone.");
  });

  it("dispatches once the user explicitly confirms", async () => {
    piUiRendererRegistry.register("status", DangerousActionRenderer);
    const sent: unknown[] = [];
    const controller = new extensions.ExtensionActionController({
      clock: new FakeClock(),
      sendRequest: (message) => sent.push(message),
    });
    const user = userEvent.setup();

    render(
      <PiUiElementView element={statusElement()} agentId="agt_1" actionController={controller} />,
    );

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(sent).toEqual([
      expect.objectContaining({ type: "pi.ui.action.request", actionId: "clear-all" }),
    ]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "plan-mode",
        elementId: "mode",
        actionId: "clear-all",
      }).status,
    ).toBe("pending");
  });

  it("never dispatches when the user declines the confirmation", async () => {
    piUiRendererRegistry.register("status", DangerousActionRenderer);
    const sent: unknown[] = [];
    const controller = new extensions.ExtensionActionController({
      clock: new FakeClock(),
      sendRequest: (message) => sent.push(message),
    });
    const user = userEvent.setup();

    render(
      <PiUiElementView element={statusElement()} agentId="agt_1" actionController={controller} />,
    );

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(sent).toEqual([]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      controller.getActionState({
        agentId: "agt_1",
        namespace: "plan-mode",
        elementId: "mode",
        actionId: "clear-all",
      }).status,
    ).toBe("idle");
  });

  function NonDangerousActionRenderer(props: PiUiElementRendererProps<"status">) {
    return (
      <button type="button" onClick={() => void props.dispatchAction("acknowledge")}>
        Acknowledge
      </button>
    );
  }

  it("leaves a non-dangerous action unaffected: no dialog, immediate dispatch", async () => {
    piUiRendererRegistry.register("status", NonDangerousActionRenderer);
    const sent: unknown[] = [];
    const controller = new extensions.ExtensionActionController({
      clock: new FakeClock(),
      sendRequest: (message) => sent.push(message),
    });
    const user = userEvent.setup();

    render(
      <PiUiElementView element={statusElement()} agentId="agt_1" actionController={controller} />,
    );

    await user.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent).toEqual([
      expect.objectContaining({ type: "pi.ui.action.request", actionId: "acknowledge" }),
    ]);
  });

  it("has no axe violations while the confirmation dialog is open", async () => {
    piUiRendererRegistry.register("status", DangerousActionRenderer);
    const user = userEvent.setup();
    const { container } = render(
      <PiUiElementView
        element={statusElement()}
        agentId="agt_1"
        actionController={makeController()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
