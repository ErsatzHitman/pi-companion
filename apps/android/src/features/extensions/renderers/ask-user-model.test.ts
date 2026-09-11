import { describe, expect, it } from "vitest";

import { askUserFooterHint, askUserTagLabel } from "./ask-user-model";

describe("askUserTagLabel (T361)", () => {
  it("brackets whatever namespace sent the panel", () => {
    expect(askUserTagLabel("ask-user")).toBe("[ask-user]");
    // Not hardcoded to one string: a second question extension, or a
    // renamed one, still gets a label instead of an unlabelled sheet.
    expect(askUserTagLabel("subagents")).toBe("[subagents]");
    expect(askUserTagLabel("ask-user-v2")).toBe("[ask-user-v2]");
  });

  it("passes an empty namespace through rather than inventing a name", () => {
    expect(askUserTagLabel("")).toBe("[]");
  });
});

describe("askUserFooterHint (T361)", () => {
  it("says what a touch reader can actually do", () => {
    expect(askUserFooterHint(true)).toBe(
      "Tap an option to answer · dismiss to let the model choose",
    );
  });

  it("drops the dismiss clause when there is nothing to dismiss", () => {
    // A hint offering a way out that is not there is worse than a
    // shorter hint.
    expect(askUserFooterHint(false)).toBe("Tap an option to answer");
  });

  it("ships neither of the artifact's keyboard instructions", () => {
    // "1-2 to answer · esc to let the model choose" — Android has no
    // `esc` key and no number row bound to anything here. Same call
    // T359 made for the bash block's "esc to cancel".
    for (const hint of [askUserFooterHint(true), askUserFooterHint(false)]) {
      expect(hint).not.toMatch(/esc\b/);
      expect(hint).not.toMatch(/1-2/);
    }
  });
});
