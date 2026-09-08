import type { ExpoConfig } from "expo/config";
import type { ShareIntentFilter } from "./src/features/share/share-intent-config.js";

import acceptedFileMimeTypes from "./src/features/share/accepted-file-mime-types.json";

// `@expo/config-types`' `ExpoConfig["plugins"]` (this app's pinned
// version) only types a plugin entry as a resolvable path string, not a
// direct `ConfigPlugin` function reference — even though Expo's mod
// compiler accepts either at runtime. The string form below is also the
// more common, officially-documented way to declare a local plugin
// (Expo resolves it via `resolveConfigPluginFunction`, requiring the
// resolved module's default export to be the `ConfigPlugin` — exactly
// what `./plugins/with-share-intent-module.js` exports), so this is not
// a workaround, just the form the type declares. `with-share-intent-
// module.js` is plain JavaScript, not TypeScript (T204) — see its own
// doc comment for why: Expo's plugin resolver probes a fixed extension
// list to FIND whatever this string resolves to, and the nested
// `@expo/config-plugins` a clean `npm ci` installs under
// `apps/android/node_modules` on CI cannot RESOLVE `.ts` the way this
// workstation's hoisted-root copy can.
//
// CORRECTED (P8-W7 merge gate): this said the resolver "cannot load"
// `.ts`. It is the resolve stage, not the load stage — CI's trace
// throws from `resolvePluginForModule` with `PLUGIN_NOT_FOUND`, before
// any loader runs. Same correction as the plugin's own doc comment.

/**
 * Expo app config — plan.md §6, §9.1, §15.3.
 *
 * This app is Android-only: no `ios` block, no `web` block, and no
 * `react-native-web`/`react-dom` dependency (enforced further by
 * `metro.config.js` and `scripts/guard-no-web-artifacts.mjs`).
 *
 * Product identity per plan.md §15.3: production package `sh.picompanion`,
 * development package `sh.picompanion.debug`, deep-link scheme
 * `picompanion://`. EAS project ownership and signing credentials are
 * claimed later (T17B); this config only carries the scheme/package
 * identity itself.
 *
 * `android.intentFilters` below (T36E, plan.md §9.3) is built inline
 * from `accepted-file-mime-types.json` rather than by calling
 * `share-intent-config.ts`'s `buildShareIntentFilters()` (T201; that
 * function was this config's original derivation, and it stopped being
 * reachable from here — see `share-intent-config.ts`'s doc comment for
 * why: `@expo/require-utils`'s loader transpiles only this file, so a
 * nested `require` of a relative `.ts` module fails, and JSON is the one
 * relative module format it can still load unmodified). `share-intent-
 * model.ts`'s `ACCEPTED_FILE_MIME_TYPES` derives from that same JSON
 * file, so this declaration and `classifyShareIntent`'s allowlist
 * (`src/features/share/share-intent-model.ts`) structurally cannot list
 * different MIME types — see `share-intent-receiver.ts`'s doc comment
 * for the full route decision. Registering these filters makes the OS
 * *offer* this app as a share target; it does not by itself make a
 * share reach any JS code — that still needs the native listener named
 * as a gap in `share-intent-receiver.ts`.
 */
const isDevelopmentClient = process.env["APP_VARIANT"] === "development";

