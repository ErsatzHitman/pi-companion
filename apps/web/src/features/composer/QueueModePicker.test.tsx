import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QueueModePicker } from "./QueueModePicker.js";
import type { QueueModesState } from "./use-queue-modes.js";

// Each `it` renders into the same `document.body`; without this the next
// query in this file matches the previous test's leftover DOM.
afterEach(cleanup);

/**
 * QueueModePicker unit test (T38B1a, ATOMS-1). Renders the picker
 * directly against a hand-built `QueueModesState` rather than through
 * `Composer` (`Composer.test.tsx` already covers the full round-trip
 * through a real client) — this file only needs to prove the presentation
 * layer this package owns, per each of its three "unavailable options are
 * explained" states.
 */
function baseState(overrides: Partial<QueueModesState> = {}): QueueModesState {
  return {
    availability: "ready",
    unavailableReason: null,
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    isChangingSteeringMode: false,
    isChangingFollowUpMode: false,
    changeError: null,
    steeringNotice: null,
    followUpNotice: null,
    setSteeringMode: vi.fn().mockResolvedValue(undefined),
    setFollowUpMode: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("QueueModePicker", () => {
  it("shows both modes as native selects, visible without opening either", () => {
    render(<QueueModePicker state={baseState()} testId="queue-modes" />);
    const steering = screen.getByLabelText("Steering queue delivery") as HTMLSelectElement;
    const followUp = screen.getByLabelText("Follow-up queue delivery") as HTMLSelectElement;
    expect(steering.value).toBe("one-at-a-time");
    expect(followUp.value).toBe("one-at-a-time");
  });

  it("disables both selects and explains why when no client is wired", () => {
    render(
      <QueueModePicker
        state={baseState({
          availability: "no-client",
          steeringMode: null,
          followUpMode: null,
          unavailableReason: "Connect to a daemon to change the steer/follow-up mode.",
        })}
        testId="queue-modes"
      />,
    );
    const steering = screen.getByLabelText("Steering queue delivery") as HTMLSelectElement;
    expect(steering.hasAttribute("disabled")).toBe(true);
    const status = screen.getByTestId("queue-modes-status");
    expect(within(status).getByText(/Connect to a daemon/)).toBeTruthy();
  });

  it("offers a 'Not reported' option rather than inventing a mode the provider never sent", () => {
    render(<QueueModePicker state={baseState({ steeringMode: null })} testId="queue-modes" />);
    const steering = screen.getByLabelText("Steering queue delivery") as HTMLSelectElement;
    expect(
      Array.from(steering.options).some(
        (option) => option.text === "Not reported by this provider",
      ),
    ).toBe(true);
  });

  it("surfaces a failed change through the shared status element", () => {
    render(
      <QueueModePicker
        state={baseState({ changeError: "Could not reach the daemon." })}
        testId="queue-modes"
      />,
    );
    const status = screen.getByTestId("queue-modes-status");
    expect(within(status).getByText("Could not reach the daemon.")).toBeTruthy();
  });

  it("renders a successful change's provider notice, and nothing when there is none", () => {
    const { rerender } = render(
      <QueueModePicker
        state={baseState({
          steeringNotice: { type: "info", message: "applies from the next turn" },
        })}
        testId="queue-modes"
      />,
    );
    expect(screen.getByTestId("queue-modes-status").textContent).toContain(
      "applies from the next turn",
    );

    rerender(<QueueModePicker state={baseState()} testId="queue-modes" />);
    expect(screen.queryByTestId("queue-modes-status")).toBeNull();
  });
});
