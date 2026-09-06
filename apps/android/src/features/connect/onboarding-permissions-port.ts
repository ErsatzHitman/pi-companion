/**
 * Production `OnboardingPermissionsPort` (T32A6; unified onto
 * `../composer/permission-recovery.ts`'s `PermissionPort` shape by
 * T60D). Thin adapter only — all decision logic lives in
 * `../composer/permission-recovery.ts`, which stays React Native-free
 * and is what `permission-recovery.test.ts` proves against. This file
 * is never imported by a test (per this repo's proven vitest
 * limitation: any module reaching `react-native` fails with a
 * RolldownError), only by `OnboardingGate.tsx` at runtime.
 *
 * Camera get/request delegates to `qr-scanner-port.ts`'s existing
 * `CameraScannerPort` — reused, not forked. In this workspace that is
 * always `createUnavailableCameraScannerPort()` (no `expo-camera`
 * installed; see that module's docstring for the install command), so
 * this adapter can only ever report `"unavailable"` for camera checks,
 * never `"denied-permanently"` — that fifth state is exercised in
 * `permission-recovery.test.ts` only, against a scripted fake port,
 * until a real camera module lands. `CameraScannerPort` needs no cast to
 * satisfy `PermissionPort`: since T60E (P5-W17) it reads and returns
 * `PermissionState` itself, having dropped the four-value
 * `CameraPermissionStatus` alias it used to declare (a structural subset
 * of the same vocabulary, which is why no cast was ever needed here).
 *
 * `openAppSettings` is the one genuinely real piece here: React
 * Native's own `Linking.openSettings()` (core RN, not an extra
 * install — `apps/android` already depends on `react-native`) opens
 * the OS app-settings screen. It has not been exercised on an emulator
 * or device by this task (see `CLAUDE.md`'s device-claim rule); the
 * only thing proven here is that this file exists and wires the real
 * API, not a stub.
 */
import { Linking } from "react-native";

import { createUnavailableCameraScannerPort, type CameraScannerPort } from "./qr-scanner-port.js";
import type { OnboardingPermissionsPort } from "./onboarding-permissions.js";

export function createOnboardingPermissionsPort(
  camera: CameraScannerPort = createUnavailableCameraScannerPort(),
): OnboardingPermissionsPort {
  return {
    getPermissionStatus: () => camera.getPermissionStatus(),
    requestPermission: () => camera.requestPermission(),
    openAppSettings: () => Linking.openSettings(),
  };
}
