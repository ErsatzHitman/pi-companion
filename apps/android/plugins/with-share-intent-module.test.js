// @ts-check
import { describe, expect, it } from "vitest";
import { patchMainActivityContents } from "./with-share-intent-module.js";

/**
 * Tests for T67 (P5-W19): the share-intent config plugin must fail loudly
 * when it cannot find an anchor to patch, rather than silently no-opping.
 *
 * These exercise `patchMainActivityContents` directly — the pure
 * string-in/string-out core of `withShareIntentModule` — rather than going
 * through `withMainActivity`/`expo prebuild`, which this sandbox may not
 * run. What a real `expo prebuild --platform android --no-install` (CI's
 * "Production prebuild smoke") or a device build would still have to
 * confirm: that the *real* Expo-emitted `MainActivity.kt` actually
 * contains `import android.os.Bundle` at the version currently pinned, and
 * that the patched file compiles under Kotlin/Gradle. Neither is checked
 * by any gate in this repository — T36F said so and this task repeats it.
 *
 * Converted from `.ts` to `.js` at T204 alongside its subject (see
 * `with-share-intent-module.js`'s doc comment for why): this file's own
 * behavioural coverage of `patchMainActivityContents` is unchanged, only
 * the extension and the import specifier moved.
 */

// A realistic stand-in for what `expo prebuild` emits for a default Expo
// Router template's MainActivity.kt (trimmed to what these patches touch).
const TEMPLATE_MAIN_ACTIVITY = `package com.picompanion.app

import android.os.Bundle
import expo.modules.ReactActivityDelegateWrapper
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}
`;

describe("patchMainActivityContents", () => {
  it("inserts the Intent import after the Bundle import anchor and the onNewIntent override before the closing brace", () => {
    const patched = patchMainActivityContents(TEMPLATE_MAIN_ACTIVITY);

    expect(patched).toContain("import android.os.Bundle\nimport android.content.Intent");
    expect(patched).toContain("override fun onNewIntent(intent: Intent) {");
    expect(patched).toContain("super.onNewIntent(intent)");
    expect(patched).toContain("setIntent(intent)");
  });

  it("throws naming the missing anchor and what to do, instead of silently no-opping, when the Bundle import is absent", () => {
    // Simulates the exact failure this task is about: the Expo template
    // stops emitting `import android.os.Bundle` (e.g. it switches to
    // `import android.os.Bundle?` some other way, or drops the import
    // because savedInstanceState typing changes upstream).
    const withoutBundleImport = TEMPLATE_MAIN_ACTIVITY.replace("import android.os.Bundle\n", "");
    expect(withoutBundleImport).not.toContain("import android.os.Bundle");

    expect(() => patchMainActivityContents(withoutBundleImport)).toThrow(
      /could not find the anchor "import android\.os\.Bundle"/,
    );
    // The message must say what a developer should do, not only what went wrong.
    expect(() => patchMainActivityContents(withoutBundleImport)).toThrow(
      /update BUNDLE_IMPORT_ANCHOR in with-share-intent-module\.js to match/,
    );
  });

  it("does NOT silently return unchanged contents when the anchor is missing — the failure is a throw, not a no-op", () => {
    const withoutBundleImport = TEMPLATE_MAIN_ACTIVITY.replace("import android.os.Bundle\n", "");
    let threw = false;
    try {
      patchMainActivityContents(withoutBundleImport);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("throws naming the closing-brace anchor when MainActivity has no closing brace to insert before", () => {
    const malformed =
      "package com.picompanion.app\n\nimport android.os.Bundle\n\nclass MainActivity : ReactActivity(";
    expect(() => patchMainActivityContents(malformed)).toThrow(
      /could not find MainActivity's closing brace/,
    );
  });

  it("is idempotent: running the patch twice does not double-insert the import or the override", () => {
    const firstPass = patchMainActivityContents(TEMPLATE_MAIN_ACTIVITY);
    const secondPass = patchMainActivityContents(firstPass);

    expect(secondPass).toBe(firstPass);

    const importOccurrences = secondPass.split("import android.content.Intent").length - 1;
    const overrideOccurrences =
      secondPass.split("override fun onNewIntent(intent: Intent)").length - 1;
    expect(importOccurrences).toBe(1);
    expect(overrideOccurrences).toBe(1);
  });

  it("is idempotent against a file that already carries the patch from a source other than this run (e.g. checked-in fixture)", () => {
    const alreadyPatched = patchMainActivityContents(TEMPLATE_MAIN_ACTIVITY);
    // Feed it back through a fresh call, simulating a second `expo prebuild`
    // reusing output that already has the override applied.
    const result = patchMainActivityContents(alreadyPatched);
    expect(result).toBe(alreadyPatched);
  });
});
