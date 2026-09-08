import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { AndroidConfig } from "@expo/config-plugins";
import { describe, expect, it } from "vitest";

import config from "./app.config";

/**
 * T294 — proves the decision recorded in `app.config.ts` above `plugins`
 * against the REAL, on-disk dependency, using Expo's
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
 * declares `blockedPermissions` for exactly `READ_EXTERNAL_STORAGE`, no
 * more, no fewer; (3) that applying `@expo/config-plugins`' own
 * `addBlockedPermissions` — the exact function Expo's prebuild pipeline
 * calls for this config field — against `expo-image-picker`'s real
 * manifest produces a result with `CAMERA` AND `WRITE_EXTERNAL_STORAGE`
 * untouched and `READ_EXTERNAL_STORAGE` marked `tools:node="remove"`,
 * which is what tells AGP's manifest merger to drop it from the final
 * build; and (4) the reason `WRITE_EXTERNAL_STORAGE` is NOT blocked, read
 * out of the dependency's own Kotlin source rather than asserted in prose.
 *
 * CORRECTED at the P9-R merge gate: (2) and (3) used to pin BOTH storage
 * permissions as blocked. That was wrong for `WRITE_EXTERNAL_STORAGE` —
 * `ImagePickerModule.kt`'s `ensureCameraPermissionsAreGranted` requires it
 * alongside `CAMERA` below `Build.VERSION_CODES.Q`, and this app's
 * `minSdkVersion` is 24, so blocking it broke camera capture on every API
 * 24–28 device. The `whyWriteExternalStorageStays` block below is what now
 * keeps that from being re-litigated from prose alone: it asserts the real
 * source still contains the version guard and the conjunction, so a future
 * `expo-image-picker` bump that drops the requirement fails HERE and the
 * decision can be revisited deliberately.
 */

const requireFromHere = createRequire(import.meta.url);

const IMAGE_PICKER_MANIFEST_PATH = requireFromHere.resolve(
  "expo-image-picker/android/src/main/AndroidManifest.xml",
);

const IMAGE_PICKER_MODULE_SOURCE_PATH = requireFromHere.resolve(
  "expo-image-picker/android/src/main/java/expo/modules/imagepicker/ImagePickerModule.kt",
);

const BLOCKED_STORAGE_PERMISSIONS = ["android.permission.READ_EXTERNAL_STORAGE"];

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
  it("blocks exactly READ_EXTERNAL_STORAGE — no more, no fewer", () => {
    const blocked = config.android?.blockedPermissions ?? [];
    expect([...blocked].sort()).toEqual([...BLOCKED_STORAGE_PERMISSIONS].sort());
  });

  it("never blocks CAMERA — the permission expo-camera-capture-port.ts actually needs", () => {
    const blocked = config.android?.blockedPermissions ?? [];
    expect(blocked).not.toContain("android.permission.CAMERA");
  });

  it("never blocks WRITE_EXTERNAL_STORAGE — the camera path needs it below API 29", () => {
    const blocked = config.android?.blockedPermissions ?? [];
    expect(blocked).not.toContain("android.permission.WRITE_EXTERNAL_STORAGE");
  });
});

describe("whyWriteExternalStorageStays (measured from expo-image-picker's own Kotlin)", () => {
  const source = readFileSync(IMAGE_PICKER_MODULE_SOURCE_PATH, "utf8");

  it("still guards the CAMERA-alone check behind Build.VERSION_CODES.Q", () => {
    expect(source).toContain("ensureCameraPermissionsAreGranted");
    expect(source).toContain("if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)");
  });

  it("still requires WRITE_EXTERNAL_STORAGE alongside CAMERA below that version", () => {
    const collapsed = source.replace(/\s+/g, " ");
    expect(collapsed).toContain(
      "permissionsResponse[Manifest.permission.WRITE_EXTERNAL_STORAGE]?.status == " +
        "PermissionsStatus.GRANTED && permissionsResponse[Manifest.permission.CAMERA]?.status == " +
        "PermissionsStatus.GRANTED",
    );
  });

  it("still asks for WRITE_EXTERNAL_STORAGE only below Q, which is why blocking it denies the request outright", () => {
    expect(source).toContain(
      "Manifest.permission.WRITE_EXTERNAL_STORAGE.takeIf { Build.VERSION.SDK_INT < Build.VERSION_CODES.Q }",
    );
  });

  it("reaches READ_EXTERNAL_STORAGE only through the media-library permission request", () => {
    const readHits = source.match(/Manifest\.permission\.READ_EXTERNAL_STORAGE/g) ?? [];
    expect(readHits).toHaveLength(1);
    expect(source).toContain("Manifest.permission.READ_EXTERNAL_STORAGE.takeIf { !writeOnly }");
  });
});

describe("applying this app's blockedPermissions to the real bundled manifest", () => {
  it("marks READ_EXTERNAL_STORAGE tools:node=remove and leaves CAMERA and WRITE_EXTERNAL_STORAGE untouched", async () => {
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
      IMAGE_PICKER_MANIFEST_PATH,
    );
    const blockedPermissions = config.android?.blockedPermissions ?? [];
    const result = AndroidConfig.Permissions.addBlockedPermissions(manifest, blockedPermissions);
    const entries = result.manifest["uses-permission"] ?? [];

    const byName = new Map(entries.map((entry) => [entry.$["android:name"], entry.$]));

    expect(byName.get("android.permission.CAMERA")?.["tools:node"]).toBeUndefined();
    expect(byName.get("android.permission.WRITE_EXTERNAL_STORAGE")?.["tools:node"]).toBeUndefined();
    expect(byName.get("android.permission.READ_EXTERNAL_STORAGE")?.["tools:node"]).toBe("remove");
  });

  it("would leave READ_EXTERNAL_STORAGE un-marked if blockedPermissions were emptied (mutation sanity check)", async () => {
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
      IMAGE_PICKER_MANIFEST_PATH,
    );
    const result = AndroidConfig.Permissions.addBlockedPermissions(manifest, []);
    const entries = result.manifest["uses-permission"] ?? [];
    const byName = new Map(entries.map((entry) => [entry.$["android:name"], entry.$]));

    expect(byName.get("android.permission.READ_EXTERNAL_STORAGE")?.["tools:node"]).toBeUndefined();
  });
});