/**
 * T235 (docs/issues-from-plan.md) — decision record for how `android.versionCode`
 * below is produced, kept beside the code it governs rather than only in the
 * task ledger, per that task's "write the reasoning into the file you change"
 * requirement.
 *
 * THE DEFECT: this file declared `version: "0.1.0"` and no `android.versionCode`
 * at all, and no `eas.json` profile set `"autoIncrement"`. Every tagged release
 * therefore built the identical `versionCode 1`. Android refuses to install an
 * APK whose `versionCode` is not strictly greater than the one already on the
 * device, so the SECOND internal build a tester receives fails with
 * `INSTALL_FAILED_VERSION_DOWNGRADE` on the tester's device.
 *
 * TWO CANDIDATES WERE WEIGHED:
 *
 * 1. `"autoIncrement": true` on `eas.json`'s `production-apk` profile — the
 *    smallest possible diff. REJECTED, for a reason sharper than "it is a
 *    second source of truth against the git tag" (the general T230 shape):
 *    `eas.json`'s `cli.appVersionSource` here is `"local"` (unchanged by this
 *    task), and EAS's own documented behaviour for `autoIncrement` under
 *    `"local"` is to bump the versionCode IN THE LOCAL PROJECT FILES after a
 *    build and leave committing that change back to git as the caller's job —
 *    it does not push, and it does not track a durable counter of its own.
 *    `.github/workflows/android-apk-release.yml`'s `publish-android-apk` job
 *    checks out an IMMUTABLE git tag fresh for every run
 *    (`ref: ${{ env.RELEASE_TAG }}`) and never commits or pushes anything back
 *    to that tag or to `main`. So the bumped value would live only in that
 *    run's ephemeral runner and vanish when the job ends; the next tagged
 *    release starts over from whatever `versionCode` is committed AT ITS OWN
 *    tag — the same base this file declares, since nothing ever wrote the
 *    increment back — and would build the same `versionCode` again, not a
 *    strictly greater one. `"autoIncrement": true` under `"local"` source does
 *    not merely add a second source of truth here; given this repository's
 *    specific immutable-tag, no-push-back CI trigger, it does not accumulate
 *    at all, so it would not durably fix the defect it exists to fix.
 *
 *    (The alternative half of this candidate, switching
 *    `cli.appVersionSource` to `"remote"` so EAS's servers hold a durable
 *    counter that survives ephemeral checkouts, was also rejected: that
 *    counter lives entirely on EAS's servers, shared across every profile and
 *    every trigger — including a `workflow_dispatch` run pointed at an
 *    arbitrary tag — so the sequence of versionCodes it produces no longer
 *    corresponds 1:1 with this repository's release tags, and nothing in this
 *    git history records which counter value shipped with which tag.)
 *
 * 2. A tag-derived `versionCode`, computed deterministically from this file's
 *    own semver `version` string via `computeVersionCodeFromSemver` below.
 *    CHOSEN. It needs no new state anywhere — not in EAS, not threaded through
 *    `.github/workflows/android-apk-release.yml`'s job env (which this task
 *    may not edit, and which would not reach a remote EAS build unless
 *    declared in an `eas.json` profile's own `env` block regardless — EAS
 *    evaluates `app.config.ts` on its OWN build machine against the uploaded
 *    archive, not the GitHub Actions runner's shell environment). It is
 *    reproducible from `git show <tag>:apps/android/app.config.ts` alone, with
 *    no EAS API call required to know what versionCode a given tag will
 *    build.
 *
 * SINGLE SOURCE OF TRUTH: the `version` string declared a few lines below in
 * this same file. This repository's release tags (`v*`, `android-v*`) are
 * meant to move in lockstep with that string — bumping `version` before
 * cutting a release tag is the same discipline any semver-tagged project
 * already requires, and this task does not add a new one. Nothing here
 * automates that bump; enforcing "the tag matches `version`" was a workflow
 * change and out of this task's `app.config.ts`/`eas.json`-only scope. T247
 * has since made that enforcement real — see the note replacing the gap
 * below.
 *
 * TWO EDGE CASES THE TASK NAMES EXPLICITLY:
 *
 * - A build that is not from a release tag (the `development` and `preview`
 *   EAS profiles, or a `workflow_dispatch` run against a non-release ref):
 *   still gets a deterministic `versionCode` from whatever `version` is
 *   checked out at that commit. Two such ad hoc builds from the same
 *   commit/version therefore share a versionCode — acceptable, because those
 *   profiles are for internal ad hoc testing rather than the sequential
 *   install chain this defect is about (only `production-apk` is what
 *   `android-apk-release.yml` builds and testers install serially); a same-
 *   versionCode reinstall already requires `adb install -r`/uninstall-first
 *   regardless of how that versionCode was produced, so this is a pre-existing
 *   Android behaviour, not a new failure mode.
 * - A re-run of the same tag (e.g. `android-apk-release.yml`'s
 *   `workflow_dispatch` input re-pointed at an already-built tag): produces
 *   the identical `versionCode`, by design — the tag's `version` has not
 *   changed, so rebuilding it should reproduce the same release identity, not
 *   mint a new one. This is idempotent rebuild behaviour, not a collision to
 *   guard against.
 *
 * GAP CLOSED by T247 (P9-E). This block previously said "GAP FILED ... nothing
 * enforces that a human actually bumps `version` before pushing a new release
 * tag", and described the fix as a CI step failing the release job when this
 * file's `version` does not match the release tag stripped of its
 * `v`/`android-v` prefix. T247 shipped exactly that:
 * `scripts/ci/guard-android-release-tag-version.mjs`, run as a step in
 * `.github/workflows/android-apk-release.yml` before `npm ci`, which exits 1
 * naming both values when they disagree and also rejects a release tag with
 * no recognized shape. What remains unautomated is only the bump itself —
 * nothing writes the new `version` for you; the tag/version disagreement this
 * block used to permit is now a hard failure.
 */
const version = "0.1.0";

/**
 * Deterministic `major.minor.patch` -> Android `versionCode` mapping. See the
 * decision record above for why this exists instead of `eas.json`'s
 * `"autoIncrement"`.
 *
 * Scheme: `major * 1_000_000 + minor * 1_000 + patch`. Google Play's ceiling
 * on `versionCode` is 2_100_000_000, so this leaves headroom for `major` up
 * to 2099 with `minor`/`patch` each under 1000 — comfortably wider than this
 * project will plausibly reach, without needing to revisit the scheme.
 */
