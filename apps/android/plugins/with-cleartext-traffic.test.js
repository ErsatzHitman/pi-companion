// @ts-check
import { describe, expect, it } from "vitest";
import { setUsesCleartextTraffic } from "./with-cleartext-traffic.js";

/**
 * T330. Exercises the plugin's pure core against a manifest in the shape
 * `@expo/config-plugins` parses `AndroidManifest.xml` into, rather than
 * through `expo prebuild` (see `with-share-intent-module.test.js`'s doc
 * comment for why). What a real prebuild still has to confirm is covered
 * by `ci.yml`'s "Production prebuild smoke" step, which applies every
 * plugin in `app.config.ts` to the real template.
 */

/** @returns {import("expo/config-plugins").AndroidConfig.Manifest.AndroidManifest} */
function manifest() {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      queries: [],
      application: [
        {
          $: {
            "android:name": ".MainApplication",
            "android:allowBackup": "true",
          },
          activity: [{ $: { "android:name": ".MainActivity" } }],
        },
      ],
    },
  };
}

describe("setUsesCleartextTraffic (T330)", () => {
  it('sets android:usesCleartextTraffic="true" on the main application and keeps everything else', () => {
    const patched = setUsesCleartextTraffic(manifest());
    const application = patched.manifest.application?.[0];
    expect(application?.$["android:usesCleartextTraffic"]).toBe("true");
    expect(application?.$["android:allowBackup"]).toBe("true");
    expect(application?.$["android:name"]).toBe(".MainApplication");
    expect(application?.activity?.[0]?.$["android:name"]).toBe(".MainActivity");
  });

  it("overwrites an explicit false rather than leaving the release build unable to connect", () => {
    const input = manifest();
    const application = input.manifest.application?.[0];
    if (application) application.$["android:usesCleartextTraffic"] = "false";
    const patched = setUsesCleartextTraffic(input);
    expect(patched.manifest.application?.[0]?.$["android:usesCleartextTraffic"]).toBe("true");
  });

  it("throws on a manifest with no main application, so prebuild fails instead of shipping a silent no-op", () => {
    const input = manifest();
    input.manifest.application = [];
    expect(() => setUsesCleartextTraffic(input)).toThrow(/MainApplication/);
  });
});
