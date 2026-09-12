/**
 * T391 coverage for the real `createExpoPushRegistrationPort` adapter.
 *
 * `expo-notifications`' own JS entry imports `react-native`/native
 * modules, which this workspace's plain `vitest` setup cannot load — so
 * two proof strategies, mirroring
 * `../../platform/offline/expo-sqlite-driver-factory.test.ts`:
 *
 *  - Most of this suite injects plain fake `ExpoNotificationsBindings`/
 *    `ExpoPushEnvironment` directly, proving the adapter's own mapping
 *    and forwarding logic with no native module involved.
 *  - The last block proves `DEFAULT_BINDINGS`/`DEFAULT_ENVIRONMENT`
 *    themselves — the objects that actually wire to `expo-notifications`,
 *    `expo-device` and `expo-constants` — by calling
 *    `createExpoPushRegistrationPort()` with NO arguments and reading
 *    the mocked modules' recorded calls.
 *
 * `expo-notifications`, `expo-device` and `expo-constants` are replaced
 * with controllable fixtures via `vi.mock`, hoisted to the top of this
 * file, so the real native packages are never loaded here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExpoNotificationPermissionStatus,
  ExpoNotificationRequestInput,
  ExpoNotificationResponse,
  ExpoNotificationsBindings,
  ExpoNotificationSubscription,
  ExpoPushEnvironment,
} from "./expo-push-registration-port.js";
import {
  PERMISSION_NOTIFICATION_CATEGORY,
  PERMISSION_NOTIFICATION_CHANNEL,
  createExpoPushRegistrationPort,
  mapPermissionStatus,
  toPermissionActionEvent,
} from "./expo-push-registration-port.js";
import type { PermissionNotificationContent } from "./push-registration-port.js";

const notificationsFixture = vi.hoisted(() => {
  const state = {
    permissionStatus: {
      status: "granted",
      canAskAgain: true,
    } as ExpoNotificationPermissionStatus,
    requestStatus: {
      status: "granted",
      canAskAgain: true,
    } as ExpoNotificationPermissionStatus,
    token: { data: "ExponentPushToken[fixture]" },
    tokenProjectIds: [] as string[],
    categoryIdentifier: null as string | null,
    categoryActions: null as readonly { identifier: string; buttonTitle: string }[] | null,
    channelId: null as string | null,
    channelConfig: null as Record<string, unknown> | null,
    scheduled: [] as ExpoNotificationRequestInput[],
    dismissed: [] as string[],
    tokenListener: null as ((token: { data: string }) => void) | null,
    responseListener: null as ((response: ExpoNotificationResponse) => void) | null,
    tokenSubscriptionsRemoved: 0,
  };
  return {
    state,
    getPermissionsAsync: async () => state.permissionStatus,
    requestPermissionsAsync: async () => state.requestStatus,
    getExpoPushTokenAsync: async (options: { projectId: string }) => {
      state.tokenProjectIds.push(options.projectId);
      return state.token;
    },
    addPushTokenListener: async (listener: (token: { data: string }) => void) => {
      state.tokenListener = listener;
      return {
        remove: () => {
          state.tokenSubscriptionsRemoved += 1;
        },
      };
    },
    setNotificationCategoryAsync: async (
      identifier: string,
      actions: readonly { identifier: string; buttonTitle: string }[],
    ) => {
      state.categoryIdentifier = identifier;
      state.categoryActions = actions;
      return { identifier, actions };
    },
    setNotificationChannelAsync: async (channelId: string, config: Record<string, unknown>) => {
      state.channelId = channelId;
      state.channelConfig = config;
      return null;
    },
    scheduleNotificationAsync: async (request: ExpoNotificationRequestInput) => {
      state.scheduled.push(request);
      return request.identifier;
    },
    dismissNotificationAsync: async (identifier: string) => {
      state.dismissed.push(identifier);
    },
    addNotificationResponseReceivedListener: async (
      listener: (response: ExpoNotificationResponse) => void,
    ) => {
      state.responseListener = listener;
      return { remove: () => {} };
    },
  };
});

vi.mock("expo-notifications", () => ({
  ...notificationsFixture,
  AndroidImportance: { HIGH: 6 },
  AndroidNotificationVisibility: { PRIVATE: 2 },
}));

vi.mock("expo-device", () => ({ isDevice: true }));

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { eas: { projectId: "project-from-constants" } } } },
}));

beforeEach(() => {
  const { state } = notificationsFixture;
  state.permissionStatus = { status: "granted", canAskAgain: true };
  state.requestStatus = { status: "granted", canAskAgain: true };
  state.token = { data: "ExponentPushToken[fixture]" };
  state.tokenProjectIds.length = 0;
  state.categoryIdentifier = null;
  state.categoryActions = null;
  state.channelId = null;
  state.channelConfig = null;
  state.scheduled.length = 0;
  state.dismissed.length = 0;
  state.tokenListener = null;
  state.responseListener = null;
  state.tokenSubscriptionsRemoved = 0;
});

interface Signal {
  readonly order: string[];
  readonly tokenProjectIds: string[];
  readonly scheduled: ExpoNotificationRequestInput[];
  readonly dismissed: string[];
  readonly channelIds: string[];
  categoryActions: readonly { identifier: string; buttonTitle: string }[] | null;
  emitToken?: (token: { data: string }) => void;
  emitResponse?: (response: ExpoNotificationResponse) => void;
}

function createFakeBindings(overrides: Partial<ExpoNotificationsBindings> = {}): {
  bindings: ExpoNotificationsBindings;
  signal: Signal;
} {
  const signal: Signal = {
    order: [],
    tokenProjectIds: [],
    scheduled: [],
    dismissed: [],
    categoryActions: null,
    channelIds: [],
  };
  const bindings: ExpoNotificationsBindings = {
    async getPermissionsAsync() {
      return { status: "granted", canAskAgain: true };
    },
    async requestPermissionsAsync() {
      signal.order.push("requestPermissions");
      return { status: "granted", canAskAgain: true };
    },
    async getExpoPushTokenAsync(options) {
      signal.tokenProjectIds.push(options.projectId);
      return { data: "ExponentPushToken[fake]" };
    },
    async addPushTokenListener() {
      return subscription();
    },
    async setNotificationCategoryAsync(_identifier, actions) {
      signal.order.push("category");
      signal.categoryActions = actions;
    },
    async setNotificationChannelAsync(channelId) {
      signal.order.push("channel");
      signal.channelIds.push(channelId);
    },
    async scheduleNotificationAsync(request) {
      signal.order.push("schedule");
      signal.scheduled.push(request);
    },
    async dismissNotificationAsync(identifier) {
      signal.order.push("dismiss");
      signal.dismissed.push(identifier);
    },
    async addNotificationResponseReceivedListener() {
      return subscription();
    },
    ...overrides,
  };
  return { bindings, signal };
}

function subscription(): ExpoNotificationSubscription {
  return { remove: () => {} };
}

function createFakeEnvironment(overrides: Partial<ExpoPushEnvironment> = {}): ExpoPushEnvironment {
  return {
    async isPhysicalDevice() {
      return true;
    },
    async getProjectId() {
      return "project-1";
    },
    ...overrides,
  };
}

const ACTIONABLE_CONTENT: PermissionNotificationContent = {
  requestId: "req-1",
  agentId: "agent-1",
  visibility: "private",
  publicTitle: "Pi needs your permission",
  privateTitle: "Bash needs permission",
  privateBody: "Run `rm -rf /tmp/x`",
  actions: [
    { id: "approve", label: "Approve" },
    { id: "deny", label: "Deny" },
  ],
};

const TAP_ONLY_CONTENT: PermissionNotificationContent = {
  ...ACTIONABLE_CONTENT,
  requestId: "req-2",
  actions: [],
};

describe("mapPermissionStatus", () => {
  it("maps each expo-notifications status, including Android's don't-ask-again as denied-permanently", () => {
    expect(mapPermissionStatus({ status: "granted", canAskAgain: true })).toBe("granted");
    expect(mapPermissionStatus({ status: "undetermined", canAskAgain: true })).toBe("undetermined");
    expect(mapPermissionStatus({ status: "denied", canAskAgain: true })).toBe("denied");
    expect(mapPermissionStatus({ status: "denied", canAskAgain: false })).toBe(
      "denied-permanently",
    );
  });
});

describe("createExpoPushRegistrationPort permissions", () => {
  it("reads permission without prompting and maps the denied-permanently case", async () => {
    const { bindings } = createFakeBindings({
      async getPermissionsAsync() {
        return { status: "denied", canAskAgain: false };
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await expect(port.getPermissionStatus()).resolves.toBe("denied-permanently");
  });

  it("prompts through requestPermissionsAsync, not getPermissionsAsync", async () => {
    const { bindings, signal } = createFakeBindings({
      async requestPermissionsAsync() {
        signal.order.push("requestPermissions");
        return { status: "denied", canAskAgain: true };
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await expect(port.requestPermission()).resolves.toBe("denied");
    expect(signal.order).toEqual(["requestPermissions"]);
  });

  it("reports unavailable when the native module rejects", async () => {
    const { bindings } = createFakeBindings({
      async getPermissionsAsync() {
        throw new Error("no native module");
      },
      async requestPermissionsAsync() {
        throw new Error("no native module");
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await expect(port.getPermissionStatus()).resolves.toBe("unavailable");
    await expect(port.requestPermission()).resolves.toBe("unavailable");
  });
});

describe("createExpoPushRegistrationPort token acquisition", () => {
  it("returns null without prompting when permission is not granted", async () => {
    const { bindings, signal } = createFakeBindings({
      async getPermissionsAsync() {
        return { status: "undetermined", canAskAgain: true };
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await expect(port.getToken()).resolves.toBeNull();
    expect(signal.tokenProjectIds).toEqual([]);
  });

  it("returns null on a simulator without asking for a token", async () => {
    const { bindings, signal } = createFakeBindings();
    const port = createExpoPushRegistrationPort(
      bindings,
      createFakeEnvironment({
        async isPhysicalDevice() {
          return false;
        },
      }),
    );

    await expect(port.getToken()).resolves.toBeNull();
    expect(signal.tokenProjectIds).toEqual([]);
  });

  it("returns null when no EAS project id is configured", async () => {
    const { bindings, signal } = createFakeBindings();
    const port = createExpoPushRegistrationPort(
      bindings,
      createFakeEnvironment({
        async getProjectId() {
          return null;
        },
      }),
    );

    await expect(port.getToken()).resolves.toBeNull();
    expect(signal.tokenProjectIds).toEqual([]);
  });

  it("fetches the Expo push token with the configured project id", async () => {
    const { bindings, signal } = createFakeBindings();
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await expect(port.getToken()).resolves.toBe("ExponentPushToken[fake]");
    expect(signal.tokenProjectIds).toEqual(["project-1"]);
  });

  it("returns null, never throws, when the token request fails", async () => {
    const { bindings } = createFakeBindings({
      async getExpoPushTokenAsync() {
        throw new Error("network down");
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await expect(port.getToken()).resolves.toBeNull();
  });
});

describe("createExpoPushRegistrationPort token refresh", () => {
  it("forwards a refreshed token and stops after unsubscribe", async () => {
    const { bindings, signal } = createFakeBindings({
      async addPushTokenListener(listener) {
        signal.emitToken = listener;
        return subscription();
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());
    const handler = vi.fn();

    const unsubscribe = port.onTokenRefresh(handler);
    await vi.waitFor(() => {
      expect(signal.emitToken).toBeDefined();
    });
    signal.emitToken?.({ data: "ExponentPushToken[refreshed]" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("ExponentPushToken[refreshed]");

    unsubscribe();
    signal.emitToken?.({ data: "ExponentPushToken[second]" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("returns a harmless unsubscribe when no native listener could attach", async () => {
    const { bindings } = createFakeBindings({
      async addPushTokenListener() {
        throw new Error("no native module");
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    const unsubscribe = port.onTokenRefresh(vi.fn());
    await expect(Promise.resolve().then(() => unsubscribe())).resolves.toBeUndefined();
  });
});

describe("createExpoPushRegistrationPort permission notifications", () => {
  it("posts an actionable notification on the private channel with the approve/deny category", async () => {
    const { bindings, signal } = createFakeBindings();
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await port.postPermissionNotification(ACTIONABLE_CONTENT);

    expect(signal.channelIds).toEqual([PERMISSION_NOTIFICATION_CHANNEL]);
    expect(signal.categoryActions).toEqual([
      { identifier: "approve", buttonTitle: "Approve" },
      { identifier: "deny", buttonTitle: "Deny" },
    ]);
    expect(signal.scheduled).toEqual([
      {
        identifier: "picompanion-permission-req-1",
        title: "Bash needs permission",
        body: "Run `rm -rf /tmp/x`",
        data: { requestId: "req-1", agentId: "agent-1" },
        categoryIdentifier: PERMISSION_NOTIFICATION_CATEGORY,
        channelId: PERMISSION_NOTIFICATION_CHANNEL,
      },
    ]);
    expect(signal.order).toEqual(["channel", "category", "dismiss", "schedule"]);
  });

  it("posts tap-only content without registering or referencing the action category", async () => {
    const { bindings, signal } = createFakeBindings();
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await port.postPermissionNotification(TAP_ONLY_CONTENT);

    expect(signal.categoryActions).toBeNull();
    expect(signal.scheduled[0]?.categoryIdentifier).toBeNull();
  });

  it("dismisses the derived notification id before scheduling a replacement", async () => {
    const { bindings, signal } = createFakeBindings();
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await port.postPermissionNotification(ACTIONABLE_CONTENT);
    await port.postPermissionNotification(ACTIONABLE_CONTENT);

    expect(signal.dismissed).toEqual([
      "picompanion-permission-req-1",
      "picompanion-permission-req-1",
    ]);
    const secondScheduleIndex = signal.order.lastIndexOf("schedule");
    expect(signal.order.slice(secondScheduleIndex - 1, secondScheduleIndex)).toEqual(["dismiss"]);
  });

  it("cancels the derived notification id and never throws when nothing is live", async () => {
    const { bindings, signal } = createFakeBindings({
      async dismissNotificationAsync(identifier) {
        signal.order.push("dismiss");
        signal.dismissed.push(identifier);
        throw new Error("nothing to dismiss");
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await expect(port.cancelPermissionNotification("req-9")).resolves.toBeUndefined();
    expect(signal.dismissed).toEqual(["picompanion-permission-req-9"]);
  });

  it("drops a post silently when the native module is unavailable", async () => {
    const { bindings } = createFakeBindings({
      async setNotificationChannelAsync() {
        throw new Error("no native module");
      },
      async setNotificationCategoryAsync() {
        throw new Error("no native module");
      },
      async scheduleNotificationAsync() {
        throw new Error("no native module");
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());

    await expect(port.postPermissionNotification(ACTIONABLE_CONTENT)).resolves.toBeUndefined();
  });
});

describe("toPermissionActionEvent", () => {
  function response(
    actionIdentifier: string,
    data: Record<string, unknown>,
  ): ExpoNotificationResponse {
    return {
      actionIdentifier,
      notification: { request: { content: { data } } },
    };
  }

  it("maps approve, deny and the default action to tap", () => {
    expect(toPermissionActionEvent(response("approve", { requestId: "r", agentId: "a" }))).toEqual({
      requestId: "r",
      agentId: "a",
      actionId: "approve",
    });
    expect(toPermissionActionEvent(response("deny", { requestId: "r", agentId: "a" }))).toEqual({
      requestId: "r",
      agentId: "a",
      actionId: "deny",
    });
    expect(
      toPermissionActionEvent(
        response("expo.modules.notifications.actions.DEFAULT", { requestId: "r", agentId: "a" }),
      ),
    ).toEqual({ requestId: "r", agentId: "a", actionId: "tap" });
  });

  it("ignores an unknown action identifier and a response with no opaque ids", () => {
    expect(
      toPermissionActionEvent(response("some-other-action", { requestId: "r", agentId: "a" })),
    ).toBeNull();
    expect(toPermissionActionEvent(response("approve", {}))).toBeNull();
    expect(toPermissionActionEvent(response("approve", { requestId: 7, agentId: "a" }))).toBeNull();
  });
});

describe("createExpoPushRegistrationPort action stream", () => {
  it("delivers mapped action events and stops after unsubscribe", async () => {
    const { bindings, signal } = createFakeBindings({
      async addNotificationResponseReceivedListener(listener) {
        signal.emitResponse = listener;
        return subscription();
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());
    const handler = vi.fn();

    const unsubscribe = port.onNotificationAction(handler);
    await vi.waitFor(() => expect(signal.emitResponse).toBeDefined());
    signal.emitResponse?.({
      actionIdentifier: "deny",
      notification: { request: { content: { data: { requestId: "r", agentId: "a" } } } },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ requestId: "r", agentId: "a", actionId: "deny" });

    unsubscribe();
    signal.emitResponse?.({
      actionIdentifier: "approve",
      notification: { request: { content: { data: { requestId: "r", agentId: "a" } } } },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("never delivers an event for a response it cannot map", async () => {
    const { bindings, signal } = createFakeBindings({
      async addNotificationResponseReceivedListener(listener) {
        signal.emitResponse = listener;
        return subscription();
      },
    });
    const port = createExpoPushRegistrationPort(bindings, createFakeEnvironment());
    const handler = vi.fn();

    port.onNotificationAction(handler);
    await vi.waitFor(() => expect(signal.emitResponse).toBeDefined());
    signal.emitResponse?.({
      actionIdentifier: "unknown",
      notification: { request: { content: { data: {} } } },
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("createExpoPushRegistrationPort DEFAULT_BINDINGS", () => {
  it("wires permission, token, category, channel and schedule calls to expo-notifications with the project id from expo-constants", async () => {
    const port = createExpoPushRegistrationPort();
    const { state } = notificationsFixture;

    await expect(port.getPermissionStatus()).resolves.toBe("granted");
    await expect(port.getToken()).resolves.toBe("ExponentPushToken[fixture]");
    await port.postPermissionNotification(ACTIONABLE_CONTENT);

    expect(state.tokenProjectIds).toEqual(["project-from-constants"]);
    expect(state.channelId).toBe(PERMISSION_NOTIFICATION_CHANNEL);
    expect(state.channelConfig?.["lockscreenVisibility"]).toBe(2);
    expect(state.categoryIdentifier).toBe(PERMISSION_NOTIFICATION_CATEGORY);
    expect(state.categoryActions).toEqual([
      { identifier: "approve", buttonTitle: "Approve" },
      { identifier: "deny", buttonTitle: "Deny" },
    ]);
    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0]?.identifier).toBe("picompanion-permission-req-1");
  });

  it("delivers a refreshed token through addPushTokenListener", async () => {
    const port = createExpoPushRegistrationPort();
    const { state } = notificationsFixture;
    const handler = vi.fn();

    port.onTokenRefresh(handler);
    await vi.waitFor(() => expect(state.tokenListener).not.toBeNull());
    state.tokenListener?.({ data: "ExponentPushToken[refreshed]" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("ExponentPushToken[refreshed]");
  });
});
