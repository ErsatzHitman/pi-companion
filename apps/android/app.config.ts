import type { ExpoConfig } from "expo/config";

import { buildShareIntentFilters } from "./src/features/share/share-intent-config.js";

// `@expo/config-types`' `ExpoConfig["plugins"]` (this app's pinned
// version) only types a plugin entry as a resolvable path string, not a
// direct `ConfigPlugin` function reference — even though Expo's mod
// compiler accepts either at runtime. The string form below is also the
// more common, officially-documented way to declare a local plugin
// (Expo resolves it via `resolveConfigPluginFunction`, requiring the
// resolved module's default export to be the `ConfigPlugin` — exactly
// what `./plugins/with-share-intent-module.ts` exports), so this is not
// a workaround, just the form the type declares.

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
 * `android.intentFilters` below (T36E, plan.md §9.3) is built by
 * `buildShareIntentFilters()` rather than written out here, so this
 * declaration structurally cannot list a MIME type
 * `classifyShareIntent` (`src/features/share/share-intent-model.ts`)
 * would then refuse — see that helper's doc comment and
 * `share-intent-receiver.ts`'s doc comment for the full route decision.
 * Registering these filters makes the OS *offer* this app as a share
 * target; it does not by itself make a share reach any JS code — that
 * still needs the native listener named as a gap in
 * `share-intent-receiver.ts`.
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
    intentFilters: buildShareIntentFilters(),
  },
  plugins: ["expo-router", "./plugins/with-share-intent-module"],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
