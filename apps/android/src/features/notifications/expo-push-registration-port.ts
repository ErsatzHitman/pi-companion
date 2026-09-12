/**
 * The real, `expo-notifications`-backed `PushRegistrationPort` (T391,
 * plan.md §9.3).
 *
 * Deliberately a SEPARATE file from `./push-registration-port.ts`, which
 * declares the port contract and `createUnavailablePushRegistrationPort`
 * and stays completely `react-native`-free. `expo-notifications`' own
 * JS entry imports `expo-modules-core`/`react-native`, so a static
 * import here would drag react-native into every `vitest` file that
 * transitively imports it — including `app-shell/core.ts`'s many tests.
 * Two consequences shape this file, the same shape
 * `../../platform/offline/expo-sqlite-driver-factory.ts` already uses:
 *
 *  - The bindings are injectable (`ExpoNotificationsBindings`,
 *    `ExpoPushEnvironment`), so `./expo-push-registration-port.test.ts`
 *    proves this adapter's own logic against plain fakes with no native
 *    module present.
 *  - `DEFAULT_BINDINGS`/`DEFAULT_ENVIRONMENT` reach `expo-notifications`,
 *    `expo-device` and `expo-constants` only through dynamic `import()`
 *    *inside* the calls that need them, never at this module's top
 *    level. A genuinely unavailable native module therefore surfaces as
 *    the same honest `"unavailable"` permission state / `null` token /
 *    silent post the unavailable port already returned — not as a
 *    module-evaluation crash.
 *
 * ## Permission mapping, including Android's "don't ask again"
 *
 * `expo-notifications`' `NotificationPermissionsStatus` carries both the
 * tri-state `status` and `canAskAgain`. `mapPermissionStatus` below maps
 * `granted` -> `"granted"`, `undetermined` -> `"undetermined"`, and
 * `denied` -> `"denied-permanently"` exactly when `canAskAgain` is
 * `false` (Android's "don't ask again", surfaced as a distinct state
 * `../composer/permission-recovery.ts` can route to system Settings)
 * else `"denied"`.
 *
 * ## Token acquisition
 *
 * `getToken()` only ever minted a token when the permission is
 * `"granted"`, `expo-device`'s `isDevice` is `true` (a simulator cannot
 * receive push), and `expo-constants` exposes an EAS project id
 * (`Constants.expoConfig?.extra?.eas?.projectId`, falling back to
 * `Constants.easConfig?.projectId`). Any missing piece is the port's
 * documented `null` outcome, never an error.
 *
 * ## Permission notifications (T36B): category, actions, lock screen
 *
 * `postPermissionNotification` registers one real notification category
 * (`setNotificationCategoryAsync`) carrying the `approve`/`deny` action
 * identifiers this port's `PermissionNotificationActionId` already
 * names, then schedules an immediate notification whose
 * `categoryIdentifier` references it. `onNotificationAction` maps
 * `expo-notifications`' `NotificationResponse.actionIdentifier` back to
 * `PermissionNotificationActionEvent` (`"approve"`/`"deny"`, or its
 * `DEFAULT_ACTION_IDENTIFIER` to `"tap"`), reading `requestId`/`agentId`
 * only from the notification's own `data` — never from any OS event
 * field beyond those two opaque ids.
 *
 * **Lock-screen privacy — realized with the Android channel, not a
 * public version.** `PermissionNotificationContent` builds a two-tier
 * `publicTitle` vs. `privateTitle`/`privateBody` pair precisely because
 * a locked device must not show the request's real content. `expo-
 * notifications`' JS API exposes no Android public-version
 * (`setPublicVersion`) equivalent, so this port realizes the same
 * guarantee a different way: the notification is posted on a channel
 * created with `AndroidNotificationVisibility.PRIVATE`, and it carries
 * the *private* title/body. Android conceals that content on a secure
 * lock screen and shows it once the device is unlocked — exactly the
 * "shown only once unlocked or with no lock-screen redaction" behaviour
 * `./permission-notification-model.ts` describes. `publicTitle` remains
 * the model's guaranteed-safe fallback text; this port never needs it
 * because it never puts the private text where a secure lock screen
 * would render it.
 *
 * ## One derived notification id per request
 *
 * `postPermissionNotification` uses a deterministic identifier derived
 * from `content.requestId`, dismissing any previous notification with
 * that id before scheduling the new one, so a re-post for the same
 * request can never leave two visible notifications — the port's
 * idempotence contract. `cancelPermissionNotification` derives the same
 * id, so it needs no per-instance bookkeeping and a caller never has to
 * track whether a cancel is "expected".
 *
 * ## T36A/T36B are one port, not two
 *
 * Both the registration half (`getPermissionStatus`/`requestPermission`/
 * `getToken`/`onTokenRefresh`) and the permission-notification half live
 * on this one implementation because `expo-notifications` is the single
 * native module backing both — see `./push-registration-port.ts`'s own
 * doc comment.
 */
