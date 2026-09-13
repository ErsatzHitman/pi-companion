import type {
  NotificationPayload,
  NotificationPermissionState,
  NotificationsPlatform,
} from "@picompanion/frontend-core";

import type {
  PermissionState,
  PushRegistrationPort,
} from "../features/notifications/push-registration-port.js";
import { createUnavailablePushRegistrationPort } from "../features/notifications/push-registration-port.js";

/**
 * Real Android `NotificationsPlatform` — T32P3, plan.md §7.3/§9.3.
 *
 * Implements `@picompanion/frontend-core`'s existing `NotificationsPlatform`
 * interface — no second interface is declared here. `apps/web`'s
 * counterpart backs the same interface with the browser `Notification`
 * API; this module is Android's, built the same way every other
 * `apps/android/src/platform/` adapter is (`file-picker.ts`,
 * `sharing.ts`, `native-network-reachability.ts`): against an injected
 * port shaped like the real native module, with zero `expo-notifications`
 * import, so it is fully provable in plain `vitest` against a scripted
 * fake (see `notifications-platform.test.ts`).
 *
 * ---------------------------------------------------------------------
 * The fold decision (T32P3's intellectually hard half)
 * ---------------------------------------------------------------------
 * `packages/frontend-core/src/platform/notifications.ts`'s
 * `NotificationPermissionState` (`"granted" | "denied" | "prompt" |
 * "unsupported"`) and `../features/composer/permission-recovery.ts`'s
 * `PermissionState` (`"undetermined" | "granted" | "denied" |
 * "denied-permanently" | "unavailable"`) are NOT folded into one union.
 * `PermissionState` stays where it is; `NotificationPermissionState`
 * stays where it is; this module maps between them at the boundary
 * (`mapPermissionState` below).
 *
 * Reasoning:
 *
 *  1. The two unions are not a naming variant of the same shape —
 *     `"prompt"`/`"undetermined"` and `"unsupported"`/`"unavailable"`
 *     are just spelling, but `PermissionState` has a FIFTH member,
 *     `"denied-permanently"`, that `NotificationPermissionState` has no
 *     way to express at all. That is not an oversight to patch by
 *     collapsing one union onto the other — it is Android's own "don't
 *     ask again" semantics, and it is exactly the state that must route
 *     a user to system Settings instead of re-prompting into a dead
 *     end (`describePermissionRecovery`'s doc comment: "re-prompting a
 *     `denied-permanently` user is a dead end on Android"). Folding
 *     `NotificationPermissionState` onto `PermissionState` — i.e.
 *     redefining the `frontend-core` union to gain a fifth member —
 *     would force every platform that consumes it, including web's
 *     `Notification.permission` (which only ever reports
 *     `"granted"`/`"denied"`/`"default"`, with **no OS-level concept of
 *     "permanently blocked, ask in Settings"**), to model a state it
 *     structurally cannot produce or distinguish. That breaks
 *     `frontend-core`'s whole contract of being platform-neutral: a
 *     type that only one platform can ever fully populate is not a
 *     shared vocabulary, it is this platform's vocabulary wearing a
 *     shared name.
 *  2. Folding the other direction — routing this platform's calls
 *     through `PermissionState` and dropping `NotificationPermissionState`
 *     entirely — is not this task's to do either: `NotificationsPlatform`
 *     is `frontend-core`'s existing, already-shipped interface contract
 *     (used by whatever `frontend-core` composer/notification code
 *     calls `requestPermission()`/`getPermissionState()` against), and
 *     this wave's only edit grant into that package is "the union folds
 *     — and then only that union" (T32P3's brief). Deleting
 *     `NotificationPermissionState` outright is a interface-shape
 *     change, not a union fold, and is out of scope.
 *  3. So the two unions serve two different questions at two different
 *     layers: `PermissionState` is "what does the OS actually say,
 *     including whether re-asking is even possible" (this app's
 *     internal, Android-flavoured concern); `NotificationPermissionState`
 *     is "what can `frontend-core`'s platform-neutral composer code
 *     assume every platform can report" (necessarily the coarser of the
 *     two). Mapping down at this exact seam — `mapPermissionState`
 *     below — is a lossy but *honest* narrowing: `"denied-permanently"`
 *     reports as `"denied"` through the `NotificationsPlatform`
 *     interface (a real, correct value — the user has in fact been
 *     denied), and the finer distinction needed to decide "offer
 *     Settings instead of re-prompt" is preserved right here via
 *     `getNativePermissionState` (below), a plain export alongside the
 *     interface implementation, not a second interface, for exactly the
 *     one caller (a future settings/permission screen — T32S12's
 *     construction point) that needs it.
 *
 * **What would falsify this decision:** a second platform this app ships
 * to (an iOS Capacitor/Expo target, say) that *also* has a genuine
 * "denied permanently, OS will not re-prompt" state distinct from a
 * plain, re-askable `"denied"`. If that ever happens, the honest fix is
 * to widen `NotificationPermissionState` itself in `frontend-core`
 * (adding a `"denied-permanently"` member every platform maps onto,
 * with platforms that lack the concept — web — simply never producing
 * it), not to import Android's locally-defined `PermissionState` into a
 * platform-neutral package. Today only one platform (this one) has that
 * state, so widening the shared union for a single consumer would be
 * speculative generality this repository's own standing lesson (see
 * `plan.md` and the merge-gate history for `permission-recovery.ts`)
 * argues against.
 *
 * ---------------------------------------------------------------------
 * The notification dependency is installed; this port's general half is
 * implemented below
 * ---------------------------------------------------------------------
 * `expo-notifications` and `expo-device` are in
 * `apps/android/package.json` since T391 (versions pinned by *this
 * app's own* `apps/android/node_modules/expo/bundledNativeModules.json`
 * against this app's installed `expo`), and the *push-registration*
 * half of that dependency now has a real production implementation:
 * `../features/notifications/expo-push-registration-port.ts`'s
 * `createExpoPushRegistrationPort`, which `app-shell/core.ts` and
 * `app/h/[serverId]/devices.tsx` use. This module's own
 * `AndroidNotificationsPort` adds the general-purpose
 * `showNotification`/`onNotificationResponse` half on top of the same
 * port, backed by `createExpoAndroidNotificationsPort` below:
 * `showNotification` with `expo-notifications`'s
 * `scheduleNotificationAsync`, `onNotificationResponse` with
 * `addNotificationResponseReceivedListener`, spreading the real
 * `createExpoPushRegistrationPort()` for `getPermissionStatus`/
 * `requestPermission` and the rest of the push half.
 * `createUnavailableAndroidNotificationsPlatform` below remains the
 * honestly-degraded fallback a caller with no native module uses — the
 * real port itself degrades per-method (silent drop / never-delivered
 * tap) when its dynamic `import("expo-notifications")` throws, so
 * "unsupported" only ever surfaces where the native module is
 * genuinely absent. **No permission dialog is shown or claimed shown
 * anywhere in this file or its tests** — every proof here is against a
 * scripted fake.
 *
 * ---------------------------------------------------------------------
 * Sensitive content (T32P3's "nothing about a notification's content
 * reaches a log or plain storage" criterion)
 * ---------------------------------------------------------------------
 * This module has no logging dependency and no storage dependency at
 * all — there is nothing here a notification's `title`/`body`/`data`
 * could be written to except `port.showNotification`, which hands it
 * straight to whatever real native call eventually backs it (the OS's
 * own notification tray, which is the point of calling `show()` at
 * all). `notifications-platform.test.ts`'s "content never reaches
 * console" case spies every console method across a `show()` call
 * carrying a deliberately sensitive payload and asserts none of them
 * were ever invoked.
 *
 * ---------------------------------------------------------------------
 * Construction — the seam T32S12 closed
 * ---------------------------------------------------------------------
 * `app-shell/core.ts`'s `AppCore.notifications` is this platform's one
 * production construction site (T32S12), built with
 * `createAndroidNotificationsPlatform(createExpoAndroidNotificationsPort(
 * createExpoPushRegistrationPort()))` — the general `showNotification`/
 * `onNotificationResponse` half below over the real push-registration
 * port from `../features/notifications/expo-push-registration-port.ts`.
 */

