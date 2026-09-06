import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_PERMISSION_STATE_PATH,
  findDuplicatePermissionStateUnions,
} from "./guard-no-duplicate-permission-state.mjs";

const CANONICAL_UNION = `
export type PermissionState =
  | "undetermined"
  | "granted"
  | "denied"
  | "denied-permanently"
  | "unavailable";
`;

test("passes on a clean tree where only the canonical module declares the union", () => {
  const files = [
    { path: CANONICAL_PERMISSION_STATE_PATH, content: CANONICAL_UNION },
    {
      path: "apps/android/src/features/connect/onboarding-permissions.ts",
      content: `export type { PermissionState } from "../composer/permission-recovery.js";`,
    },
  ];

  assert.deepEqual(findDuplicatePermissionStateUnions(files), []);
});

test("fails on a seeded second single-line union outside the canonical module", () => {
  const files = [
    { path: CANONICAL_PERMISSION_STATE_PATH, content: CANONICAL_UNION },
    {
      path: "apps/android/src/features/connect/onboarding-permissions.ts",
      content: `export type OnboardingPermissionStatus = "granted" | "denied" | "denied-permanently" | "unavailable" | "undetermined";`,
    },
  ];

  assert.deepEqual(findDuplicatePermissionStateUnions(files), [
    {
      path: "apps/android/src/features/connect/onboarding-permissions.ts",
      typeName: "OnboardingPermissionStatus",
    },
  ]);
});

test("fails on a seeded second multi-line union outside the canonical module (the real pre-T60D shape)", () => {
  const files = [
    { path: CANONICAL_PERMISSION_STATE_PATH, content: CANONICAL_UNION },
    {
      path: "apps/android/src/features/voice/mic-permission-state.ts",
      content: `
export type VoicePermissionState =
  | "undetermined"
  | "granted"
  | "denied"
  | "denied-permanently"
  | "unavailable";
`,
    },
  ];

  assert.deepEqual(findDuplicatePermissionStateUnions(files), [
    {
      path: "apps/android/src/features/voice/mic-permission-state.ts",
      typeName: "VoicePermissionState",
    },
  ]);
});

test("does not flag a comment mentioning the literal — only a real type-alias declaration counts", () => {
  const files = [
    { path: CANONICAL_PERMISSION_STATE_PATH, content: CANONICAL_UNION },
    {
      path: "apps/android/src/features/notifications/notification-permission-recovery.ts",
      content: `
/**
 * Reuses "denied-permanently" from the shared module — does not redeclare it.
 */
import type { PermissionState } from "../composer/permission-recovery.js";
export type { PermissionState } from "../composer/permission-recovery.js";
`,
    },
  ];

  assert.deepEqual(findDuplicatePermissionStateUnions(files), []);
});

test("does not flag a switch case or function call using the literal, only a declaration of it", () => {
  const files = [
    { path: CANONICAL_PERMISSION_STATE_PATH, content: CANONICAL_UNION },
    {
      path: "apps/android/src/features/notifications/notification-permission-recovery.ts",
      content: `
import type { PermissionState } from "../composer/permission-recovery.js";
export function describeNotificationPermissionRecovery(state: PermissionState) {
  switch (state) {
    case "denied-permanently":
      return { action: "open-settings" };
    default:
      return { action: "dismiss" };
  }
}
`,
    },
  ];

  assert.deepEqual(findDuplicatePermissionStateUnions(files), []);
});

test("flags a permission-shaped union even when it OMITS 'denied-permanently' — the P5-W15 blind spot this task closes (real pre-T60E shape of CameraPermissionStatus)", () => {
  const files = [
    { path: CANONICAL_PERMISSION_STATE_PATH, content: CANONICAL_UNION },
    {
      path: "apps/android/src/features/connect/qr-scanner-port.ts",
      content: `export type CameraPermissionStatus = "granted" | "denied" | "undetermined" | "unavailable";`,
    },
  ];

  assert.deepEqual(findDuplicatePermissionStateUnions(files), [
    {
      path: "apps/android/src/features/connect/qr-scanner-port.ts",
      typeName: "CameraPermissionStatus",
    },
  ]);
});

test("does not flag a same-domain enum that merely reuses a couple of vocabulary words (QrScanPhase's real shape) — a pure-subset check, not a share-any-literal one", () => {
  const files = [
    { path: CANONICAL_PERMISSION_STATE_PATH, content: CANONICAL_UNION },
    {
      path: "apps/android/src/features/connect/qr-scan-model.ts",
      content: `
export type QrScanPhase =
  | "idle"
  | "checking"
  | "ready"
  | "denied"
  | "settings"
  | "unavailable"
  | "pairing"
  | "paired"
  | "error";
`,
    },
  ];

  assert.deepEqual(findDuplicatePermissionStateUnions(files), []);
});

test("does not flag a single reused literal on its own — the 2-member floor", () => {
  const files = [
    { path: CANONICAL_PERMISSION_STATE_PATH, content: CANONICAL_UNION },
    {
      path: "apps/android/src/features/connect/some-other-file.ts",
      content: `export type ApprovalOutcome = "granted";`,
    },
  ];

  assert.deepEqual(findDuplicatePermissionStateUnions(files), []);
});

test("catches multiple duplicates across multiple files in one pass", () => {
  const files = [
    { path: CANONICAL_PERMISSION_STATE_PATH, content: CANONICAL_UNION },
    {
      path: "apps/android/src/features/connect/a.ts",
      content: `export type A = "denied-permanently" | "granted";`,
    },
    {
      path: "apps/android/src/features/composer/b.ts",
      content: `export type B = "denied-permanently" | "granted";`,
    },
  ];

  assert.deepEqual(findDuplicatePermissionStateUnions(files), [
    { path: "apps/android/src/features/connect/a.ts", typeName: "A" },
    { path: "apps/android/src/features/composer/b.ts", typeName: "B" },
  ]);
});
