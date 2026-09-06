import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PiNoticeBanner } from "./PiNoticeBanner.js";
import type { PiNoticeEntry } from "./pi-notice-store.js";

afterEach(cleanup);

function entry(partial: Partial<PiNoticeEntry> = {}): PiNoticeEntry {
  return {
    id: "pi_notice_1",
    level: "info",
    message: "a notice",
    provider: "pi",
    ...partial,
  } as PiNoticeEntry;
}

describe("PiNoticeBanner", () => {
  it("renders nothing when there are no notices", () => {
    const { container } = render(<PiNoticeBanner notices={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders each notice's message in the DOM", () => {
    render(
      <PiNoticeBanner
        notices={[
          entry({ id: "n1", message: "Pi UI bridge requested resync for agt_1 (agent-seq-gap)" }),
          entry({ id: "n2", level: "error", message: "Failed to steer Pi turn: boom" }),
        ]}
      />,
    );

    expect(
      screen.getByText("Pi UI bridge requested resync for agt_1 (agent-seq-gap)"),
    ).toBeTruthy();
    expect(screen.getByText("Failed to steer Pi turn: boom")).toBeTruthy();
  });

  it("calls onDismiss with the notice's id when its action fires", () => {
    const onDismiss = vi.fn();
    render(
      <PiNoticeBanner
        notices={[entry({ id: "n1", message: "dismiss me" })]}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("n1");
  });

  it("renders no action button when onDismiss is omitted", () => {
    render(<PiNoticeBanner notices={[entry({ id: "n1" })]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
