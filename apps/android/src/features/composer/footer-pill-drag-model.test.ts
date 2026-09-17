import { describe, expect, it } from "vitest";

import {
  SWIPE_COMMIT_PX,
  SWIPE_MAX_PX,
  cycleOptionId,
  cyclePillIndex,
  isSwipeReady,
  rubberBandOffsetPx,
  resolveSwipeStep,
} from "./footer-pill-drag-model";

describe("rubberBandOffsetPx", () => {
  it("answers a small drag with close to the finger's own distance, scaled by the curve's own slope at zero", () => {
    // tanh(x) ≈ x for small x, so near zero this is ≈ SW_MAX/(SW_MAX×1.15)
    // × dx = dx/1.15 ≈ 0.87×dx — close to the finger, not identical to
    // it (the artifact's own comment calls this "1:1 near zero" loosely;
    // 0.87 is what the exact formula gives).
    expect(rubberBandOffsetPx(1)).toBeGreaterThan(0.85);
    expect(rubberBandOffsetPx(1)).toBeLessThan(0.88);
    expect(rubberBandOffsetPx(-1)).toBeLessThan(-0.85);
    expect(rubberBandOffsetPx(-1)).toBeGreaterThan(-0.88);
  });

  it("never exceeds its own asymptote, however far the finger travels", () => {
    // `Math.tanh` saturates to exactly 1 in double precision well before
    // dx reaches 1000, so the curve DOES reach SWIPE_MAX_PX in floating
    // point even though the real function only approaches it — the
    // invariant this pins is the ceiling, not strict inequality.
    expect(Math.abs(rubberBandOffsetPx(1000))).toBeLessThanOrEqual(SWIPE_MAX_PX);
    expect(Math.abs(rubberBandOffsetPx(-1000))).toBeLessThanOrEqual(SWIPE_MAX_PX);
    // At a moderate drag, still short of the ceiling — this is the real,
    // strict half of the claim.
    expect(Math.abs(rubberBandOffsetPx(120))).toBeLessThan(SWIPE_MAX_PX);
  });

  it("is still visibly short of the ceiling right at the commit threshold", () => {
    // Proves the artifact's own 1.15 softening divisor is present, not
    // just any tanh curve — without it a naive SW_MAX*tanh(dx/SW_MAX)
    // would already sit much closer to the ceiling at this exact dx.
    expect(rubberBandOffsetPx(SWIPE_COMMIT_PX)).toBeLessThan(SWIPE_MAX_PX * 0.85);
  });

  it("is antisymmetric — a drag and its mirror image move the same distance", () => {
    for (const dx of [3, 15, 26, 60]) {
      expect(rubberBandOffsetPx(-dx)).toBeCloseTo(-rubberBandOffsetPx(dx), 9);
    }
  });
});

describe("isSwipeReady / resolveSwipeStep", () => {
  it("is not ready just under the commit threshold, and is ready at or past it", () => {
    expect(isSwipeReady(SWIPE_COMMIT_PX - 0.01)).toBe(false);
    expect(isSwipeReady(SWIPE_COMMIT_PX)).toBe(true);
    expect(isSwipeReady(-SWIPE_COMMIT_PX)).toBe(true);
  });

  it("resolves no step below the commit threshold, whichever direction", () => {
    expect(resolveSwipeStep(10)).toBe(0);
    expect(resolveSwipeStep(-10)).toBe(0);
  });

  it("steps forward on a LEFTWARD (negative) drag and back on a rightward one — the artifact's own reversed convention", () => {
    expect(resolveSwipeStep(-SWIPE_COMMIT_PX)).toBe(1);
    expect(resolveSwipeStep(SWIPE_COMMIT_PX)).toBe(-1);
  });
});

describe("cyclePillIndex", () => {
  it("wraps forward past the last option back to the first", () => {
    expect(cyclePillIndex(3, 2, 1)).toBe(0);
  });

  it("wraps backward past the first option to the last", () => {
    expect(cyclePillIndex(3, 0, -1)).toBe(2);
  });

  it("does nothing useful but stays in range for a zero-length list", () => {
    expect(cyclePillIndex(0, 5, 1)).toBe(0);
  });

  it("treats an out-of-range current index as though it were the first option", () => {
    expect(cyclePillIndex(3, -1, 1)).toBe(1);
    expect(cyclePillIndex(3, 9, 1)).toBe(1);
  });
});

describe("cycleOptionId", () => {
  const ids = ["build", "plan"];

  it("returns no change for a zero step, whatever the current id", () => {
    expect(cycleOptionId(ids, "build", 0)).toBeNull();
  });

  it("returns no change for an empty option list", () => {
    expect(cycleOptionId([], "build", 1)).toBeNull();
  });

  it("steps to the next id, wrapping past the end", () => {
    expect(cycleOptionId(ids, "build", 1)).toBe("plan");
    expect(cycleOptionId(ids, "plan", 1)).toBe("build");
  });

  it("steps to the previous id, wrapping past the start", () => {
    expect(cycleOptionId(ids, "build", -1)).toBe("plan");
  });

  it("treats an unrecognised or absent current id as though it were the first option", () => {
    expect(cycleOptionId(ids, "not-a-real-id", 1)).toBe("plan");
    expect(cycleOptionId(ids, null, 1)).toBe("plan");
    expect(cycleOptionId(ids, undefined, 1)).toBe("plan");
  });
});
