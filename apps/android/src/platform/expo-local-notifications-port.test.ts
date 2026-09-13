import { describe, expect, it, vi } from "vitest";

import { createUnavailablePushRegistrationPort } from "../features/notifications/push-registration-port.js";
import {
  createAndroidNotificationsPlatform,
  createExpoAndroidNotificationsPort,
  GENERAL_NOTIFICATION_CHANNEL,
  toLocalNotificationPayload,
  type ExpoLocalNotificationResponse,
  type ExpoLocalNotificationsBindings,
} from "./notifications-platform.js";

function createFakeBindings(): ExpoLocalNotificationsBindings & {
  listeners: Array<(response: ExpoLocalNotificationResponse) => void>;
} {
  const listeners: Array<(response: ExpoLocalNotificationResponse) => void> = [];
  return {
    listeners,
    setNotificationChannelAsync: vi.fn(async () => undefined),
    scheduleNotificationAsync: vi.fn(async () => undefined),
    addNotificationResponseReceivedListener: vi.fn(async (listener) => {
      listeners.push(listener);
      return { remove: () => {} };
    }),
  };
}

function tapResponse(): ExpoLocalNotificationResponse {
  return {
    notification: {
      request: {
        identifier: "n1",
        content: {
          title: "Hello",
          body: "World",
          data: { sessionId: "s1", noisy: 7 },
        },
      },
    },
  };
}

describe("createExpoAndroidNotificationsPort local half", () => {
  it("schedules on the general channel with the payload round-tripped", async () => {
    const bindings = createFakeBindings();
    const port = createExpoAndroidNotificationsPort(
      createUnavailablePushRegistrationPort(),
      bindings,
    );
    await port.showNotification({ id: "n1", title: "Hello", body: "World", data: { a: "b" } });
    expect(bindings.setNotificationChannelAsync).toHaveBeenCalledWith(GENERAL_NOTIFICATION_CHANNEL);
    expect(bindings.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: "n1",
      title: "Hello",
      body: "World",
      data: { a: "b" },
      channelId: GENERAL_NOTIFICATION_CHANNEL,
    });
  });

  it("drops silently when the native module throws", async () => {
    const bindings = createFakeBindings();
    bindings.scheduleNotificationAsync = vi.fn(async () => {
      throw new Error("no native module");
    });
    const port = createExpoAndroidNotificationsPort(
      createUnavailablePushRegistrationPort(),
      bindings,
    );
    await expect(port.showNotification({ id: "n1", title: "Hello" })).resolves.toBeUndefined();
  });

  it("routes tap-responses to the subscriber and drops non-string data", async () => {
    const bindings = createFakeBindings();
    const port = createExpoAndroidNotificationsPort(
      createUnavailablePushRegistrationPort(),
      bindings,
    );
    const seen: Array<{ id: string; title: string }> = [];
    const unsubscribe = port.onNotificationResponse((payload) => {
      seen.push(payload);
    });
    expect(bindings.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
    bindings.listeners[0]?.(tapResponse());
    expect(seen).toEqual([{ id: "n1", title: "Hello", body: "World", data: { sessionId: "s1" } }]);
    unsubscribe();
    bindings.listeners[0]?.(tapResponse());
    expect(seen).toHaveLength(1);
  });

  it("never attaches when the native module is absent, but unsubscribe still works", async () => {
    const bindings = createFakeBindings();
    bindings.addNotificationResponseReceivedListener = vi.fn(async () => {
      throw new Error("no native module");
    });
    const port = createExpoAndroidNotificationsPort(
      createUnavailablePushRegistrationPort(),
      bindings,
    );
    const handler = vi.fn();
    const unsubscribe = port.onNotificationResponse(handler);
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("platform show() reaches schedule once permission is granted", async () => {
    const bindings = createFakeBindings();
    const port = createExpoAndroidNotificationsPort(
      { ...createUnavailablePushRegistrationPort(), getPermissionStatus: async () => "granted" },
      bindings,
    );
    const platform = createAndroidNotificationsPlatform(port);
    await platform.show({ id: "n1", title: "Hello" });
    expect(bindings.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it("maps a title-less response to an empty title rather than throwing", () => {
    expect(
      toLocalNotificationPayload({ notification: { request: { identifier: "x", content: {} } } }),
    ).toEqual({ id: "x", title: "" });
  });
});
