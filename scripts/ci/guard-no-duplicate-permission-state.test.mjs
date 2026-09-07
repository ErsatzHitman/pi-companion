import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_PERMISSION_STATE_PATH,
  findDuplicatePermissionStateUnions,
  stripComments,
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

// --- T244's own acceptance criterion, this guard's own shape: PER FILE ---
// This guard extracts `type X = …;` declarations, not import specifiers, so
// its own analog of "every file with a real import still yields a
// specifier" is "every file with a real top-level `type X = …;` alias
// still yields one after comment-stripping" — checked the same way, with a
// raw, line-anchored, never-comment-stripped heuristic that this
// codebase's `//`- and ` * `-prefixed comment styles cannot satisfy.
const RAW_TOP_LEVEL_TYPE_ALIAS_LINE = /^[ \t]*(?:export\s+)?type\s+\w+\s*=/m;

test("every real apps/android/src file whose raw text has a top-level `type X =` line still has one after stripComments, checked per file", () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const trackedPaths = execFileSync("git", ["ls-files", "apps/android/src"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));

  assert.ok(trackedPaths.length > 10, "expected many files under apps/android/src");

  const filesThatLostTheirDeclaration = [];
  for (const path of trackedPaths) {
    const content = readFileSync(join(repoRoot, path), "utf8");
    if (!RAW_TOP_LEVEL_TYPE_ALIAS_LINE.test(content)) continue;
    const cleaned = stripComments(content);
    if (!RAW_TOP_LEVEL_TYPE_ALIAS_LINE.test(cleaned)) filesThatLostTheirDeclaration.push(path);
  }

  assert.deepEqual(
    filesThatLostTheirDeclaration,
    [],
    "every one of these files' raw text starts a line with a `type X =` alias, so it must" +
      " still be there after stripComments — losing it for any of these means comment" +
      " stripping silently ate a real declaration",
  );
});
