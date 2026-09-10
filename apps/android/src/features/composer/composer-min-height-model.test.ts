import { describe, expect, it } from "vitest";

import { resolveComposerMinHeight } from "./composer-min-height-model";

describe("resolveComposerMinHeight (T343)", () => {
  it("is the section height less the scrolling controls: heading, gaps and prompt bar", () => {
    expect(resolveComposerMinHeight({ sectionHeight: 1020, controlsHeight: 561 }, 0)).toBe(459);
  });

  it("tracks a new reading while the controls still have height, up or down", () => {
    expect(resolveComposerMinHeight({ sectionHeight: 1100, controlsHeight: 561 }, 459)).toBe(539);
    expect(resolveComposerMinHeight({ sectionHeight: 900, controlsHeight: 561 }, 539)).toBe(339);
  });

  it("keeps the previous floor once the controls have been squeezed to nothing — the difference would then be the prompt bar giving way", () => {
    expect(resolveComposerMinHeight({ sectionHeight: 84, controlsHeight: 0 }, 459)).toBe(459);
  });

  it("keeps the previous floor before either view has laid out, or on a nonsensical reading", () => {
    expect(resolveComposerMinHeight({ sectionHeight: 0, controlsHeight: 0 }, 0)).toBe(0);
    expect(resolveComposerMinHeight({ sectionHeight: Number.NaN, controlsHeight: 10 }, 12)).toBe(
      12,
    );
    expect(resolveComposerMinHeight({ sectionHeight: 10, controlsHeight: 20 }, 12)).toBe(12);
  });
});