/**
 * Everything this module needs beyond
 * `../features/notifications/push-registration-port.js`'s existing
 * `PushRegistrationPort` — extending it, not declaring a competing
 * second port, per this task's brief. `PushRegistrationPort` already
 * supplies the permission read/request pair (`PermissionPort`) this
 * module maps through `mapPermissionState`; the two members below are
 * the only genuinely new native surface a general-purpose
 * `NotificationsPlatform.show`/`onResponse` needs that
 * `PushRegistrationPort`'s existing `postPermissionNotification`/
 * `onNotificationAction` (deliberately narrow to the permission-request
 * notification shape — `requestId`/`agentId`/public-private split) does
 * not cover.
 */
export interface AndroidNotificationsPort extends PushRegistrationPort {
  /** Shows one general-purpose notification. Mirrors `expo-notifications`' `scheduleNotificationAsync` shape closely enough that a real implementation is a thin wrapper — see this module's doc comment. */
  showNotification(payload: NotificationPayload): Promise<void>;
  /** Subscribes to a user interacting with a notification `showNotification` posted. Returns an unsubscribe function. Mirrors `expo-notifications`' `addNotificationResponseReceivedListener`. */
  onNotificationResponse(listener: (payload: NotificationPayload) => void): () => void;
}

/**
 * Total, exhaustive map from this app's native `PermissionState` to
 * `frontend-core`'s platform-neutral `NotificationPermissionState` —
 * see this module's doc comment ("The fold decision") for why this is
 * a mapping function and not a shared type. Every `PermissionState`
 * member lands in a named `NotificationPermissionState`; none is
 * silently dropped or thrown on (T32P3's "every refusal path lands in
 * a named state" criterion).
 */
