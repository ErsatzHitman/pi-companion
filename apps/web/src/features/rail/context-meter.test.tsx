import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { ContextMeter } from "./context-meter.js";

afterEach(cleanup);

const knownTelemetry: coreTelemetry.ContextWindowTelemetry = {
  contextWindow: {
    status: "known",
    usedTokens: 50_000,
    maxTokens: 200_000,
    usedFraction: 0.25,
  },
  cacheShare: {
    status: "known",
    cachedTokens: 8_000,
    freshTokens: 2_000,
    cacheHitFraction: 0.8,
    cacheHitPercent: 80,
  },
};

const unknownTelemetry: coreTelemetry.ContextWindowTelemetry = {
  contextWindow: { status: "unknown" },
  cacheShare: { status: "unknown" },
};

describe("ContextMeter", () => {
  it("renders used/max tokens and the used-fraction progress bar when known", () => {
    render(<ContextMeter telemetry={knownTelemetry} />);

    const progressbar = screen.getByRole("progressbar", { name: "Context window used" });
    expect(progressbar.getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByText("25%")).toBeTruthy();

    const readout = screen.getByTestId("context-meter-context-window-readout");
    expect(readout.textContent).toBe("50,000 / 200,000 tokens used");
  });

  it("renders cache-hit share as a percent and cached/fresh token counts when known", () => {
    render(<ContextMeter telemetry={knownTelemetry} />);

    const progressbar = screen.getByRole("progressbar", { name: "Cache hit share" });
    expect(progressbar.getAttribute("aria-valuenow")).toBe("80");

    const readout = screen.getByTestId("context-meter-cache-share-readout");
    expect(readout.textContent).toBe("80% cache hit — 8,000 cached / 2,000 fresh");
  });

  it("shows the unknown context-window state honestly, never as a 0% bar", () => {
    render(<ContextMeter telemetry={unknownTelemetry} />);

    expect(screen.queryByRole("progressbar", { name: "Context window used" })).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByTestId("context-meter-context-window-readout")).toBeNull();

    const group = screen.getByTestId("context-meter-context-window");
    expect(within(group).getByText("Not reported by this provider")).toBeTruthy();
  });

  it("shows the unknown cache-share state honestly, never as a 0% bar", () => {
    render(<ContextMeter telemetry={unknownTelemetry} />);

    expect(screen.queryByRole("progressbar", { name: "Cache hit share" })).toBeNull();
    const group = screen.getByTestId("context-meter-cache-share");
    expect(within(group).getByText("Not reported by this provider")).toBeTruthy();
  });

  it("mixes known context-window with unknown cache share independently", () => {
    render(
      <ContextMeter
        telemetry={{
          contextWindow: knownTelemetry.contextWindow,
          cacheShare: { status: "unknown" },
        }}
      />,
    );

    expect(screen.getByRole("progressbar", { name: "Context window used" })).toBeTruthy();
    expect(screen.queryByRole("progressbar", { name: "Cache hit share" })).toBeNull();
    expect(
      within(screen.getByTestId("context-meter-cache-share")).getByText(
        "Not reported by this provider",
      ),
    ).toBeTruthy();
  });

  it("updates the visible readout when a new telemetry snapshot is passed (per-turn update)", () => {
    const { rerender } = render(<ContextMeter telemetry={knownTelemetry} />);
    expect(screen.getByTestId("context-meter-context-window-readout").textContent).toBe(
      "50,000 / 200,000 tokens used",
    );

    const nextTurn: coreTelemetry.ContextWindowTelemetry = {
      contextWindow: {
        status: "known",
        usedTokens: 120_000,
        maxTokens: 200_000,
        usedFraction: 0.6,
      },
      cacheShare: knownTelemetry.cacheShare,
    };
    rerender(<ContextMeter telemetry={nextTurn} />);

    expect(screen.getByTestId("context-meter-context-window-readout").textContent).toBe(
      "120,000 / 200,000 tokens used",
    );
    const progressbar = screen.getByRole("progressbar", { name: "Context window used" });
    expect(progressbar.getAttribute("aria-valuenow")).toBe("60");
  });

  it("puts token/percent readouts in mono tabular-figure spans", () => {
    render(<ContextMeter telemetry={knownTelemetry} />);
    const value = screen.getByText("50,000");
    expect(value.tagName).toBe("SPAN");
    expect(value.className).toContain("context-meter__value");
  });

  it("announces the numeric readouts via a polite live region", () => {
    render(<ContextMeter telemetry={knownTelemetry} />);
    const readout = screen.getByTestId("context-meter-context-window-readout");
    expect(readout.getAttribute("role")).toBe("status");
    expect(readout.getAttribute("aria-live")).toBe("polite");

    const cacheReadout = screen.getByTestId("context-meter-cache-share-readout");
    expect(cacheReadout.getAttribute("role")).toBe("status");
    expect(cacheReadout.getAttribute("aria-live")).toBe("polite");
  });

  it("labels the meter under a heading landmark", () => {
    render(<ContextMeter telemetry={knownTelemetry} />);
    expect(screen.getByRole("heading", { name: "Context" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Context window" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cache hit share" })).toBeTruthy();
  });

  it("has no axe violations for the known or unknown state", async () => {
    const { container: known } = render(<ContextMeter telemetry={knownTelemetry} />);
    expect(await axe(known)).toHaveNoViolations();
    cleanup();

    const { container: unknown } = render(<ContextMeter telemetry={unknownTelemetry} />);
    expect(await axe(unknown)).toHaveNoViolations();
  });
});
