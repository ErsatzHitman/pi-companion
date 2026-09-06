/**
 * Notification interface (plan.md §7.3).
 *
 * Core dispatches notification intents through this interface; platform
 * adapters decide how to render them (browser Notification API on web,
 * Expo notification modules on Android).
 */
export type NotificationPermissionState = "granted" | "denied" | "prompt" | "unsupported";

export interface NotificationPayload {
  id: string;
  title: string;
  body?: string;
  /** Opaque data the platform layer round-trips back on interaction. */
  data?: Record<string, string>;
}

export interface NotificationsPlatform {
  requestPermission(): Promise<NotificationPermissionState>;
  getPermissionState(): Promise<NotificationPermissionState>;
  show(payload: NotificationPayload): Promise<void>;
  /** Subscribes to user interaction with a shown notification. */
  onResponse(listener: (payload: NotificationPayload) => void): () => void;
}
