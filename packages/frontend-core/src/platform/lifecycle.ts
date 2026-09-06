/**
 * App lifecycle and foreground-state interface (plan.md §7.3).
 *
 * Drives reconnect-on-foreground and pausing background work. Web
 * adapters use `document.visibilitychange`/`online`/`offline`; Android
 * adapters use Expo `AppState`.
 */
export type AppLifecycleState = "active" | "inactive" | "background";

export interface AppLifecycle {
  getState(): AppLifecycleState;
  subscribe(listener: (state: AppLifecycleState) => void): () => void;
}
