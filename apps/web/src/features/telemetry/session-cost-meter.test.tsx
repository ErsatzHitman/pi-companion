import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";
import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { SessionCostMeter } from "./session-cost-meter.js";

afterEach(cleanup);

const unknownCost: coreTelemetry.SessionCost = {
  status: "unknown",
  totalUsd: 0,
  pricedTurns: 0,
  unknownTurns: 0,
};

const knownCost: coreTelemetry.SessionCost = {
  status: "known",
  totalUsd: 3.0231,
  pricedTurns: 2,
  unknownTurns: 0,
};

const partialCost: coreTelemetry.SessionCost = {
  status: "partial",
  totalUsd: 0.0231,
  pricedTurns: 1,
  unknownTurns: 2,
};

describe("SessionCostMeter", () => {
  it("renders the accumulated total in tabular mono figures when known", () => {
    render(<SessionCostMeter sessionCost={knownCost} />);

    const readout = screen.getByTestId("session-cost-meter-readout");
    expect(readout.textContent).toBe("$3.0231 this session");

    const value = screen.getByText("$3.0231");
    expect(value.tagName).toBe("SPAN");
    expect(value.className).toContain("session-cost-meter__value");
  });

  it("shows an unknown rate as an explicit notice, never as $0.00 or blank", () => {
    render(<SessionCostMeter sessionCost={unknownCost} />);

    expect(screen.queryByText("$0.0000")).toBeNull();
    expect(screen.queryByTestId("session-cost-meter-readout")).toBeNull();
    expect(
      screen.getByText("Not priced yet — no turn with a known model rate has completed"),
    ).toBeTruthy();
  });

  it("shows a partial total as a lower bound, naming the unpriced turns", () => {
    render(<SessionCostMeter sessionCost={partialCost} />);

    const readout = screen.getByTestId("session-cost-meter-readout");
    expect(readout.textContent).toBe("$0.0231 so far — 2 turns unpriced, total is a lower bound");
  });

  it("uses singular turn wording for exactly one unpriced turn", () => {
    render(
      <SessionCostMeter
        sessionCost={{ status: "partial", totalUsd: 1, pricedTurns: 1, unknownTurns: 1 }}
      />,
    );
    expect(screen.getByTestId("session-cost-meter-readout").textContent).toBe(
      "$1.0000 so far — 1 turn unpriced, total is a lower bound",
    );
  });

  it("updates the visible readout when a new session cost snapshot is passed (per-turn update)", () => {
    const { rerender } = render(<SessionCostMeter sessionCost={unknownCost} />);
    expect(screen.queryByTestId("session-cost-meter-readout")).toBeNull();

    rerender(<SessionCostMeter sessionCost={knownCost} />);
    expect(screen.getByTestId("session-cost-meter-readout").textContent).toBe(
      "$3.0231 this session",
    );

    rerender(
      <SessionCostMeter
        sessionCost={{ status: "known", totalUsd: 6.5, pricedTurns: 3, unknownTurns: 0 }}
      />,
    );
    expect(screen.getByTestId("session-cost-meter-readout").textContent).toBe(
      "$6.5000 this session",
    );
  });

  it("announces the numeric readout via a polite live region", () => {
    render(<SessionCostMeter sessionCost={knownCost} />);
    const readout = screen.getByTestId("session-cost-meter-readout");
    expect(readout.getAttribute("role")).toBe("status");
    expect(readout.getAttribute("aria-live")).toBe("polite");
  });

  it("announces the unknown state via a non-colour status signal", () => {
    render(<SessionCostMeter sessionCost={unknownCost} />);
    const unknown = screen.getByTestId("session-cost-meter-unknown");
    expect(unknown.getAttribute("role")).toBe("status");
    expect(
      unknown.textContent?.includes(
        "Not priced yet — no turn with a known model rate has completed",
      ),
    ).toBe(true);
  });

  it("labels the meter under a heading landmark", () => {
    render(<SessionCostMeter sessionCost={knownCost} />);
    expect(screen.getByRole("heading", { name: "Cost" })).toBeTruthy();
  });

  it("accepts a custom testId, prefixing every nested testid", () => {
    render(<SessionCostMeter sessionCost={knownCost} testId="custom-cost" />);
    expect(screen.getByTestId("custom-cost")).toBeTruthy();
    expect(screen.getByTestId("custom-cost-readout")).toBeTruthy();
  });

  it("has no axe violations for the unknown, partial, or known state", async () => {
    const { container: unknown } = render(<SessionCostMeter sessionCost={unknownCost} />);
    expect(await axe(unknown)).toHaveNoViolations();
    cleanup();

    const { container: partial } = render(<SessionCostMeter sessionCost={partialCost} />);
    expect(await axe(partial)).toHaveNoViolations();
    cleanup();

    const { container: known } = render(<SessionCostMeter sessionCost={knownCost} />);
    expect(await axe(known)).toHaveNoViolations();
  });
});