import type { PermissionState } from "../composer/permission-recovery.js";

import type {
  PermissionNotificationActionEvent,
  PermissionNotificationContent,
  PushRegistrationPort,
} from "./push-registration-port.js";

/** The one notification category this port registers. Deliberately contains no `:`/`-`, which `expo-notifications` documents as unsafe in a category identifier. */
export const PERMISSION_NOTIFICATION_CATEGORY = "picompanion_permission_request";

/** The Android channel every permission notification is posted on — see this module's header for the `PRIVATE` lock-screen visibility it is created with. */
export const PERMISSION_NOTIFICATION_CHANNEL = "picompanion-permission-requests";

const APPROVE_ACTION_IDENTIFIER = "approve";
const DENY_ACTION_IDENTIFIER = "deny";
/** `expo-notifications`' own `DEFAULT_ACTION_IDENTIFIER` — copied as a literal so this module never statically imports the package (see the header). */
const TAP_ACTION_IDENTIFIER = "expo.modules.notifications.actions.DEFAULT";

/**
 * The subset of `expo-notifications`' `NotificationPermissionsStatus`
 * this port reads — narrowed the same way
 * `../voice/expo-audio-voice-capture-port.ts` narrows its own permission
 * response, so a test can supply a plain object.
 */
export interface ExpoNotificationPermissionStatus {
  /** `expo-notifications`' tri-state notification permission, read as a plain string so a fake need not reproduce its enum type. */
  status: string;
  /** `false` once Android will no longer re-prompt — the "don't ask again" flag. */
  canAskAgain: boolean;
}

/** One real notification action button, as `setNotificationCategoryAsync` takes it. */
export interface ExpoNotificationAction {
  identifier: string;
  buttonTitle: string;
}

/** One user interaction with a posted notification, narrowed to the fields this port reads. */
export interface ExpoNotificationResponse {
  actionIdentifier: string;
  notification: {
    request: {
      content: {
        data: Record<string, unknown>;
      };
    };
  };
}

/** The exact request shape this port schedules — see the header for the fixed `PRIVATE` channel and category. */
export interface ExpoNotificationRequestInput {
  identifier: string;
  title: string;
  body: string;
  data: { requestId: string; agentId: string };
  categoryIdentifier: string | null;
  channelId: string;
}

/** `expo-modules-core`'s `EventSubscription`, narrowed to what this port calls. */
export interface ExpoNotificationSubscription {
  remove(): void;
}

/**
 * Everything this port needs from `expo-notifications`, injectable so
 * `./expo-push-registration-port.test.ts` never loads the real native
 * module. Every method returns a promise — including the two listener
 * registrations — because this port reaches the package through a
 * dynamic `import()` (see the header); a caller wanting a synchronous
 * unsubscribe gets one from `PushRegistrationPort`, not from here.
 */
export interface ExpoNotificationsBindings {
  getPermissionsAsync(): Promise<ExpoNotificationPermissionStatus>;
  requestPermissionsAsync(): Promise<ExpoNotificationPermissionStatus>;
  getExpoPushTokenAsync(options: { projectId: string }): Promise<{ data: string }>;
  addPushTokenListener(
    listener: (token: { data: string }) => void,
  ): Promise<ExpoNotificationSubscription>;
  setNotificationCategoryAsync(
    identifier: string,
    actions: readonly ExpoNotificationAction[],
  ): Promise<void>;
  setNotificationChannelAsync(channelId: string): Promise<void>;
  scheduleNotificationAsync(request: ExpoNotificationRequestInput): Promise<void>;
  dismissNotificationAsync(identifier: string): Promise<void>;
  addNotificationResponseReceivedListener(
    listener: (response: ExpoNotificationResponse) => void,
  ): Promise<ExpoNotificationSubscription>;
}

/**
 * The two non-`expo-notifications` facts this port needs: whether the
 * app is on a real device (`expo-device`'s `isDevice`) and the EAS
 * project id (`expo-constants`). Also dynamic-imported — see the header.
 */
export interface ExpoPushEnvironment {
  isPhysicalDevice(): Promise<boolean>;
  getProjectId(): Promise<string | null>;
}

