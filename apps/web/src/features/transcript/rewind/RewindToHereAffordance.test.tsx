import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { timeline } from "@picompanion/frontend-core";

import { Transcript } from "../transcript.js";

afterEach(cleanup);

function row(
  overrides: Record<string, unknown> & { kind: string; id: string },
): timeline.TranscriptEntry {
  return {
    key: overrides.id,
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    ...overrides,
  } as timeline.TranscriptEntry;
}

const ENTRIES: timeline.TranscriptEntry[] = [
  row({ kind: "user-message", id: "u1", text: "please add a login form", messageId: "msg-1" }),
  row({ kind: "assistant-message", id: "a1", text: "here's a login form", corrected: false }),
  row({ kind: "user-message", id: "u2", text: "use TypeScript instead", messageId: "msg-2" }),
];

describe("Transcript rewind-to-here wiring (T395)", () => {
  it("renders no rewind affordance on any row when the callback is omitted", () => {
    render(<Transcript entries={ENTRIES} testId="surface" />);
    expect(screen.queryByTestId("transcript-row-u2-rewind-to-here")).toBeNull();
  });

  it("wires onRewindToHere through to the correct user message row", async () => {
    const user = userEvent.setup();
    const onRewindToHere = vi.fn();
    render(<Transcript entries={ENTRIES} onRewindToHere={onRewindToHere} testId="surface" />);

    await user.click(screen.getByTestId("transcript-row-u2-rewind-to-here"));

    expect(onRewindToHere).toHaveBeenCalledTimes(1);
    expect(onRewindToHere).toHaveBeenCalledWith("u2");
    // Assistant rows never carry the affordance.
    expect(screen.queryByTestId("transcript-row-a1-rewind-to-here")).toBeNull();
  });

  it("disables a row whose user message has no daemon id to target", () => {
    const entries: timeline.TranscriptEntry[] = [
      row({ kind: "user-message", id: "pending", text: "not acknowledged yet" }),
    ];
    render(<Transcript entries={entries} onRewindToHere={vi.fn()} testId="surface" />);

    const button = screen.getByTestId("transcript-row-pending-rewind-to-here") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("disables every rewind button while the caller says the surface cannot rewind", () => {
    render(
      <Transcript
        entries={ENTRIES}
        onRewindToHere={vi.fn()}
        rewindToHereDisabled
        testId="surface"
      />,
    );

    const button = screen.getByTestId("transcript-row-u2-rewind-to-here") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
