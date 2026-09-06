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

const config: ExpoConfig = {
  name: isDevelopmentClient ? "Pi Companion (Dev)" : "Pi Companion",
  slug: "pi-companion",
  scheme: "picompanion",
  version: "0.1.0",
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
  plugins: ["expo-router", "./plugins/with-share-intent-module"],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