const DEFAULT_BINDINGS: ExpoNotificationsBindings = {
  async getPermissionsAsync() {
    const Notifications = await import("expo-notifications");
    return Notifications.getPermissionsAsync();
  },
  async requestPermissionsAsync() {
    const Notifications = await import("expo-notifications");
    return Notifications.requestPermissionsAsync();
  },
  async getExpoPushTokenAsync(options) {
    const Notifications = await import("expo-notifications");
    return Notifications.getExpoPushTokenAsync(options);
  },
  async addPushTokenListener(listener) {
    const Notifications = await import("expo-notifications");
    return Notifications.addPushTokenListener(listener);
  },
  async setNotificationCategoryAsync(identifier, actions) {
    const Notifications = await import("expo-notifications");
    await Notifications.setNotificationCategoryAsync(
      identifier,
      actions.map((action) => ({
        identifier: action.identifier,
        buttonTitle: action.buttonTitle,
      })),
    );
  },
  async setNotificationChannelAsync(channelId) {
    const Notifications = await import("expo-notifications");
    await Notifications.setNotificationChannelAsync(channelId, {
      name: "Permission requests",
      importance: Notifications.AndroidImportance.HIGH,
      // See this module's header: this is what keeps the private
      // title/body off a secure lock screen. No public version is set,
      // so a secure lock screen shows only the app, not the request.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  },
  async scheduleNotificationAsync(request) {
    const Notifications = await import("expo-notifications");
    await Notifications.scheduleNotificationAsync({
      identifier: request.identifier,
      content: {
        title: request.title,
        body: request.body,
        data: request.data,
        ...(request.categoryIdentifier === null
          ? {}
          : { categoryIdentifier: request.categoryIdentifier }),
      },
      // A channel-aware trigger with no schedule fields delivers
      // immediately, on the named channel — see the header.
      trigger: { channelId: request.channelId },
    });
  },
  async dismissNotificationAsync(identifier) {
    const Notifications = await import("expo-notifications");
    await Notifications.dismissNotificationAsync(identifier);
  },
  async addNotificationResponseReceivedListener(listener) {
    const Notifications = await import("expo-notifications");
    return Notifications.addNotificationResponseReceivedListener(listener);
  },
};

const DEFAULT_ENVIRONMENT: ExpoPushEnvironment = {
  async isPhysicalDevice() {
    const Device = await import("expo-device");
    return Device.isDevice;
  },
  async getProjectId() {
    const Constants = (await import("expo-constants")).default;
    const projectId =
      Constants?.expoConfig?.extra?.["eas"]?.["projectId"] ?? Constants?.easConfig?.projectId;
    return typeof projectId === "string" && projectId.length > 0 ? projectId : null;
  },
};

/** Maps `expo-notifications`' permission status onto this app's five-state `PermissionState` — see this module's header for the "don't ask again" case. */
export function mapPermissionStatus(status: ExpoNotificationPermissionStatus): PermissionState {
  if (status.status === "granted") {
    return "granted";
  }
  if (status.status === "denied") {
    return status.canAskAgain ? "denied" : "denied-permanently";
  }
  if (status.status === "undetermined") {
    return "undetermined";
  }
  return "unavailable";
}

/** The deterministic notification id for one `requestId` — see this module's header. */
function notificationIdentifierFor(requestId: string): string {
  return `picompanion-permission-${requestId}`;
}

/**
 * This build's real `PushRegistrationPort` (T391). See this module's
 * header for the permission mapping, the token-acquisition conditions,
 * the notification category/action wiring, and the lock-screen privacy
 * realized through the Android channel.
 */
export function createExpoPushRegistrationPort(
  bindings: ExpoNotificationsBindings = DEFAULT_BINDINGS,
  environment: ExpoPushEnvironment = DEFAULT_ENVIRONMENT,
): PushRegistrationPort {
  /** Handler sets are local; the native listener attached on first subscribe dispatches to whatever is in the set at fire time. */
  const tokenHandlers = new Set<(token: string) => void>();
  const actionHandlers = new Set<(event: PermissionNotificationActionEvent) => void>();

  /** One-shot native setup (category + channel), cached, and a failure is not fatal — posting then degrades to a tap-only notification on the default channel. */
  let categoryPromise: Promise<void> | null = null;
  function ensurePermissionCategory(): Promise<void> {
    categoryPromise ??= bindings
      .setNotificationCategoryAsync(PERMISSION_NOTIFICATION_CATEGORY, [
        { identifier: APPROVE_ACTION_IDENTIFIER, buttonTitle: "Approve" },
        { identifier: DENY_ACTION_IDENTIFIER, buttonTitle: "Deny" },
      ])
      .catch(() => undefined);
    return categoryPromise;
  }

  let channelPromise: Promise<void> | null = null;
  function ensurePermissionChannel(): Promise<void> {
    channelPromise ??= bindings
      .setNotificationChannelAsync(PERMISSION_NOTIFICATION_CHANNEL)
      .catch(() => undefined);
    return channelPromise;
  }

  let tokenListenerPromise: Promise<void> | null = null;
  function ensureTokenListener(): Promise<void> {
    tokenListenerPromise ??= (async () => {
      try {
        await bindings.addPushTokenListener((token) => {
          for (const handler of Array.from(tokenHandlers)) {
            handler(token.data);
          }
        });
      } catch {
        // Native module unavailable: the subscription is simply never
        // attached, so no refresh is ever delivered — the same
        // observable behaviour the unavailable port had.
      }
    })();
    return tokenListenerPromise;
  }

  let actionListenerPromise: Promise<void> | null = null;
  function ensureActionListener(): Promise<void> {
    actionListenerPromise ??= (async () => {
      try {
        await bindings.addNotificationResponseReceivedListener((response) => {
          const event = toPermissionActionEvent(response);
          if (event === null) {
            return;
          }
          for (const handler of Array.from(actionHandlers)) {
            handler(event);
          }
        });
      } catch {
        // Native module unavailable — see `ensureTokenListener` above.
      }
    })();
    return actionListenerPromise;
  }

  return {
    async getPermissionStatus(): Promise<PermissionState> {
      try {
        return mapPermissionStatus(await bindings.getPermissionsAsync());
      } catch {
        return "unavailable";
      }
    },
    async requestPermission(): Promise<PermissionState> {
      try {
        return mapPermissionStatus(await bindings.requestPermissionsAsync());
      } catch {
        return "unavailable";
      }
    },
    async getToken(): Promise<string | null> {
      try {
        if (mapPermissionStatus(await bindings.getPermissionsAsync()) !== "granted") {
          return null;
        }
        if (!(await environment.isPhysicalDevice())) {
          return null;
        }
        const projectId = await environment.getProjectId();
        if (projectId === null) {
          return null;
        }
        const token = await bindings.getExpoPushTokenAsync({ projectId });
        return token.data;
      } catch {
        return null;
      }
    },
    onTokenRefresh(handler: (token: string) => void): () => void {
      tokenHandlers.add(handler);
      void ensureTokenListener();
      return () => {
        tokenHandlers.delete(handler);
      };
    },
    async postPermissionNotification(content: PermissionNotificationContent): Promise<void> {
      try {
        await ensurePermissionChannel();
        if (content.actions.length > 0) {
          await ensurePermissionCategory();
        }
        const identifier = notificationIdentifierFor(content.requestId);
        // Replace, never duplicate — see this module's header.
        await bindings.dismissNotificationAsync(identifier).catch(() => undefined);
        await bindings.scheduleNotificationAsync({
          identifier,
          title: content.privateTitle,
          body: content.privateBody,
          data: { requestId: content.requestId, agentId: content.agentId },
          categoryIdentifier: content.actions.length > 0 ? PERMISSION_NOTIFICATION_CATEGORY : null,
          channelId: PERMISSION_NOTIFICATION_CHANNEL,
        });
      } catch {
        // Native module unavailable: drop silently, matching the
        // unavailable port's "defined, awaitable no-op" convention.
      }
    },
    async cancelPermissionNotification(requestId: string): Promise<void> {
      try {
        await bindings.dismissNotificationAsync(notificationIdentifierFor(requestId));
      } catch {
        // Never a throw when nothing is live — see the port's contract.
      }
    },
    onNotificationAction(handler: (event: PermissionNotificationActionEvent) => void): () => void {
      actionHandlers.add(handler);
      void ensureActionListener();
      return () => {
        actionHandlers.delete(handler);
      };
    },
  };
}

/**
 * Maps one `expo-notifications` response onto this port's action event,
 * or `null` when the response carries no opaque ids or an action
 * identifier this port never registered (a malformed or replayed OS
 * event) — the `null` is never turned into a default action.
 */
export function toPermissionActionEvent(
  response: ExpoNotificationResponse,
): PermissionNotificationActionEvent | null {
  const data = response.notification.request.content.data;
  const requestId = data["requestId"];
  const agentId = data["agentId"];
  if (typeof requestId !== "string" || typeof agentId !== "string") {
    return null;
  }
  if (response.actionIdentifier === TAP_ACTION_IDENTIFIER) {
    return { requestId, agentId, actionId: "tap" };
  }
  if (response.actionIdentifier === APPROVE_ACTION_IDENTIFIER) {
    return { requestId, agentId, actionId: "approve" };
  }
  if (response.actionIdentifier === DENY_ACTION_IDENTIFIER) {
    return { requestId, agentId, actionId: "deny" };
  }
  return null;
}