export function mapPermissionState(state: PermissionState): NotificationPermissionState {
  switch (state) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "denied-permanently":
      // Lossy by design — see this module's doc comment. The finer
      // distinction survives via `getNativePermissionState` below.
      return "denied";
    case "undetermined":
      return "prompt";
    case "unavailable":
      return "unsupported";
  }
}

/**
 * The real `NotificationsPlatform` this task builds. `show()` reads the
 * current permission before ever calling `port.showNotification` and is
 * a silent no-op when it is anything other than `"granted"` — matching
 * this app's existing "unavailable/refused is a defined outcome, not a
 * thrown error" convention (`./file-picker.ts`'s
 * `createUnavailableFilePicker`, `../features/notifications/
 * push-registration-port.ts`'s `createUnavailablePushRegistrationPort`)
 * rather than surfacing an OS-level notification failure as an
 * application-level exception.
 */
export function createAndroidNotificationsPlatform(
  port: AndroidNotificationsPort,
): NotificationsPlatform {
  return {
    async requestPermission(): Promise<NotificationPermissionState> {
      return mapPermissionState(await port.requestPermission());
    },
    async getPermissionState(): Promise<NotificationPermissionState> {
      return mapPermissionState(await port.getPermissionStatus());
    },
    async show(payload: NotificationPayload): Promise<void> {
      const state = await port.getPermissionStatus();
      if (state !== "granted") {
        return;
      }
      await port.showNotification(payload);
    },
    onResponse(listener: (payload: NotificationPayload) => void): () => void {
      return port.onNotificationResponse(listener);
    },
  };
}

/**
 * The finer-grained native `PermissionState` behind a given
 * `AndroidNotificationsPort` — deliberately NOT part of the
 * `NotificationsPlatform` interface (that interface's contract is
 * platform-neutral and cannot express `"denied-permanently"`; see this
 * module's doc comment). This is the seam a future permission-recovery
 * screen calls instead of `getPermissionState()` when it needs to
 * decide between "offer to re-request" and "send the user to system
 * Settings" — pass its result straight to
 * `../features/composer/permission-recovery.ts`'s
 * `describePermissionRecovery("notifications", state)`, which already
 * has a `"notifications"` `PermissionKind` entry (T60D) for exactly
 * this call.
 */
