import type { AppLifecycle, AppLifecycleState } from "@picompanion/frontend-core";

/**
 * `AppLifecycle` backed by `document.visibilitychange` (plan.md §7.3).
 *
 * The web has no distinct "background" state the way a mobile OS does, so
 * a hidden document (backgrounded tab, minimized window) maps to
 * `"background"` and a visible one maps to `"active"`. `"inactive"` is
 * reserved for platforms with a true intermediate state (Android); this
 * adapter never reports it.
 *
 * T46A3, plan.md §7.4 "Liveness": a caller feeds this into
 * `connection.ResumeController`'s `lifecycle` option (alongside
 * `createBrowserNetworkReachability()` for the connectivity half), which
 * subscribes automatically and treats a `"background"`/`"inactive"` ->
 * `"active"` transition as a host-supplied resume signal — the case a
 * closed-socket reconnect and an app-restart recovery both miss: a
 * socket that stays open but goes silent because the tab was
 * backgrounded. `document.visibilitychange` fires synchronously off the
 * real browser event, so that signal reaches the controller within the
 * same tick, well inside the "within one second of visibility"
 * acceptance bar. See `lifecycle-resume-reconciliation.test.ts` for the
 * end-to-end proof against the real adapter (this file) rather than the
 * fake `AppLifecycle` double `resume-controller.test.ts` uses.
 */
export function createDocumentVisibilityLifecycle(): AppLifecycle {
  const state = (): AppLifecycleState =>
    document.visibilityState === "visible" ? "active" : "background";

  return {
    getState: state,
    subscribe(listener) {
      const handler = () => listener(state());
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    },
  };
}
