import { createRequire } from "node:module";

import { AndroidConfig } from "@expo/config-plugins";
import { describe, expect, it } from "vitest";

import config from "./app.config";

/**
 * T294 — proves the decision recorded in `app.config.ts` above `plugins`
 * (block the two legacy storage permissions `expo-image-picker`'s bundled
 * manifest merges in) against the REAL, on-disk dependency, using Expo's
 * own manifest-permission primitives (`@expo/config-plugins`'
 * `AndroidConfig.Manifest`/`AndroidConfig.Permissions`) rather than a
 * hand-rolled parser or a hardcoded fixture.
 *
 * What this file cannot prove: it does not run a native Gradle build or
 * AGP's real manifest merger, so it cannot show the FINAL merged
 * `AndroidManifest.xml` a built APK would carry. That would need either a
 * local Android SDK/Gradle toolchain (not available here) or an EAS
 * archive inspection — T236 is the open, owner-blocked task for that. What
 * this file DOES prove, directly against the real installed
 * `expo-image-picker` package: (1) exactly which permissions its bundled
 * manifest declares today, so a future dependency bump that changes this
 * set fails loudly here instead of silently; (2) that `app.config.ts`
 * declares `blockedPermissions` for exactly the two storage permissions,
 * no more, no fewer; and (3) that applying `@expo/config-plugins`' own
 * `addBlockedPermissions` — the exact function Expo's prebuild pipeline
 * calls for this config field — against `expo-image-picker`'s real
 * manifest produces a result with `CAMERA` untouched and both storage
 * permissions marked `tools:node="remove"`, which is what tells AGP's
 * manifest merger to drop them from the final build.
 */

const requireFromHere = createRequire(import.meta.url);

const IMAGE_PICKER_MANIFEST_PATH = requireFromHere.resolve(
  "expo-image-picker/android/src/main/AndroidManifest.xml",
);

const BLOCKED_STORAGE_PERMISSIONS = [
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_EXTERNAL_STORAGE",
];

describe("expo-image-picker's bundled Android manifest (measured input)", () => {
  it("declares exactly CAMERA, WRITE_EXTERNAL_STORAGE and READ_EXTERNAL_STORAGE today", async () => {
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
      IMAGE_PICKER_MANIFEST_PATH,
    );
    const permissions = AndroidConfig.Permissions.getPermissions(manifest);
    expect(permissions).toEqual([
      "android.permission.CAMERA",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_EXTERNAL_STORAGE",
    ]);
  });
});

describe("apps/android/app.config.ts's android.blockedPermissions (T294 decision)", () => {
  it("blocks exactly the two legacy storage permissions — no more, no fewer", () => {
    const blocked = config.android?.blockedPermissions ?? [];
    expect([...blocked].sort()).toEqual([...BLOCKED_STORAGE_PERMISSIONS].sort());
  });

  it("never blocks CAMERA — the permission expo-camera-capture-port.ts actually needs", () => {
    const blocked = config.android?.blockedPermissions ?? [];
    expect(blocked).not.toContain("android.permission.CAMERA");
  });
});

describe("applying this app's blockedPermissions to the real bundled manifest", () => {
  it("marks both storage permissions tools:node=remove and leaves CAMERA untouched", async () => {
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
      IMAGE_PICKER_MANIFEST_PATH,
    );
    const blockedPermissions = config.android?.blockedPermissions ?? [];
    const result = AndroidConfig.Permissions.addBlockedPermissions(manifest, blockedPermissions);
    const entries = result.manifest["uses-permission"] ?? [];

    const byName = new Map(entries.map((entry) => [entry.$["android:name"], entry.$]));

    expect(byName.get("android.permission.CAMERA")?.["tools:node"]).toBeUndefined();
    expect(byName.get("android.permission.WRITE_EXTERNAL_STORAGE")?.["tools:node"]).toBe("remove");
    expect(byName.get("android.permission.READ_EXTERNAL_STORAGE")?.["tools:node"]).toBe("remove");
  });

  it("would leave both storage permissions un-marked if blockedPermissions were emptied (mutation sanity check)", async () => {
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
      IMAGE_PICKER_MANIFEST_PATH,
    );
    const result = AndroidConfig.Permissions.addBlockedPermissions(manifest, []);
    const entries = result.manifest["uses-permission"] ?? [];
    const byName = new Map(entries.map((entry) => [entry.$["android:name"], entry.$]));

    expect(byName.get("android.permission.WRITE_EXTERNAL_STORAGE")?.["tools:node"]).toBeUndefined();
    expect(byName.get("android.permission.READ_EXTERNAL_STORAGE")?.["tools:node"]).toBeUndefined();
  });
});
