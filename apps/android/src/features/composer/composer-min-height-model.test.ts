import { describe, expect, it } from "vitest";

import { resolveComposerMinHeight } from "./composer-min-height-model";

describe("resolveComposerMinHeight (T343, corrected at T344)", () => {
  it("is heading + prompt bar + two section gaps: the parts of the composer that never scroll", () => {
    expect(resolveComposerMinHeight({ titleHeight: 54, promptBarHeight: 341, gap: 32 })).toBe(459);
  });

  it("has no floor until both the heading and the prompt bar have laid out", () => {
    expect(resolveComposerMinHeight({ titleHeight: 0, promptBarHeight: 341, gap: 32 })).toBe(0);
    expect(resolveComposerMinHeight({ titleHeight: 54, promptBarHeight: 0, gap: 32 })).toBe(0);
    expect(
      resolveComposerMinHeight({ titleHeight: Number.NaN, promptBarHeight: 341, gap: 32 }),
    ).toBe(0);
  });

  it("tolerates a missing gap rather than poisoning the sum", () => {
    expect(
      resolveComposerMinHeight({ titleHeight: 54, promptBarHeight: 341, gap: Number.NaN }),
    ).toBe(395);
  });

  it("T344: never reads a squeezed scroll view — the floor cannot exceed the natural heights it sums (run 34497459568's failure mode)", () => {
    // The section was 1041 tall and the controls stale at 5; a difference
    // would have said 1036. A sum of two unshrinkable views cannot.
    expect(
      resolveComposerMinHeight({ titleHeight: 54, promptBarHeight: 341, gap: 32 }),
    ).toBeLessThan(1000);
  });
});
