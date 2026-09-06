import type { VibrationPattern, VibrationPlatform } from "./haptic.js";

/**
 * A scripted `VibrationPlatform` for unit tests (this task's acceptance
 * criteria call for proof "against a fake vibration platform -- no device
 * or emulator needed"). Records every call so a test can assert both the
 * pattern and the call count -- in particular, that a suppressed trigger
 * reaches `vibrate` zero times.
 */
export function createFakeVibrationPlatform(): VibrationPlatform & { calls: VibrationPattern[] } {
  const calls: VibrationPattern[] = [];
  return {
    calls,
    vibrate(pattern) {
      calls.push(pattern);
    },
  };
}
