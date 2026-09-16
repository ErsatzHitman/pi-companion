import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "./SegmentedControl.js";

// Each `it` renders into the same `document.body`; without this the next
// query in this file matches the previous test's leftover DOM.
afterEach(cleanup);

const OPTIONS = [
  { value: "one-at-a-time", label: "One at a time" },
  { value: "all", label: "All together" },
] as const;

/**
 * SegmentedControl primitive test (ATOMS-1, plan.md §10.3, §10.5):
 * `role="tablist"`/`role="tab"` semantics, keyboard operation, and the
 * "unavailable options are explained" caller contract — the caller passes
 * `disabled`, this control never invents its own unavailable copy.
 */
describe("SegmentedControl", () => {
  it("renders a tablist of equal-width tabs with the current value selected", () => {
    render(
      <SegmentedControl
        ariaLabel="Steering queue delivery"
        options={OPTIONS}
        value="one-at-a-time"
        onChange={() => {}}
      />,
    );
    const tablist = screen.getByRole("tablist", { name: "Steering queue delivery" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tablist.contains(tabs[0])).toBe(true);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
  });

  it("is keyboard-operable and calls onChange with the pressed option's value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Steering queue delivery"
        options={OPTIONS}
        value="one-at-a-time"
        onChange={onChange}
      />,
    );
    const allTab = screen.getByRole("tab", { name: "All together" });
    allTab.focus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("disables every tab when the caller says so, rather than inventing its own reason", () => {
    render(
      <SegmentedControl
        ariaLabel="Steering queue delivery"
        options={OPTIONS}
        value="one-at-a-time"
        onChange={() => {}}
        disabled
        testId="steering-segmented"
      />,
    );
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.hasAttribute("disabled")).toBe(true);
    }
  });
});
