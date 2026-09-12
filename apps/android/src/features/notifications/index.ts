/**
 * `features/notifications` barrel (T36A/T36B, plan.md §9.3).
 *
 * Push registration, permission notifications with safe Approve/Deny
 * actions, and a re-exported permission-recovery port — all RN-free
 * `-model.ts`/`-port.ts` modules (no screen here yet — this task's
 * brief is explicit that this directory should stay "a model that
 * takes its dependencies as data, not a screen with the logic
 * inlined"). Mounted since T32S13 (P5-W19): `app-shell/core.ts`
 * imports this barrel to build `AppCore.pushRegistration` and
 * `AppCore.startPushRegistration`, which `app/core-context.tsx`
 * bootstraps once per `AppCoreProvider`. The registration attempt runs
 * against `createExpoPushRegistrationPort()` since T391 —
 * `expo-notifications`/`expo-device` are installed — so it reads a real
 * OS notification permission and mints a real Expo push token when the
 * native module and an EAS project id are present; on a build without
 * the native module it reports "unavailable" rather than producing a
 * token.
 *
 * Notification-permission *copy* is no longer this barrel's concern
 * (T60F, P5-W17): call `describePermissionRecovery("notifications",
 * state)` from `../composer/permission-recovery.ts` directly.
 */
export {
  attachTokenRefresh,
  createPushRegistrationController,
  registerForPush,
} from "./push-registration-model";
export type {
  PushRegistrationController,
  PushRegistrationControllerDeps,
  PushRegistrationOutcome,
  PushTokenRefreshOutcome,
  PushTokenRegistrar,
} from "./push-registration-model";

export { createUnavailablePushRegistrationPort } from "./push-registration-port";
export { createExpoPushRegistrationPort } from "./expo-push-registration-port";
export type {
  PermissionNotificationAction,
  PermissionNotificationActionEvent,
  PermissionNotificationActionId,
  PermissionNotificationContent,
  PushRegistrationPort,
} from "./push-registration-port";

export {
  buildPermissionNotificationContent,
  createPermissionNotificationController,
} from "./permission-notification-model";
export type {
  PermissionNotificationController,
  PermissionNotificationControllerDeps,
  PermissionNotificationOutcome,
} from "./permission-notification-model";

export { resolvePermission } from "./notification-permission-recovery";
export type {
  NotificationPermissionPort,
  PermissionPort,
  PermissionState,
} from "./notification-permission-recovery";
