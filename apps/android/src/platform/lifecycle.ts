import { AppState, type AppStateStatus } from "react-native";

import type { AppLifecycle, AppLifecycleState } from "@picompanion/frontend-core";

/**
 * `AppLifecycle` backed by React Native's `AppState` (plan.md §7.3
 * "Android adapters use ... Expo lifecycle APIs"; T32S1B).
 *
 * The Android counterpart of `apps/web/src/platform/lifecycle.ts`
 * (T46A3), which reads `document.visibilityState`. Same semantics, a
 * deliberately separate implementation: plan.md §18.3's platform split
 * puts each host's native API behind the same `frontend-core` interface
 * rather than behind one shared abstraction, and the two APIs report
 * genuinely different state sets — the web has no true intermediate
 * state, so its adapter never reports `"inactive"`, while `AppState`
 * does.
 *
 * Intentionally as thin as possible: map a status, subscribe, unsubscribe.
 * Every judgement about *whether a change deserves a reconcile* — the
 * dedupe, the rate limit, the Wi-Fi/cellular path-switch rule — lives in
 * `../app-shell/resume-signals.ts`, which is `react-native`-free and therefore
 * unit-testable; this file exists only so that logic can be fed by the
 * real OS. See `lifecycle.test.ts`, which drives it through a mocked
 * `AppState` to prove the subscription calls through.
 */

/**
 * Maps a React Native `AppStateStatus` onto `frontend-core`'s
 * `AppLifecycleState`.
 *
 * `"unknown"` and `"extension"` (and a null `currentState`, which
 * `AppState` reports before the first native callback) map to
 * `"inactive"` rather than `"active"` or `"background"`: `"active"` would
 * make the next real foreground look like no transition at all and lose a
 * genuine resume signal, and `"background"` would over-claim a state the
 * OS has not reported. `"inactive"` is the honest "not foregrounded, not
 * fully backgrounded" bucket, and `ResumeController` treats a return to
 * `"active"` from it exactly like a return from `"background"`.
 */
export function mapAppStateStatus(status: AppStateStatus | null | undefined): AppLifecycleState {
  switch (status) {
    case "active":
      return "active";
    case "background":
      return "background";
    default:
      return "inactive";
  }
}

/** Builds the Android `AppLifecycle` adapter over the process-wide `AppState`. */
export function createAppStateLifecycle(): AppLifecycle {
  return {
    getState: () => mapAppStateStatus(AppState.currentState),
    subscribe(listener) {
      const subscription = AppState.addEventListener("change", (status) => {
        listener(mapAppStateStatus(status));
      });
      return () => {
        subscription.remove();
      };
    },
  };
}
