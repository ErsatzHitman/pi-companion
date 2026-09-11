import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";

import { ContextRing } from "./ContextRing.js";

afterEach(cleanup);

const KNOWN: coreTelemetry.ContextWindowTelemetry = {
  contextWindow: { status: "known", usedTokens: 131_600, maxTokens: 200_000, usedFraction: 0.658 },
  cacheShare: { status: "unknown" },
};

const UNKNOWN: coreTelemetry.ContextWindowTelemetry = {
  contextWindow: { status: "unknown" },
  cacheShare: { status: "unknown" },
};

describe("ContextRing", () => {
  it("draws the mockup's 26px ring at r=11 / stroke 2.5 from the derived fraction", () => {
    render(<ContextRing telemetry={KNOWN} expanded={false} onToggle={() => {}} testId="ring" />);
    const svg = screen.getByTestId("ring").querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 26 26");
    expect(svg?.getAttribute("width")).toBe("26");
    expect(svg?.getAttribute("height")).toBe("26");
    const arc = svg?.querySelector(".pc-context-ring__arc");
    const circumference = 2 * Math.PI * 11;
    expect(arc?.getAttribute("r")).toBe("11");
    expect(arc?.getAttribute("stroke-width")).toBe("2.5");
    expect(arc?.getAttribute("stroke-dasharray")).toBe(circumference.toFixed(2));
    expect(arc?.getAttribute("stroke-dashoffset")).toBe((circumference * (1 - 0.658)).toFixed(2));
  });

  it("prints the rounded percentage inside the ring and in the accessible name", () => {
    render(<ContextRing telemetry={KNOWN} expanded={false} onToggle={() => {}} testId="ring" />);
    expect(screen.getByTestId("ring").querySelector(".pc-context-ring__pct")?.textContent).toBe(
      "66",
    );
    expect(screen.getByRole("button", { name: "Session controls — 66% of context used" })).toBe(
      screen.getByTestId("ring"),
    );
  });

  it("renders no percentage at all when the provider has not reported usage — unknown is never 0%", () => {
    render(<ContextRing telemetry={UNKNOWN} expanded={false} onToggle={() => {}} testId="ring" />);
    expect(screen.getByTestId("ring").querySelector(".pc-context-ring__pct")).toBeNull();
    const circumference = 2 * Math.PI * 11;
    expect(
      screen
        .getByTestId("ring")
        .querySelector(".pc-context-ring__arc")
        ?.getAttribute("stroke-dashoffset"),
    ).toBe(circumference.toFixed(2));
    expect(
      screen.getByRole("button", { name: "Session controls — context usage not reported" }),
    ).toBeTruthy();
  });

  it("is a real button exposing its expanded state and toggling on activation", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <ContextRing telemetry={KNOWN} expanded={false} onToggle={onToggle} testId="ring" />,
    );
    const button = screen.getByTestId("ring");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("title")).toContain("66% of context used");

    button.focus();
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<ContextRing telemetry={KNOWN} expanded onToggle={onToggle} testId="ring" />);
    expect(screen.getByTestId("ring").getAttribute("aria-expanded")).toBe("true");
  });

  it("has no axe violations, known or unknown", async () => {
    const { container, rerender } = render(
      <ContextRing telemetry={KNOWN} expanded={false} onToggle={() => {}} testId="ring" />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(<ContextRing telemetry={UNKNOWN} expanded onToggle={() => {}} testId="ring" />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
