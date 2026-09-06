import { describe, expect, it } from "vitest";

import { createFakeVibrationPlatform } from "./fake-vibration-platform.js";
import { fireHaptic, HAPTIC_PATTERNS, HAPTIC_TRIGGERS, type HapticTrigger } from "./haptic.js";

describe("HAPTIC_PATTERNS", () => {
  it("defines exactly the four §9.3 states", () => {
    expect(Object.keys(HAPTIC_PATTERNS).sort()).toEqual(
      ["approval", "blocked", "error", "finished"].sort(),
    );
    expect(HAPTIC_TRIGGERS.slice().sort()).toEqual(
      ["approval", "blocked", "error", "finished"].sort(),
    );
  });

  it("gives each of the four patterns a distinct pulse count, so they are tellable apart by feel alone", () => {
    const pulseCounts = new Map<HapticTrigger, number>();
    for (const trigger of HAPTIC_TRIGGERS) {
      // Odd indices (1, 3, 5, ...) in an RN vibration pattern are the "on" pulses.
      const onPulses = HAPTIC_PATTERNS[trigger].filter((_, i) => i % 2 === 1);
      pulseCounts.set(trigger, onPulses.length);
    }
    const counts = Array.from(pulseCounts.values());
    expect(new Set(counts).size).toBe(counts.length);
  });

  it("keeps every pattern's total duration under 450ms, so it never reads as a stuck buzzer", () => {
    for (const trigger of HAPTIC_TRIGGERS) {
      const total = HAPTIC_PATTERNS[trigger].reduce((sum, ms) => sum + ms, 0);
      expect(total).toBeLessThan(450);
    }
  });
});

describe("fireHaptic", () => {
  it("fires each of the four §9.3 states with its documented pattern against a fake vibration platform", () => {
    for (const trigger of HAPTIC_TRIGGERS) {
      const platform = createFakeVibrationPlatform();
      const result = fireHaptic(platform, {
        trigger,
        hapticsEnabled: true,
        visibleSignal: `${trigger}-banner`,
      });

      expect(result).toEqual({ trigger, fired: true });
      expect(platform.calls).toEqual([HAPTIC_PATTERNS[trigger]]);
    }
  });

  it("suppresses the haptic when hapticsEnabled is false, reaching the platform zero times", () => {
    const platform = createFakeVibrationPlatform();
    const result = fireHaptic(platform, {
      trigger: "error",
      hapticsEnabled: false,
      visibleSignal: "error-banner",
    });

    expect(result).toEqual({ trigger: "error", fired: false });
    expect(platform.calls).toEqual([]);
  });

  it("suppresses every one of the four triggers when disabled, not just one", () => {
    const platform = createFakeVibrationPlatform();
    for (const trigger of HAPTIC_TRIGGERS) {
      fireHaptic(platform, { trigger, hapticsEnabled: false, visibleSignal: "x" });
    }
    expect(platform.calls).toEqual([]);
  });

  it("throws rather than firing when visibleSignal is missing, even if haptics are enabled", () => {
    const platform = createFakeVibrationPlatform();
    expect(() =>
      fireHaptic(platform, {
        trigger: "approval",
        hapticsEnabled: true,
        visibleSignal: "",
      }),
    ).toThrow(/visibleSignal/);
    expect(platform.calls).toEqual([]);
  });

  it("throws when visibleSignal is whitespace-only", () => {
    const platform = createFakeVibrationPlatform();
    expect(() =>
      fireHaptic(platform, {
        trigger: "blocked",
        hapticsEnabled: true,
        visibleSignal: "   ",
      }),
    ).toThrow(/visibleSignal/);
    expect(platform.calls).toEqual([]);
  });

  it("does not suppress the visible-signal check even when the caller also disables haptics", () => {
    // Ordering proof: an empty visibleSignal is a programmer error and must
    // surface even on a path that would otherwise be a silent no-op.
    const platform = createFakeVibrationPlatform();
    expect(() =>
      fireHaptic(platform, { trigger: "finished", hapticsEnabled: false, visibleSignal: "" }),
    ).toThrow(/visibleSignal/);
  });
});
