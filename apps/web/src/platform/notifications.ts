import type {
  NotificationPayload,
  NotificationPermissionState,
  NotificationsPlatform,
} from "@picompanion/frontend-core";

function mapPermission(permission: NotificationPermission): NotificationPermissionState {
  switch (permission) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    default:
      return "prompt";
  }
}

/** `NotificationsPlatform` backed by the browser Notification API (plan.md §7.3). */
export function createBrowserNotifications(): NotificationsPlatform {
  const listeners = new Set<(payload: NotificationPayload) => void>();
  const supported = typeof window !== "undefined" && "Notification" in window;

  return {
    async requestPermission() {
      if (!supported) return "unsupported";
      const permission = await Notification.requestPermission();
      return mapPermission(permission);
    },
    async getPermissionState() {
      if (!supported) return "unsupported";
      return mapPermission(Notification.permission);
    },
    async show(payload) {
      if (!supported || Notification.permission !== "granted") return;
      const notification = new Notification(payload.title, {
        body: payload.body,
        data: payload.data,
      });
      notification.addEventListener("click", () => {
        for (const listener of listeners) listener(payload);
      });
    },
    onResponse(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
