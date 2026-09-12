import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { composer as coreComposer } from "@picompanion/frontend-core";

import { ReferenceSuggestions } from "./ReferenceSuggestions.js";

afterEach(cleanup);

const ITEMS: coreComposer.ReferenceCandidate[] = [
  { kind: "skill", id: "review", label: "@review", description: "Review the current diff" },
  { kind: "file", id: "src/index.ts", label: "src/index.ts" },
];

describe("ReferenceSuggestions", () => {
  it("renders a labelled listbox with each candidate's kind in visible text", () => {
    render(
      <ReferenceSuggestions
        listboxId="refs"
        items={ITEMS}
        activeIndex={0}
        onSelect={() => {}}
        testId="refs"
      />,
    );

    expect(screen.getByRole("listbox", { name: "References" })).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options[0]?.textContent).toContain("@review");
    expect(options[0]?.textContent).toContain("skill");
    expect(options[1]?.textContent).toContain("file");
  });

  it("chooses a candidate on mousedown without stealing focus", () => {
    const onSelect = vi.fn();
    render(
      <ReferenceSuggestions listboxId="refs" items={ITEMS} activeIndex={0} onSelect={onSelect} />,
    );

    const option = screen.getAllByRole("option")[1];
    const defaultPrevented = !fireEvent.mouseDown(option!);

    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
    // `preventDefault` on mousedown keeps the textarea focused.
    expect(defaultPrevented).toBe(true);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ReferenceSuggestions listboxId="refs" items={ITEMS} activeIndex={0} onSelect={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
