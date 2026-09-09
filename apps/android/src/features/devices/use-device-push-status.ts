/**
 * Live push-registration status for this device (T42A1) — same
 * "subscribe, set state" shape as `use-trusted-devices.ts` above, no
 * colocated test for the identical reason.
 *
 * `isRegistered` is read synchronously (`PushRegistrationController.
 * getLastRegisteredToken() !== null` — see `device-push-status-model.ts`'s
 * header for why the token itself never passes through here) both
 * immediately and again once `getPermissionStatus()` resolves, so a
 * registration that completes while the permission read is in flight is
 * still reflected in the final snapshot.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { PermissionState } from "../composer/permission-recovery.js";
import {
  UNREAD_DEVICE_PUSH_STATUS,
  type DevicePushStatusSnapshot,
} from "./device-push-status-model.js";

export interface UseDevicePushStatusOptions {
  getPermissionStatus: () => Promise<PermissionState>;
  isRegistered: () => boolean;
  /** See `use-trusted-devices.ts`'s option of the same name. */
  subscribeToConnectionChanges?: (onChange: () => void) => () => void;
}

export interface UseDevicePushStatusResult {
  snapshot: DevicePushStatusSnapshot;
  refresh: () => void;
}

export function useDevicePushStatus(
  options: UseDevicePushStatusOptions,
): UseDevicePushStatusResult {
  const { getPermissionStatus, isRegistered, subscribeToConnectionChanges } = options;
  const [snapshot, setSnapshot] = useState<DevicePushStatusSnapshot>(UNREAD_DEVICE_PUSH_STATUS);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    setSnapshot((previous) => ({ ...previous, registered: isRegistered() }));
    void getPermissionStatus().then((permissionStatus) => {
      if (requestSeq.current === seq) {
        setSnapshot({ permissionStatus, registered: isRegistered() });
      }
    });
  }, [getPermissionStatus, isRegistered]);

  useEffect(() => {
    load();
    if (!subscribeToConnectionChanges) {
      return undefined;
    }
    return subscribeToConnectionChanges(load);
  }, [load, subscribeToConnectionChanges]);

  return { snapshot, refresh: load };
}