export function getNativePermissionState(port: AndroidNotificationsPort): Promise<PermissionState> {
  return port.getPermissionStatus();
}

/** The Android channel every general notification is posted on — created lazily, mirroring `../features/notifications/expo-push-registration-port.ts`'s permission channel. */
export const GENERAL_NOTIFICATION_CHANNEL = "picompanion-general";

/**
 * One user interaction with a general notification, narrowed to the fields this port reads — no static `expo-notifications` import, so a test supplies a plain object.
 */
export interface ExpoLocalNotificationResponse {
  notification: {
    request: {
      identifier: string;
      content: {
        title?: unknown;
        body?: unknown;
        data?: unknown;
      };
    };
  };
}

/** The exact request shape this port schedules on the general channel. */
export interface ExpoLocalNotificationRequest {
  identifier: string;
  title: string;
  body?: string;
  data: Record<string, string>;
  channelId: string;
}

/** `expo-modules-core`'s `EventSubscription`, narrowed to what this port calls. */
export interface ExpoLocalNotificationSubscription {
  remove(): void;
}

/**
 * Everything the general half needs from `expo-notifications`, injectable so the new test proves this adapter's logic against plain fakes with no native module present — the same shape `../features/notifications/expo-push-registration-port.ts`'s `ExpoNotificationsBindings` uses.
 */
export interface ExpoLocalNotificationsBindings {
  setNotificationChannelAsync(channelId: string): Promise<void>;
  scheduleNotificationAsync(request: ExpoLocalNotificationRequest): Promise<void>;
  addNotificationResponseReceivedListener(
    listener: (response: ExpoLocalNotificationResponse) => void,
  ): Promise<ExpoLocalNotificationSubscription>;
}

