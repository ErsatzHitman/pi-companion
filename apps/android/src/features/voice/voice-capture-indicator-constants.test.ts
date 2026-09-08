import { describe, expect, it } from "vitest";

import {
  EQ_BAR_COUNT,
  EQ_BAR_DELAYS_MS,
  EQ_BOUNCE_HALF_CYCLE_MS,
  EQ_EASE_IN_OUT_BEZIER,
  EQ_MAX_SCALE,
  EQ_MIN_SCALE,
  PROCESSING_SPIN_DURATION_MS,
} from "./voice-capture-indicator-constants";

describe("voice-capture-indicator-constants (T276)", () => {
  it("EQ_BAR_DELAYS_MS has exactly EQ_BAR_COUNT entries, one per rendered bar", () => {
    expect(EQ_BAR_DELAYS_MS).toHaveLength(EQ_BAR_COUNT);
  });

  it("matches the reference artifact's .eq i:nth-child delays exactly — not a uniform index*60ms ramp", () => {
    expect(EQ_BAR_DELAYS_MS).toEqual([0, 120, 240, 60, 180]);
    // The defining, easy-to-get-wrong fact this pins: bar 4 (index 3)
    // starts BEFORE bar 3 (index 2) — a naive `index * 60` ramp would
    // put bar 3 first.
    expect(EQ_BAR_DELAYS_MS[3]).toBeLessThan(EQ_BAR_DELAYS_MS[2] as number);
  });

  it("two half-cycles make up the full 800ms eq-bounce period", () => {
    expect(EQ_BOUNCE_HALF_CYCLE_MS * 2).toBe(800);
  });

  it("EQ_MIN_SCALE/EQ_MAX_SCALE bracket the eq-bounce keyframes (.35 -> 1)", () => {
    expect(EQ_MIN_SCALE).toBe(0.35);
    expect(EQ_MAX_SCALE).toBe(1);
    expect(EQ_MIN_SCALE).toBeLessThan(EQ_MAX_SCALE);
  });

  it("EQ_EASE_IN_OUT_BEZIER is CSS's own ease-in-out control points, not this app's signature motion curve", () => {
    expect(EQ_EASE_IN_OUT_BEZIER).toEqual([0.42, 0, 0.58, 1]);
  });

  it("PROCESSING_SPIN_DURATION_MS matches Beautiful UI's .spin (.7s)", () => {
    expect(PROCESSING_SPIN_DURATION_MS).toBe(700);
  });
});
