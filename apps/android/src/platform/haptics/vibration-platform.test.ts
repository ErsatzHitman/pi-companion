/**
 * T33B6 coverage for the Android `VibrationPlatform` adapter.
 *
 * Same technique as `../lifecycle.test.ts`: `react-native` cannot be
 * transformed by this workspace's plain `vitest` setup, so `Vibration` is
 * replaced with a controllable fixture via a `vi.mock` factory before the
 * module under test is imported. That proves the binding itself (does
 * `vibrate()` actually reach `Vibration.vibrate` with the exact pattern?)
 * rather than settling for a source-text assertion.
 */
import { describe, expect, it, vi } from "vitest";

const vibrationFixture = vi.hoisted(() => {
  return {
    calls: [] as unknown[][],
    vibrate(...args: unknown[]) {
      vibrationFixture.calls.push(args);
    },
    reset() {
      vibrationFixture.calls = [];
    },
  };
});

vi.mock("react-native", () => ({ Vibration: vibrationFixture }));

const { createRNVibrationPlatform } = await import("./vibration-platform.js");

describe("createRNVibrationPlatform", () => {
  it("forwards vibrate(pattern) straight through to Vibration.vibrate", () => {
    vibrationFixture.reset();
    const platform = createRNVibrationPlatform();

    platform.vibrate([0, 80, 60, 80, 60, 80]);

    expect(vibrationFixture.calls).toEqual([[[0, 80, 60, 80, 60, 80]]]);
  });

  it("forwards each pattern independently across repeated calls", () => {
    vibrationFixture.reset();
    const platform = createRNVibrationPlatform();

    platform.vibrate([0, 40]);
    platform.vibrate([0, 30, 60, 30]);

    expect(vibrationFixture.calls).toEqual([[[0, 40]], [[0, 30, 60, 30]]]);
  });
});
