// @ts-check
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

/**
 * T330 — lets the release-variant app open `ws://` sockets at all.
 *
 * ## The defect this closes
 *
 * Android's default network security policy for an app targeting SDK 28
 * or later refuses every cleartext connection — plain `http://` and plain
 * `ws://` alike — unless the manifest opts in. Expo's prebuild template
 * opts the DEBUG build type in through its `src/debug/AndroidManifest.xml`
 * (`android:usesCleartextTraffic="true"`), and nothing else: the main
 * manifest carries no such attribute, so a release-variant build has no
 * cleartext permission. Measured, not assumed: the `assembleRelease` APK
 * Maestro run 34450130423 installed had neither `usesCleartextTraffic` nor
 * a `networkSecurityConfig` anywhere in its binary manifest's string pool.
 *
 * The product's primary connection path is exactly a cleartext socket: a
 * daemon on the owner's LAN, typed as `ws://192.168.x.x:<port>` — the
 * connect form's own placeholder — and the E2E harness's isolated daemon,
 * reached from the emulator as `ws://10.0.2.2:<port>`. Every one of that
 * run's seven connect-form flows failed on "Could not reach the daemon"
 * while the daemon's own metrics showed zero sockets ever arriving: the
 * OS refused the connection inside the app before a packet left it, and
 * the client's `"network"` substring mapped OkHttp's `CLEARTEXT
 * communication ... not permitted by network security policy` to the
 * unreachable copy. A release install on a real phone fails the same way
 * against a real LAN daemon; only `wss://` would ever have worked.
 *
 * ## Why the whole app, not a domain allowlist
 *
 * `android:networkSecurityConfig` can permit cleartext per DOMAIN, but a
 * LAN daemon has no fixed domain — it is whatever private address the
 * owner's machine holds, and the config format admits hostnames and
 * literal IPs only, never a CIDR range. The relay path is `wss://` and is
 * unaffected either way. Opting the application in is what `expo-build-
 * properties`' `usesCleartextTraffic` option does; this plugin sets the
 * same single attribute without adding a dependency, on the same
 * `<application>` element `AndroidConfig.Manifest.getMainApplicationOrThrow`
 * resolves for every other Expo manifest mod.
 *
 * Plain CommonJS JavaScript for the reason `with-share-intent-module.js`'s
 * doc comment gives (T204): the plugin resolver CI actually runs probes
 * `.js`, not `.ts`.
 */

/**
 * The pure core, exported for `with-cleartext-traffic.test.js`: sets
 * `android:usesCleartextTraffic="true"` on the main `<application>` and
 * returns the same manifest object. Throws when there is no main
 * application element — a manifest this cannot patch must fail prebuild,
 * not ship a release that silently cannot connect.
 *
 * @param {import("expo/config-plugins").AndroidConfig.Manifest.AndroidManifest} androidManifest
 * @returns {import("expo/config-plugins").AndroidConfig.Manifest.AndroidManifest}
 */
function setUsesCleartextTraffic(androidManifest) {
  const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  mainApplication.$["android:usesCleartextTraffic"] = "true";
  return androidManifest;
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withCleartextTraffic = (config) =>
  withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = setUsesCleartextTraffic(manifestConfig.modResults);
    return manifestConfig;
  });

module.exports = withCleartextTraffic;
module.exports.setUsesCleartextTraffic = setUsesCleartextTraffic;
