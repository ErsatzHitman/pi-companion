/**
 * Push-registration port (T36A, plan.md §9.3).
 *
 * A minimal, RN-free seam between `push-registration-model.ts`'s pure
 * registration/refresh logic and whatever native module actually asks
 * the OS for notification permission and a push token. Mirrors the
 * shape of every other permission-gated port in this app —
 * `../voice/voice-capture-port.ts`'s `VoiceCapturePort`,
 * `../connect/qr-scanner-port.ts`'s `CameraScannerPort` — by extending
 * `../composer/permission-recovery.js`'s `PermissionPort` rather than
 * declaring a fourth `getPermissionStatus`/`requestPermission` pair.
 *
 * **No push-notification dependency is installed in this workspace.**
 * `apps/android/package.json` carries neither `expo-notifications` nor
 * `expo-device` today, and this task may not run `npm install`.
 * `createUnavailablePushRegistrationPort` below is therefore this
 * module's only production implementation — the same shape
 * `../voice/voice-capture-port.ts`'s `createUnavailableVoiceCapturePort`
 * has (this once cited `../composer/mic-permission-port.ts`, deleted by
 * T94). CORRECTED at the P9-O merge gate: that function was cited here
 * as the PRECEDENT for "only production implementation", and T276 ended
 * that — `Composer.tsx` now defaults `voiceCapture` to a real
 * `createExpoAudioVoiceCapturePort()`, so voice has a production
 * implementation and push does not. The two stubs are still identically
 * shaped; it is the precedent, not the shape, that no longer holds. A push token
 * cannot be obtained without a real device and a real Expo/EAS project
 * id in any case, so nothing here claims to fetch one.
 *
 * To wire a real push module once available (version pinned exactly
 * per *this app's own* installed `expo` — read from
 * `apps/android/node_modules/expo/bundledNativeModules.json`, not the
 * differently-versioned `expo` hoisted into the repo root from other
 * worktrees' installs, exactly as `../voice/voice-capture-port.ts`
 * and `../composer/attachment-source-port.ts` both note):
 *
 *   npm install --workspace=@picompanion/android expo-notifications@~0.32.17 expo-device@~8.0.10
 *
 * — then add a second implementation of `PushRegistrationPort` backed
 * by `expo-notifications`'s `getPermissionsAsync`/
 * `requestPermissionsAsync` (mapping its `PermissionStatus`/
 * `canAskAgain` onto `PermissionState`, exactly as
 * `../voice/voice-capture-port.ts`'s note describes for
 * `expo-audio`), `getExpoPushTokenAsync({ projectId })` for `getToken`
 * (the project id read from `expo-constants`, as
 * `D:\paseo\packages\app\src\hooks\use-push-token-registration.ts`'s
 * `getExpoProjectId` illustrates — read for behaviour only, never
 * copied: that file is Paseo's old frontend and may never enter this
 * repository), and `addPushTokenListener` for `onTokenRefresh`.
 *
 * **T36B extension (plan.md §9.3 "Permission notifications provide
 * Approve and Deny actions when safe"):** `postPermissionNotification`/
 * `cancelPermissionNotification`/`onNotificationAction` below are added
 * to *this* port, not a second one — the OS module that would back them
 * (`expo-notifications`'s `scheduleNotificationAsync` with a
 * `categoryIdentifier`/`setNotificationCategoryAsync` action set, and
 * its own `addNotificationResponseReceivedListener`) is the exact same
 * uninstalled dependency `getToken`/`onTokenRefresh` above already
 * describe, so a real implementation lives beside them, not in a
 * parallel port. See `permission-notification-model.ts` for the RN-free
 * logic that calls these three methods and for why the notification
 * content is split into a `publicTitle` vs. `privateTitle`/`privateBody`
 * pair.
 */
import type { PermissionPort, PermissionState } from "../composer/permission-recovery.js";

export type { PermissionState } from "../composer/permission-recovery.js";

/** The only two decisions a permission-notification action can carry — never a free-form string, so a handler can exhaustively switch on it. */
export type PermissionNotificationActionId = "approve" | "deny";

/**
 * One notification action button. `label` is the sole on-screen and
 * accessible text for the button — deliberately not distinguished from
 * its sibling by position or colour alone, so it must carry its own
 * verb (`permission-notification-model.test.ts`'s "labels carry their
 * own verb" case asserts this over every content this module builds).
 */
export interface PermissionNotificationAction {
  readonly id: PermissionNotificationActionId;
  readonly label: string;
}

