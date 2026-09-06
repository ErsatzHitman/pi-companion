import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OutcomeNoticeDialog } from "./OutcomeNotice.js";
import type { OutcomeNoticeViewModel } from "./outcome-notice.js";

afterEach(cleanup);

const NOTICE: OutcomeNoticeViewModel = {
  requestId: "perm_0001",
  title: "Run shell command",
  statusLabel: "Superseded",
  answeredByLabel: "Android",
  message:
    'Your answer to "Run shell command" did not count: Android answered this request first. ' +
    "The request was resolved as denied.",
};

describe("OutcomeNoticeDialog", () => {
  it("renders as an alertdialog labelled with the title and status", () => {
    render(<OutcomeNoticeDialog notice={NOTICE} onDismiss={() => {}} />);
    expect(
      screen.getByRole("alertdialog", { name: "Run shell command — Superseded" }),
    ).toBeTruthy();
  });

  it("states the outcome and which client answered as real, readable text — not just a status flag", () => {
    render(<OutcomeNoticeDialog notice={NOTICE} onDismiss={() => {}} testId="notice" />);
    // The full sentence a test (and a screen reader) can read back.
    expect(screen.getByTestId("notice-message").textContent).toBe(NOTICE.message);
    expect(screen.getByTestId("notice-message").textContent).toContain("Android");
    expect(screen.getByTestId("notice-message").textContent).toContain("denied");
    // The at-a-glance StatusIndicator carries the same information in its
    // own accessible `role="status"` text, independent of the sentence.
    expect(screen.getByRole("status").textContent).toContain("Superseded");
  });

  it("degrades honestly when the answering client is unknown, rather than inventing a name", () => {
    const unknownNotice: OutcomeNoticeViewModel = {
      ...NOTICE,
      answeredByLabel: "an unknown client",
      message:
        'an unknown client already answered "Run shell command" as denied, before you responded here.',
    };
    render(<OutcomeNoticeDialog notice={unknownNotice} onDismiss={() => {}} testId="notice" />);
    expect(screen.getByTestId("notice-message").textContent).toContain("unknown client");
  });

  it("dismisses on clicking OK", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<OutcomeNoticeDialog notice={NOTICE} onDismiss={onDismiss} />);
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape (shared modal behavior)", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<OutcomeNoticeDialog notice={NOTICE} onDismiss={onDismiss} />);
    await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(<OutcomeNoticeDialog notice={NOTICE} onDismiss={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
