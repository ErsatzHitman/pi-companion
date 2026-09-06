import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotificationPayload } from "@picompanion/frontend-core";

import type { PermissionState } from "../features/notifications/push-registration-port.js";
import {
  createAndroidNotificationsPlatform,
  createUnavailableAndroidNotificationsPlatform,
  createUnavailableAndroidNotificationsPort,
  getNativePermissionState,
  mapPermissionState,
  type AndroidNotificationsPort,
} from "./notifications-platform.js";

const ALL_PERMISSION_STATES: PermissionState[] = [
  "undetermined",
  "granted",
  "denied",
  "denied-permanently",
  "unavailable",
];

function fakePort(overrides: Partial<AndroidNotificationsPort> = {}): AndroidNotificationsPort & {
  showCalls: NotificationPayload[];
  responseListeners: ((payload: NotificationPayload) => void)[];
  unsubscribeCalls: number;
} {
  const showCalls: NotificationPayload[] = [];
  const responseListeners: ((payload: NotificationPayload) => void)[] = [];
  let unsubscribeCalls = 0;
  return {
    showCalls,
    responseListeners,
    get unsubscribeCalls() {
      return unsubscribeCalls;
    },
    async getPermissionStatus(): Promise<PermissionState> {
      return "granted";
    },
    async requestPermission(): Promise<PermissionState> {
      return "granted";
    },
    async getToken(): Promise<string | null> {
      return null;
    },
    onTokenRefresh(): () => void {
      return () => {};
    },
    async postPermissionNotification(): Promise<void> {},
    async cancelPermissionNotification(): Promise<void> {},
    onNotificationAction(): () => void {
      return () => {};
    },
    async showNotification(payload: NotificationPayload): Promise<void> {
      showCalls.push(payload);
    },
    onNotificationResponse(listener: (payload: NotificationPayload) => void): () => void {
      responseListeners.push(listener);
      return () => {
        unsubscribeCalls += 1;
      };
    },
    ...overrides,
  };
}

describe("mapPermissionState", () => {
  it("maps every PermissionState to a named NotificationPermissionState", () => {
    expect(mapPermissionState("granted")).toBe("granted");
    expect(mapPermissionState("denied")).toBe("denied");
    expect(mapPermissionState("denied-permanently")).toBe("denied");
    expect(mapPermissionState("undetermined")).toBe("prompt");
    expect(mapPermissionState("unavailable")).toBe("unsupported");
  });

  it("covers the full PermissionState union with no throw", () => {
    for (const state of ALL_PERMISSION_STATES) {
      expect(() => mapPermissionState(state)).not.toThrow();
    }
  });
});

describe("createAndroidNotificationsPlatform", () => {
  it("requestPermission delegates to the port and maps the result", async () => {
    const port = fakePort({ requestPermission: async () => "undetermined" });
    const platform = createAndroidNotificationsPlatform(port);
    await expect(platform.requestPermission()).resolves.toBe("prompt");
  });

  it("getPermissionState delegates to the port and maps the result", async () => {
    const port = fakePort({ getPermissionStatus: async () => "denied-permanently" });
    const platform = createAndroidNotificationsPlatform(port);
    await expect(platform.getPermissionState()).resolves.toBe("denied");
  });

  it("show() calls port.showNotification with the payload verbatim when granted", async () => {
    const port = fakePort({ getPermissionStatus: async () => "granted" });
    const platform = createAndroidNotificationsPlatform(port);
    const payload: NotificationPayload = { id: "n1", title: "Hello", body: "World" };
    await platform.show(payload);
    expect(port.showCalls).toEqual([payload]);
  });

  it.each<PermissionState>(["denied", "denied-permanently", "undetermined", "unavailable"])(
    "show() does not call port.showNotification when permission is %s",
    async (state) => {
      const port = fakePort({ getPermissionStatus: async () => state });
      const platform = createAndroidNotificationsPlatform(port);
      await platform.show({ id: "n1", title: "Hello" });
      expect(port.showCalls).toEqual([]);
    },
  );

  it("onResponse registers the listener on the port and returns its unsubscribe", () => {
    const port = fakePort();
    const platform = createAndroidNotificationsPlatform(port);
    const listener = vi.fn();
    const unsubscribe = platform.onResponse(listener);
    expect(port.responseListeners).toEqual([listener]);
    unsubscribe();
    expect(port.unsubscribeCalls).toBe(1);
  });

  it("delivers a response payload back through onResponse", () => {
    const port = fakePort();
    const platform = createAndroidNotificationsPlatform(port);
    const received: NotificationPayload[] = [];
    platform.onResponse((payload) => received.push(payload));
    const payload: NotificationPayload = { id: "n2", title: "Tap me" };
    port.responseListeners[0]?.(payload);
    expect(received).toEqual([payload]);
  });
});

describe("content safety", () => {
  const consoleMethods = ["log", "warn", "error", "info", "debug"] as const;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never writes notification content to console across show()", async () => {
    const spies = consoleMethods.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const port = fakePort({ getPermissionStatus: async () => "granted" });
    const platform = createAndroidNotificationsPlatform(port);
    await platform.show({
      id: "sensitive-1",
      title: "Agent needs approval",
      body: "rm -rf /home/user/secrets — approve?",
      data: { requestId: "req-1", agentId: "agent-1" },
    });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("getNativePermissionState", () => {
  it("preserves denied-permanently, which the interface-level mapping collapses", async () => {
    const port = fakePort({ getPermissionStatus: async () => "denied-permanently" });
    await expect(getNativePermissionState(port)).resolves.toBe("denied-permanently");
    const platform = createAndroidNotificationsPlatform(port);
    await expect(platform.getPermissionState()).resolves.toBe("denied");
  });
});

describe("createUnavailableAndroidNotificationsPort / Platform", () => {
  it("reports unavailable permission as unsupported through the interface", async () => {
    const port = createUnavailableAndroidNotificationsPort();
    await expect(port.getPermissionStatus()).resolves.toBe("unavailable");
    const platform = createUnavailableAndroidNotificationsPlatform();
    await expect(platform.getPermissionState()).resolves.toBe("unsupported");
    await expect(platform.requestPermission()).resolves.toBe("unsupported");
  });

  it("show() is a silent no-op with no native module", async () => {
    const platform = createUnavailableAndroidNotificationsPlatform();
    await expect(platform.show({ id: "n1", title: "Hello" })).resolves.toBeUndefined();
  });

  it("onResponse returns a working no-op unsubscribe", () => {
    const platform = createUnavailableAndroidNotificationsPlatform();
    const unsubscribe = platform.onResponse(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