function computeVersionCodeFromSemver(semver: string): number {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(semver);
  if (match === null) {
    throw new Error(
      `apps/android/app.config.ts: "version" must be a plain "major.minor.patch" string to derive an Android versionCode from it; got ${JSON.stringify(semver)}.`,
    );
  }
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (minor >= 1000 || patch >= 1000) {
    throw new Error(
      `apps/android/app.config.ts: versionCode derivation caps "minor" and "patch" at 999 each (got ${minor}.${patch} from ${JSON.stringify(semver)}); widen computeVersionCodeFromSemver's multipliers before releasing this version.`,
    );
  }
  const versionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0 || versionCode > 2_100_000_000) {
    throw new Error(
      `apps/android/app.config.ts: derived Android versionCode ${versionCode} is out of range for ${JSON.stringify(semver)}.`,
    );
  }
  return versionCode;
}

const config: ExpoConfig = {
  name: isDevelopmentClient ? "Pi Companion (Dev)" : "Pi Companion",
  slug: "pi-companion",
  scheme: "picompanion",
  version,
  orientation: "default",
  userInterfaceStyle: "automatic",
  // No `newArchEnabled` toggle either: it does not appear anywhere in the
  // installed `@expo/config-types` (57.0.2) or `expo` (57.0.18) trees
  // (`grep -rn "newArchEnabled" node_modules/@expo node_modules/expo` finds
  // nothing) — the legacy architecture is gone in this installed SDK line,
  // so New Architecture is unconditional and the flag was removed outright
  // rather than deprecated with a runtime warning the way `edgeToEdgeEnabled`
  // was above. Dropping it changes nothing at runtime; it stops a TS2353.
  platforms: ["android"],
  android: {
    package: isDevelopmentClient ? "sh.picompanion.debug" : "sh.picompanion",
    // T235: derived from `version` above, never hand-maintained — see the
    // decision record above `computeVersionCodeFromSemver` for why.
    versionCode: computeVersionCodeFromSemver(version),
    // No `edgeToEdgeEnabled` toggle: the installed `@expo/config-types`
    // (57.0.2, resolved from the actually-installed `expo` 57.0.18 — newer
    // than this package.json's declared `^54.0.18` range, T116) dropped the
    // property from `Android` entirely (TS2353), and
    // `@expo/prebuild-config`'s `withEdgeToEdge` plugin now warns at build
    // time that "`edgeToEdgeEnabled` customization is no longer available -
    // Android 16 makes edge-to-edge mandatory. Remove the `edgeToEdgeEnabled`
    // entry from your app.json/app.config.js." Edge-to-edge stays enabled —
    // it is now unconditional — this just stops declaring the removed toggle.
    //
    // Built inline (not via `buildShareIntentFilters()` — see the doc
    // comment above): one `SEND` filter for `text/plain`, one `SEND`
    // filter whose `data` lists every entry of `acceptedFileMimeTypes`
    // (the same JSON `share-intent-model.ts`'s `ACCEPTED_FILE_MIME_TYPES`
    // derives from) — never more, never fewer. `share-intent-config.
    // test.ts` asserts this exact array against both sources.
    intentFilters: [
      {
        action: "SEND",
        category: ["DEFAULT"],
        data: [{ mimeType: "text/plain" }],
      },
      {
        action: "SEND",
        category: ["DEFAULT"],
        data: acceptedFileMimeTypes.map((mimeType) => ({ mimeType })),
      },
    ] satisfies ShareIntentFilter[],
  },
  // T290: no `expo-image-picker`/`expo-document-picker` plugin entry —
  // a deliberate decision, not an oversight, measured directly against
  // each package's own Android config plugin source before deciding:
  //
  // - `expo-document-picker`'s config plugin
  //   (`plugin/build/withDocumentPicker.js`) only calls `with
  //   DocumentPickerIOS` — it is iOS-only and a no-op for this
  //   Android-only app (`platforms: ["android"]` above).
  // - `expo-image-picker`'s config plugin
  //   (`plugin/build/withImagePicker.js`) has exactly one Android-side
  //   effect at DEFAULT options: `withAndroidImagePickerPermissions`
  //   ADDS `android.permission.RECORD_AUDIO` (for the library's video
  //   capture feature, which `./expo-camera-capture-port.ts` never
  //   uses — it only calls `launchCameraAsync` for still photos). This
  //   app has no reason to request a real, privacy-sensitive
  //   microphone permission this feature never needs.
  //
  // The `CAMERA` permission `expo-camera-capture-port.ts` actually
  // needs is already granted with NO plugin entry at all: it comes from
  // `expo-image-picker`'s own bundled `AndroidManifest.xml`
  // (`<uses-permission android:name="android.permission.CAMERA" />`),
  // which Android's own manifest merger includes automatically for
  // every installed native module regardless of this `plugins` array —
  // that array is for `app.config.ts`-driven modifications to generated
  // native files, not for admitting a dependency's own bundled
  // manifest. Adding the plugin here with default options would add
  // `RECORD_AUDIO` — a regression, not an improvement — for zero
  // capability gained. If a future feature genuinely needs the plugin
  // (e.g. custom iOS permission copy, were this app ever to grow an iOS
  // target), add it with `{ microphonePermission: false }` explicitly,
  // never with default options.
  plugins: ["expo-router", "./plugins/with-share-intent-module"],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