const DEFAULT_LOCAL_BINDINGS: ExpoLocalNotificationsBindings = {
  async setNotificationChannelAsync(channelId) {
    const Notifications = await import("expo-notifications");
    await Notifications.setNotificationChannelAsync(channelId, {
      name: "General",
      importance: Notifications.AndroidImportance.HIGH,
      // Same posture as the permission channel: private content stays
      // off a secure lock screen; the tray still shows it unlocked.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  },
  async scheduleNotificationAsync(request) {
    const Notifications = await import("expo-notifications");
    await Notifications.scheduleNotificationAsync({
      identifier: request.identifier,
      content: {
        title: request.title,
        ...(request.body === undefined ? {} : { body: request.body }),
        data: request.data,
      },
      // A channel-aware trigger with no schedule fields delivers
      // immediately, on the named channel.
      trigger: { channelId: request.channelId },
    });
  },
  async addNotificationResponseReceivedListener(listener) {
    const Notifications = await import("expo-notifications");
    return Notifications.addNotificationResponseReceivedListener(listener);
  },
};

/**
 * Maps one `expo-notifications` tap response onto the `NotificationPayload` the `onResponse` subscriber receives — the scheduled `identifier` round-trips as `id`, title/body/data come from the notification's own content. Non-string data values are dropped (that map only carries strings); a missing title falls back to `""` since the payload requires one.
 */
export function toLocalNotificationPayload(
  response: ExpoLocalNotificationResponse,
): NotificationPayload {
  const request = response.notification.request;
  const content = request.content;
  const title = typeof content.title === "string" ? content.title : "";
  const body = typeof content.body === "string" ? content.body : undefined;
  let data: Record<string, string> | undefined;
  if (content.data !== null && typeof content.data === "object" && !Array.isArray(content.data)) {
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(content.data as Record<string, unknown>)) {
      if (typeof value === "string") {
        entries[key] = value;
      }
    }
    if (Object.keys(entries).length > 0) {
      data = entries;
    }
  }
  return {
    id: request.identifier,
    title,
    ...(body === undefined ? {} : { body }),
    ...(data === undefined ? {} : { data }),
  };
}

/**
 * This build's real `AndroidNotificationsPort` — spreads the given push port (production: `createExpoPushRegistrationPort()`) for the permission/registration half and backs the general `showNotification`/`onNotificationResponse` half with `expo-notifications`' `scheduleNotificationAsync` / `addNotificationResponseReceivedListener` through injectable `localBindings`. A genuinely absent native module surfaces as the same honest degraded behaviour the unavailable port had — `showNotification` drops silently, tap-responses are simply never delivered — never as a throw.
 */
export function createExpoAndroidNotificationsPort(
  pushPort: PushRegistrationPort,
  localBindings: ExpoLocalNotificationsBindings = DEFAULT_LOCAL_BINDINGS,
): AndroidNotificationsPort {
  const responseHandlers = new Set<(payload: NotificationPayload) => void>();

  let channelPromise: Promise<void> | null = null;
  function ensureGeneralChannel(): Promise<void> {
    channelPromise ??= localBindings
      .setNotificationChannelAsync(GENERAL_NOTIFICATION_CHANNEL)
      .catch(() => undefined);
    return channelPromise;
  }

  let listenerPromise: Promise<void> | null = null;
  function ensureResponseListener(): Promise<void> {
    listenerPromise ??= (async () => {
      try {
        await localBindings.addNotificationResponseReceivedListener((response) => {
          let payload: NotificationPayload;
          try {
            payload = toLocalNotificationPayload(response);
          } catch {
            return;
          }
          for (const handler of Array.from(responseHandlers)) {
            handler(payload);
          }
        });
      } catch {
        // Native module unavailable: the subscription is simply never
        // attached, so no tap is ever delivered — the same observable
        // behaviour the unavailable port had.
      }
    })();
    return listenerPromise;
  }

  return {
    ...pushPort,
    async showNotification(payload: NotificationPayload): Promise<void> {
      try {
        await ensureGeneralChannel();
        await localBindings.scheduleNotificationAsync({
          identifier: payload.id,
          title: payload.title,
          ...(payload.body === undefined ? {} : { body: payload.body }),
          data: payload.data ?? {},
          channelId: GENERAL_NOTIFICATION_CHANNEL,
        });
      } catch {
        // Native module unavailable: drop silently, matching the
        // unavailable port's "defined, awaitable no-op" convention.
      }
    },
    onNotificationResponse(listener: (payload: NotificationPayload) => void): () => void {
      responseHandlers.add(listener);
      void ensureResponseListener();
      return () => {
        responseHandlers.delete(listener);
      };
    },
  };
}

/**
 * This build's production `AndroidNotificationsPort` — composes
 * `../features/notifications/push-registration-port.js`'s
 * `createUnavailablePushRegistrationPort` (this module's general
 * `showNotification`/`onNotificationResponse` half has no real
 * implementation yet — see this module's header) with no-op
 * `showNotification`/`onNotificationResponse`, mirroring that factory's
 * own "silently drop rather than throw" convention exactly.
 */
export function createUnavailableAndroidNotificationsPort(): AndroidNotificationsPort {
  return {
    ...createUnavailablePushRegistrationPort(),
    async showNotification(): Promise<void> {
      // No native notification module exists in this build — see this
      // module's doc comment. Dropping rather than throwing matches
      // `show()`'s own "refused is a defined outcome" convention.
    },
    onNotificationResponse(): () => void {
      return () => {};
    },
  };
}

/**
 * The production `NotificationsPlatform` this build constructs today —
 * see this module's header for why the general notification half is
 * still unavailable even though the push-registration dependency is
 * installed.
 */
export function createUnavailableAndroidNotificationsPlatform(): NotificationsPlatform {
  return createAndroidNotificationsPlatform(createUnavailableAndroidNotificationsPort());
}
