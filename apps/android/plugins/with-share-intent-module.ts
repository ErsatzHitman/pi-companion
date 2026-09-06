import { withMainActivity, type ConfigPlugin } from "expo/config-plugins";

/**
 * Config plugin for T36F's native share module (plan.md §9.3).
 *
 * `android.intentFilters` in `../app.config.ts` (T36E,
 * `buildShareIntentFilters()`) already makes the OS *offer* this app as
 * a share target via Expo's built-in `android.intentFilters` mod — no
 * plugin needed for that part, and `../modules/share-intent/` needs no
 * `plugins` entry either: `expo-modules-autolinking`'s
 * `nativeModulesDir` option defaults to `<project>/modules` (confirmed
 * against this app's own installed `expo-modules-autolinking@3.0.30`;
 * see `../modules/share-intent/android/build.gradle`'s doc comment),
 * so the module is autolinked purely by living at that path.
 *
 * What genuinely needs a plugin: `ShareIntentModule.kt`'s `OnNewIntent`
 * hook (see its doc comment) only fires for an intent React Native's
 * `MainActivity` actually hands to the module system, and stock
 * `ReactActivity` does **not** forward `Activity.onNewIntent()`
 * anywhere on its own, nor call `setIntent(intent)` — a long-documented
 * React Native/Expo gotcha for any deep-link or share-target feature on
 * Android (search "onNewIntent not called React Native Android" for the
 * open issues this reproduces). Without this override, a share
 * delivered to an already-running app would silently do nothing: no
 * `OnNewIntent` event, and a later `getIntent()` read would still
 * return the *original* launch intent, not the shared one. This plugin
 * injects exactly that override into the generated `MainActivity.kt`
 * via `withMainActivity`, Expo's sanctioned mechanism for editing
 * generated native source — it re-applies on every `expo prebuild`
 * rather than requiring anyone to hand-edit the (gitignored, generated)
 * `android/` output.
 *
 * **Unverified in this sandbox**: this task may not run
 * `expo prebuild`, `eas build`, or Gradle (this wave's hard rules), so
 * this plugin has never actually been applied to a real
 * `MainActivity.kt` or compiled. `npx expo prebuild --platform android
 * --no-install` is the exact command that would apply it and is the
 * named blocker for this criterion — see this feature's task report.
 */
const IMPORT_LINE = "import android.content.Intent";
/** Also doubles as the idempotency check: a second `expo prebuild` run must not insert this twice. */
const METHOD_MARKER = "override fun onNewIntent(intent: Intent)";
const METHOD_BLOCK = `
  /**
   * T36F (plan.md §9.3): forwards a new intent to \`setIntent\` so
   * \`ShareIntentModule\`'s \`OnNewIntent\` listener fires, and so any
   * later \`getIntent()\` read (this activity's own or a module's) sees
   * the intent that actually woke this activity — not the one that
   * first created it. See \`../../plugins/with-share-intent-module.ts\`.
   */
  ${METHOD_MARKER} {
    super.onNewIntent(intent)
    setIntent(intent)
  }
`;

const BUNDLE_IMPORT_ANCHOR = "import android.os.Bundle";

/**
 * Patches a generated `MainActivity.kt`'s source with the `onNewIntent`
 * override this feature needs (see the module doc comment above). Pure
 * string-in, string-out so it can be unit-tested without invoking
 * `withMainActivity` or `expo prebuild` — see `with-share-intent-module.test.ts`.
 *
 * Every patch below either changes `contents` or throws. A `.replace()` that
 * silently no-ops when its anchor is missing is exactly the failure mode
 * this function exists to rule out: if the Expo template ever stops
 * emitting `import android.os.Bundle`, a silent no-op here would leave
 * `Intent` unimported while the plugin reports success — a failure Gradle
 * or EAS would only surface much later, far from this file. See P5-W19/T67.
 */
export function patchMainActivityContents(contents: string): string {
  if (contents.includes(METHOD_MARKER)) {
    // Already applied — a second prebuild, or the plugin ran twice in one
    // pass. Idempotent: return unchanged rather than double-inserting.
    return contents;
  }

  let patched = contents;
  if (!patched.includes(IMPORT_LINE)) {
    const withImport = patched.replace(
      BUNDLE_IMPORT_ANCHOR,
      `${BUNDLE_IMPORT_ANCHOR}\n${IMPORT_LINE}`,
    );
    if (withImport === patched) {
      throw new Error(
        `withShareIntentModule: could not find the anchor "${BUNDLE_IMPORT_ANCHOR}" in the ` +
          'generated MainActivity.kt, so "' +
          IMPORT_LINE +
          '" was not inserted. The Expo template likely stopped emitting that import. Open the ' +
          "generated android/app/src/main/java/**/MainActivity.kt, find where it declares its " +
          "imports now, and update BUNDLE_IMPORT_ANCHOR in with-share-intent-module.ts to match.",
      );
    }
    patched = withImport;
  }

  const lastBrace = patched.lastIndexOf("}");
  if (lastBrace === -1) {
    throw new Error(
      "withShareIntentModule: could not find MainActivity's closing brace to insert the " +
        "onNewIntent override before. The generated MainActivity.kt may be malformed or empty " +
        "— open it and confirm it is a normal Kotlin class body before re-running prebuild.",
    );
  }
  return `${patched.slice(0, lastBrace)}${METHOD_BLOCK}\n${patched.slice(lastBrace)}`;
}

export const withShareIntentModule: ConfigPlugin = (config) => {
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== "kt") {
      throw new Error(
        "withShareIntentModule only knows how to patch a Kotlin MainActivity.kt " +
          `(got language "${config.modResults.language}"). If this project has switched to ` +
          "Java, this plugin needs a Java-source variant of its patches — it does not have one.",
      );
    }

    config.modResults.contents = patchMainActivityContents(config.modResults.contents);
    return config;
  });
};

export default withShareIntentModule;
