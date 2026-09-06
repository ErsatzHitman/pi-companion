import { Vibration } from "react-native";

import type { VibrationPlatform } from "./haptic.js";

/**
 * The real Android `VibrationPlatform`, backed by React Native's built-in
 * `Vibration` API rather than `expo-haptics`.
 *
 * `expo-haptics` is not installed in this workspace (only listed in
 * `node_modules/expo/bundledNativeModules.json`, pinned there at
 * `~57.0.2`) and this task may not run an install. `react-native`'s
 * `Vibration` module, by contrast, ships inside the already-installed
 * `react-native` package (`node_modules/react-native/Libraries/Vibration/`)
 * and its `vibrate(pattern: number | number[])` accepts exactly the
 * `[off, on, off, on, ...]` pattern shape `HAPTIC_PATTERNS` already uses, so
 * no native module install is needed to make this adapter real.
 *
 * If a later task wants `expo-haptics`' distinct notification/impact/
 * selection feel types instead of raw vibration patterns, install it with:
 *
 *   npm install expo-haptics@~57.0.2
 *
 * and swap this file's implementation; `fireHaptic` and every call site
 * that only depends on the `VibrationPlatform` port would be unaffected.
 *
 * Kept intentionally as thin as `../lifecycle.ts`'s `AppState` binding: all
 * of the trigger/suppression/visible-signal logic lives in `./haptic.ts`,
 * which stays `react-native`-free and unit-testable. This file exists only
 * so that logic can be fed by the real OS. See `./vibration-platform.test.ts`,
 * which drives it through a mocked `Vibration` to prove the binding calls
 * through -- following the same `vi.mock("react-native", ...)` technique as
 * `../lifecycle.test.ts`.
 */
export function createRNVibrationPlatform(): VibrationPlatform {
  return {
    vibrate(pattern) {
      Vibration.vibrate(pattern as number[]);
    },
  };
}
