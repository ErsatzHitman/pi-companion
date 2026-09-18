import { describe, expect, it } from "vitest";

import {
  PAD_ENTRANCE_LAST_STAGGERED_CHILD,
  PAD_ENTRANCE_STAGGER_MS,
  isPadEntranceChildAnimated,
  padEntranceDelayForChild,
  padEntranceDelayMs,
} from "./pad-entrance-model";

/**
 * PAD-FADEUP: real execution of the android spec's `.pad>.row,.pad>.card`
 * `fade-up` stagger rule (`android-spec.html`). See `pad-entrance-model.ts`'s
 * own doc comment for the two ways this rule is easy to get backwards; each
 * has its own describe block below.
 */
describe("padEntranceDelayMs: the spec's own nth-child schedule", () => {
  it("position 0 (nth-child(1)) has no matching delay rule and answers 0", () => {
    expect(padEntranceDelayMs(0)).toBe(0);
  });

  it("positions 1..7 (nth-child(2)..nth-child(8)) answer the spec's 45ms step, 45..315", () => {
    const expected = [45, 90, 135, 180, 225, 270, 315];
    for (let position = 1; position <= 7; position += 1) {
      expect(padEntranceDelayMs(position)).toBe(expected[position - 1]);
    }
  });

  it("PAD_ENTRANCE_STAGGER_MS is the 45ms step every position above is a multiple of", () => {
    expect(PAD_ENTRANCE_STAGGER_MS).toBe(45);
    for (let position = 1; position <= 7; position += 1) {
      expect(padEntranceDelayMs(position)).toBe(position * PAD_ENTRANCE_STAGGER_MS);
    }
  });
});

describe("padEntranceDelayMs: position 8+ is the CSS initial value (0), never a clamp to 315 — this is the case a future 'fix' would break", () => {
  it("position 8 (nth-child(9), one past the spec's last enumerated rule) answers 0, not 315", () => {
    expect(padEntranceDelayMs(PAD_ENTRANCE_LAST_STAGGERED_CHILD)).toBe(0);
    expect(padEntranceDelayMs(8)).toBe(0);
  });

  it("position 9 (nth-child(10)) also answers 0 — the un-matched initial value holds for every later position, it is not a one-off", () => {
    expect(padEntranceDelayMs(9)).toBe(0);
  });

  it("a large position far past the enumerated schedule still answers 0, never the eighth child's 315ms delay", () => {
    expect(padEntranceDelayMs(100)).toBe(0);
    expect(padEntranceDelayMs(100)).not.toBe(315);
  });

  it("PAD_ENTRANCE_LAST_STAGGERED_CHILD is exactly the spec's last enumerated nth-child (8), the boundary this rule turns on", () => {
    expect(PAD_ENTRANCE_LAST_STAGGERED_CHILD).toBe(8);
  });
});

describe("isPadEntranceChildAnimated: only .row/.card kinds animate", () => {
  it("answers true for row and card", () => {
    expect(isPadEntranceChildAnimated("row")).toBe(true);
    expect(isPadEntranceChildAnimated("card")).toBe(true);
  });

  it("answers false for a non-animated kind (a .lbl/.sbar/chip-row stand-in)", () => {
    expect(isPadEntranceChildAnimated("unanimated")).toBe(false);
  });
});

describe("padEntranceDelayForChild: a non-animated child consumes its position without animating", () => {
  it("a .lbl-kind child at position 0 (the pad's first child) answers null, never a delay", () => {
    expect(padEntranceDelayForChild("unanimated", 0)).toBeNull();
  });

  it("the .row right after that .lbl is still nth-child(2)'s 45ms — the label's position was consumed, not skipped", () => {
    // Mirrors android-spec.html's own a3 Settings frame: `.lbl` "host" is
    // position 0, and the `.row` right after it is position 1 (nth-child(2)),
    // not position 0 (nth-child(1)) — the label counted, so the row's own
    // delay is the spec's first non-zero step.
    const labelPosition = 0;
    const rowPosition = labelPosition + 1;
    expect(padEntranceDelayForChild("unanimated", labelPosition)).toBeNull();
    expect(padEntranceDelayForChild("row", rowPosition)).toBe(45);
  });

  it("an animated child past the schedule still animates, just with a 0ms delay (not null — it does play the entrance)", () => {
    expect(padEntranceDelayForChild("card", 8)).toBe(0);
    expect(padEntranceDelayForChild("row", 20)).toBe(0);
  });
});
