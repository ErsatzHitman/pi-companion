/**
 * This device's push-registration status, in plain language (T42A1,
 * plan.md §9.3 devices surface). Reads only through
 * `../notifications/push-registration-port.js`'s
 * `PushRegistrationPort.getPermissionStatus()` and
 * `../notifications/push-registration-model.js`'s
 * `PushRegistrationController.getLastRegisteredToken()` — never a new
 * state vocabulary layered on top of those.
 *
 * `PermissionState` is imported, not re-declared: this workspace's
 * `scripts/ci/guard-no-duplicate-permission-state.mjs` fails the build on
 * a second private permission-state union anywhere under
 * `apps/android/src`, so this module reuses `../composer/permission-
 * recovery.js`'s vocabulary the same way every other feature in this app
 * already does (that module's own header comment lists them).
 *
 * The registered TOKEN ITSELF never reaches this module, `DevicesScreen.tsx`,
 * or anything downstream of `use-device-push-status.ts` — callers pass only
 * a `registered: boolean` they compute off `getLastRegisteredToken() !==
 * null`. A push token is a credential-shaped value
 * (`../notifications/push-registration-model.ts`'s own doc comment); this
 * feature's "never render a secret" acceptance box holds by construction
 * here, because nothing in this module's types even has a slot for the
 * token value to occupy.
 */
import type { PermissionState } from "../composer/permission-recovery.js";

export interface DevicePushStatusSnapshot {
  /** `null` before the first `getPermissionStatus()` read resolves. */
  readonly permissionStatus: PermissionState | null;
  readonly registered: boolean;
}

export const UNREAD_DEVICE_PUSH_STATUS: DevicePushStatusSnapshot = {
  permissionStatus: null,
  registered: false,
};

/**
 * The permission states in which a registered token cannot produce a
 * delivered notification, so `registered` must not be reported in their
 * place. `granted` and `undetermined` are deliberately absent: neither
 * contradicts a live registration, and `undetermined` is the state a
 * permission read races through.
 */
function isSettledNegativePermission(permissionStatus: PermissionState | null): boolean {
  return (
    permissionStatus === "denied" ||
    permissionStatus === "denied-permanently" ||
    permissionStatus === "unavailable"
  );
}

/**
 * One human-readable sentence describing `snapshot` — the ONLY thing
 * `DevicesScreen.tsx` renders for this device's push state, so a test
 * against this function is a test against everything a user reads here.
 *
 * `registered` wins over `permissionStatus` ONLY where the two are not in
 * conflict: a token can outlive a later permission read racing behind it
 * (see `use-device-push-status.ts`), so while `permissionStatus` is `null`
 * or has settled on `granted`/`undetermined`, "registered" is the more
 * useful fact to show. A SETTLED NEGATIVE read — `denied`,
 * `denied-permanently`, `unavailable` — wins over `registered` instead,
 * because in those states the registered token is real and the delivery it
 * implies is not: Android drops the notification before the user sees it.
 *
 * CORRECTED at the P9-S merge gate. This said `registered` "always wins
 * over `permissionStatus`" because "'registered' is the more useful, and
 * equally true, fact to show". The race half is sound; **"equally true" is
 * false for every negative state**, and the conflicting combination is
 * ordinary rather than exotic: `registered` is
 * `getLastRegisteredToken() !== null`, which
 * `../notifications/push-registration-model.ts` moves only on daemon
 * registration outcomes and on `resetForNewConnection()` — never because
 * the OS permission changed. So "grant → register → later turn
 * notifications off in system settings" left this function permanently
 * asserting "This device is registered to receive push notifications." for
 * a device that receives none, and suppressed the one sentence naming the
 * fix. Measured by executing each of the five settled states one at a time
 * with `registered: true`: BEFORE the fix all five returned the registered
 * sentence, `unavailable` included — one state more than the gate's own
 * report named.
 */
export function describeDevicePushStatus(snapshot: DevicePushStatusSnapshot): string {
  if (snapshot.registered && !isSettledNegativePermission(snapshot.permissionStatus)) {
    return "This device is registered to receive push notifications.";
  }
  if (snapshot.permissionStatus === null) {
    return "Checking push notification status…";
  }
  switch (snapshot.permissionStatus) {
    case "granted":
      return "Notification permission is granted, but this device has not registered a push token yet.";
    case "undetermined":
      return "This device has not been asked for notification permission yet.";
    case "denied":
      return "Notification permission was denied. Push notifications will not arrive on this device.";
    case "denied-permanently":
      return "Notification permission was permanently denied. Enable it from system settings to receive push notifications.";
    case "unavailable":
      return "Push notifications are not available on this build.";
    default: {
      const exhaustive: never = snapshot.permissionStatus;
      return exhaustive;
    }
  }
}
