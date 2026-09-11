import { describe, expect, it } from "vitest";

import {
  CONTEXT_RING_CIRCUMFERENCE,
  CONTEXT_RING_RADIUS,
  CONTEXT_RING_SIZE,
  CONTEXT_RING_STROKE,
  buildContextRingViewModel,
} from "./context-ring-model";

const window = (used: number, max: number) => ({
  contextWindowUsedTokens: used,
  contextWindowMaxTokens: max,
});

describe("context ring geometry", () => {
  it("keeps the stroke inside the ring's own box", () => {
    // T385: the artifact's own numbers (a 28px box, r=12, stroke 2.5)
    // leave 0.75px of slack rather than touching the edge, so the
    // invariant this pins is containment — the stroked circle's outer
    // edge may not pass the box — not the exact equality an earlier
    // 18px ring happened to satisfy.
    expect(CONTEXT_RING_RADIUS * 2 + CONTEXT_RING_STROKE).toBeLessThanOrEqual(CONTEXT_RING_SIZE);
    expect(CONTEXT_RING_SIZE - (CONTEXT_RING_RADIUS * 2 + CONTEXT_RING_STROKE)).toBeLessThan(
      CONTEXT_RING_STROKE,
    );
  });

  it("derives the circumference from that radius, matching the artifact's own 2πr", () => {
    expect(CONTEXT_RING_CIRCUMFERENCE).toBeCloseTo(2 * Math.PI * 12, 6);
    expect(CONTEXT_RING_CIRCUMFERENCE).toBeCloseTo(75.398, 3);
  });
});

describe("buildContextRingViewModel", () => {
  it("draws no arc at 0% and a full one at 100%", () => {
    expect(buildContextRingViewModel(window(0, 200_000)).dashOffset).toBeCloseTo(
      CONTEXT_RING_CIRCUMFERENCE,
      6,
    );
    expect(buildContextRingViewModel(window(200_000, 200_000)).dashOffset).toBeCloseTo(0, 6);
  });

  it("offsets the dash in proportion to the fraction used", () => {
    const model = buildContextRingViewModel(window(50_000, 200_000));
    expect(model.fraction).toBeCloseTo(0.25, 6);
    expect(model.dashOffset).toBeCloseTo(CONTEXT_RING_CIRCUMFERENCE * 0.75, 6);
  });

  it("labels the ring with a whole percent, bare digits inside the ring", () => {
    // The artifact draws `<text class="pct">12</text>` INSIDE a 28px
    // ring, so the label has no percent sign; the spelled-out reading
    // lives in `accessibilityLabel` (pinned below).
    expect(buildContextRingViewModel(window(82_400, 200_000)).shortLabel).toBe("41");
    expect(buildContextRingViewModel(window(200_000, 200_000)).shortLabel).toBe("100");
  });

  it("carries the same colour band the Live screen's card uses", () => {
    expect(buildContextRingViewModel(window(10, 100)).band).toBe("normal");
    expect(buildContextRingViewModel(window(75, 100)).band).toBe("warning");
    expect(buildContextRingViewModel(window(95, 100)).band).toBe("critical");
  });

  it("draws no arc and says so in words when the provider has reported no window", () => {
    const model = buildContextRingViewModel({ inputTokens: 12 });
    expect(model.fraction).toBeNull();
    expect(model.dashOffset).toBe(CONTEXT_RING_CIRCUMFERENCE);
    expect(model.shortLabel).toBe("–");
    expect(model.accessibilityLabel.toLowerCase()).toContain("unknown");
  });

  it("treats an absent usage as unknown, never as an empty window", () => {
    for (const usage of [null, undefined]) {
      const model = buildContextRingViewModel(usage);
      expect(model.fraction).toBeNull();
      expect(model.shortLabel).toBe("–");
    }
  });

  it("announces a sentence and a hint, so the ring never reads as a decorative circle", () => {
    const model = buildContextRingViewModel(window(82_400, 200_000));
    expect(model.accessibilityLabel).toContain("41.2%");
    expect(model.accessibilityHint.length).toBeGreaterThan(0);
    expect(model.accessibilityHint.toLowerCase()).toContain("model");
  });

  it("never produces a dash offset outside the circumference, whatever a provider reports", () => {
    for (const usage of [window(-10, 100), window(500, 100), window(0, 100)]) {
      const model = buildContextRingViewModel(usage);
      expect(model.dashOffset).toBeGreaterThanOrEqual(0);
      expect(model.dashOffset).toBeLessThanOrEqual(CONTEXT_RING_CIRCUMFERENCE);
    }
  });
});