/**
 * One permission notification's content. Deliberately two-tier rather
 * than a single `title`/`body`:
 *
 *  - `publicTitle` is the only text ever guaranteed visible on a locked
 *    device (Android's `NotificationCompat.VISIBILITY_PRIVATE`, which
 *    this port always requests via `visibility: "private"` — see
 *    `permission-notification-model.ts`'s doc comment for why "private"
 *    and not "public"/"secret"). It must never name the tool, the
 *    action, or any request detail.
 *  - `privateTitle`/`privateBody` carry the real content (which tool,
 *    what it wants to do) and are shown only once the device is
 *    unlocked or has no lock-screen redaction configured.
 *
 * Neither field is ever written to a log or to plain (non-secure)
 * storage by this app — see `permission-notification-model.ts`'s
 * "Sensitive content" section for how that is enforced by construction
 * (this module accepts no storage/logging dependency at all).
 */
export interface PermissionNotificationContent {
  readonly requestId: string;
  readonly agentId: string;
  readonly visibility: "private";
  readonly publicTitle: string;
  readonly privateTitle: string;
  readonly privateBody: string;
  /** Empty when this request is not "safe" for one-tap actions — see `permission-notification-model.ts`'s `buildPermissionNotificationContent`. A tap-only notification is still posted so the user knows a request is waiting. */
  readonly actions: readonly PermissionNotificationAction[];
}

/**
 * One user interaction with a posted permission notification —
 * tapping the body (`actionId: "tap"`) or one of its action buttons.
 * Carries only opaque identifiers, never a response payload: the
 * handler in `permission-notification-model.ts` looks up the actual
 * `AgentPermissionResponse` to send from its own live state rather than
 * trusting anything the OS event carries beyond these three ids — see
 * that module's doc comment for why.
 */
export interface PermissionNotificationActionEvent {
  readonly requestId: string;
  readonly agentId: string;
  readonly actionId: PermissionNotificationActionId | "tap";
}

/**
 * Everything `push-registration-model.ts` and
 * `permission-notification-model.ts` need from the native layer: the
 * same permission read/request pair every port in this app already
 * exposes, a token getter and refresh subscription (T36A), and posting/
 * cancelling/observing permission notifications (T36B).
 */
export interface PushRegistrationPort extends PermissionPort {
  /**
   * Fetches the current push token. Resolves `null` when no token is
   * available — permission not granted, no native push module present,
   * or (per `expo-notifications`) no project id configured. A `null`
   * here is a normal, expected outcome, not an error.
   */
  getToken(): Promise<string | null>;
  /**
   * Subscribes to token-refresh events the OS/push service delivers
   * (Expo's `addPushTokenListener`, FCM's own token-refresh callback,
   * ...). Returns an unsubscribe function. A real implementation must
   * only ever deliver a token here that it also considers current for
   * a subsequent `getToken()` call.
   */
  onTokenRefresh(handler: (token: string) => void): () => void;
  /**
   * Posts one permission notification, replacing any notification
   * already live for `content.requestId`. Idempotent re-posting (same
   * `requestId`, updated content) must never produce two visible
   * notifications for the same request.
   */
  postPermissionNotification(content: PermissionNotificationContent): Promise<void>;
  /**
   * Cancels/dismisses a previously-posted permission notification. A
   * no-op — never a throw — when nothing is live for `requestId`, so a
   * caller never needs to track whether a cancel is "expected".
   */
  cancelPermissionNotification(requestId: string): Promise<void>;
  /**
   * Subscribes to a user tapping the notification body or one of its
   * action buttons. Returns an unsubscribe function.
   */
  onNotificationAction(handler: (event: PermissionNotificationActionEvent) => void): () => void;
}

/** This build's only production `PushRegistrationPort` — see module docstring. */
export function createUnavailablePushRegistrationPort(): PushRegistrationPort {
  return {
    async getPermissionStatus(): Promise<PermissionState> {
      return "unavailable";
    },
    async requestPermission(): Promise<PermissionState> {
      return "unavailable";
    },
    async getToken(): Promise<string | null> {
      return null;
    },
    onTokenRefresh(): () => void {
      // No native token stream exists in this build, so there is
      // nothing to subscribe to and nothing to unsubscribe from.
      return () => {};
    },
    async postPermissionNotification(): Promise<void> {
      // No native notification module exists in this build. Silently
      // dropping the post (rather than throwing) matches this port's
      // existing "unavailable" convention — a caller with no port
      // still gets a defined, awaitable no-op.
    },
    async cancelPermissionNotification(): Promise<void> {},
    onNotificationAction(): () => void {
      return () => {};
    },
  };
}
