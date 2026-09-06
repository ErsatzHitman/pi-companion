// @ts-check
const { withMainActivity } = require("expo/config-plugins");

/**
 * Config plugin for T36F's native share module (plan.md §9.3).
 *
 * `android.intentFilters` in `../app.config.ts` (T36E; built inline from
 * `../src/features/share/accepted-file-mime-types.json` since T201 —
 * see that file's doc comment for why it is no longer built by calling
 * `share-intent-config.ts`'s `buildShareIntentFilters()` directly)
 * already makes the OS *offer* this app as a share target via Expo's
 * built-in `android.intentFilters` mod — no
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
 * **Written as plain CommonJS JavaScript, not TypeScript (T204).** Expo's
 * plugin resolver (`resolvePluginForModule` in
 * `@expo/config-plugins/build/utils/plugin-resolver.js`) requires the
 * resolved plugin file from disk through Node; `@expo/require-utils`'s
 * `loadModuleSync` only transpiles the *entry* config file
 * (`app.config.ts`) — anything Expo resolves afterwards, including a
 * plugin referenced by path, is loaded with a plain `require()` when it
 * detects a CommonJS module, and Node cannot `require()` `.ts` directly.
 * That is invisible on this workstation, where `@expo/config-plugins`
 * resolves from the hoisted root install (57.0.9, which happens to also
 * accept `.ts` files in `resolvePluginForModule`'s extension probe) —
 * but `package-lock.json` pins a *separate, nested*
 * `apps/android/node_modules/@expo/config-plugins` at **54.0.5** for
 * this workspace specifically (`node -e
 * "console.log(require('../../package-lock.json')
 * .packages['apps/android/node_modules/@expo/config-plugins'].version)"`
 * from `apps/android` prints `54.0.5`), and that nested copy is what a
 * clean `npm ci` on CI actually installs and resolves from — Node's
 * module resolution always prefers the nearest `node_modules` over an
 * ancestor's, so the newer, TS-tolerant root copy is shadowed there.
 * `apps/android/node_modules` is empty on this workstation (nothing
 * nested has ever been installed here), which is exactly why `npx expo
 * config --type public` succeeds locally and fails on CI's
 * "Production prebuild smoke" step with `PluginError: Failed to
 * resolve plugin for module "./plugins/with-share-intent-module"` —
 * see this feature's task report for the full install-layout diff.
 * Writing this plugin as plain `.js` (the conventional way Expo config
 * plugins are authored) removes the divergence entirely: a `.js` file
 * `require()`s under every `@expo/config-plugins` version this
 * repository has ever pinned, so which copy resolves stops mattering.
 * `@ts-check` plus the JSDoc `@type` annotations below keep this file
 * under real type-checking (see `../tsconfig.json`'s `allowJs`) without
 * needing the whole project's `checkJs` turned on — this file opts in
 * per-file, the same way `../metro.config.js` already does.
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
   * first created it. See \`../../plugins/with-share-intent-module.js\`.
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
 * `withMainActivity` or `expo prebuild` — see `with-share-intent-module.test.js`.
 *
 * Every patch below either changes `contents` or throws. A `.replace()` that
 * silently no-ops when its anchor is missing is exactly the failure mode
 * this function exists to rule out: if the Expo template ever stops
 * emitting `import android.os.Bundle`, a silent no-op here would leave
 * `Intent` unimported while the plugin reports success — a failure Gradle
 * or EAS would only surface much later, far from this file. See P5-W19/T67.
 *
 * @param {string} contents
 * @returns {string}
 */
function patchMainActivityContents(contents) {
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
          "imports now, and update BUNDLE_IMPORT_ANCHOR in with-share-intent-module.js to match.",
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

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withShareIntentModule = (config) => {
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

module.exports = withShareIntentModule;
module.exports.withShareIntentModule = withShareIntentModule;
module.exports.patchMainActivityContents = patchMainActivityContents;
module.exports.default = withShareIntentModule;
