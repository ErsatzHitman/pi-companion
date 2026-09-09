// @ts-check
// Android-only Metro configuration — plan.md §6, §9.1.
//
// `apps/android` never targets web (or iOS): resolvable platforms are
// restricted to `android`, and any `*.web.*` file OF THIS APP'S OWN is
// blocked from resolution outright, even if nothing imports it yet. This is
// a runtime backstop; `scripts/guard-no-web-artifacts.mjs` is the
// authoritative, testable check wired into `npm run build`.
//
// CORRECTED (T314): this said "any `*.web.*` source file", unqualified, and
// the pattern below matched that description — including every dependency's
// files, which broke a correct `react-native-reanimated` import and failed
// the first real EAS build's bundle. See the block patterns' own comment.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

// No `@type` JSDoc annotation here: `import("expo/metro-config").MetroConfig` names
// the public `InputConfigT` — the caller-supplied, deeply-`Readonly<Partial<...>>`
// shape Metro accepts as input — not what `getDefaultConfig()` actually returns.
// Annotating `config` with that type made every mutation below fail to type-check
// (TS2540 assigning to a read-only property, TS7006 implicit-`any` callback
// parameters with no contextual type to infer from, and a TS2300 duplicate
// identifier from the resulting conflicting `resolver` shapes) even though the
// real return type of `getDefaultConfig()` (see `@expo/metro-config`'s
// `ExpoMetroConfig.d.ts`) has concrete, mutable fields for exactly what this file
// assigns. Leaving `config` to its inferred (accurate) type lets tsc check these
// assignments for real instead of against a type that was never applicable here.
const config = getDefaultConfig(__dirname);

config.resolver.platforms = ["android"];

// Pin every `react-native` resolution to this app's own pinned copy.
//
// This is an npm workspace, and `packages/expo-two-way-audio` declares a
// loose `react-native: "*"` peerDependency. That can cause npm to hoist a
// second, newer `react-native` to the repo root alongside the copy pinned
// in this app's `package.json`. Metro's default Node-style module
// resolution walks up from the *importing* file's directory, so a
// dependency that itself got hoisted to the repo root (rather than nested
// under `apps/android/node_modules`) can resolve deep `react-native/...`
// imports against the root-hoisted copy instead of this app's, pulling in
// Flow-typed source Metro cannot parse. Force every `react-native` request,
// from any importer, through this app's local copy so root-level hoisting
// elsewhere in the workspace can never change what gets bundled.
const REACT_NATIVE_ORIGIN = path.join(__dirname, "node_modules", "react-native", "package.json");
const defaultResolveRequest = config.resolver.resolveRequest;

// T314: resolve a relative `./x.js` import against `x.ts`/`x.tsx` when no
// literal `x.js` exists.
//
// `tsconfig.json` here sets `moduleResolution: "bundler"`, and both `tsc`
// and Vitest rewrite a `.js` specifier onto the `.ts` file next to it. Metro
// does not: it appends its `sourceExts` to the specifier as given, so
// `daemon-connection-store.js` is looked up as
// `daemon-connection-store.js.ts`, `daemon-connection-store.js.tsx`, ... and
// then as a literal `daemon-connection-store.js`, none of which exist. The
// convention had spread to 207 imports across 82 non-test files under
// `src/` before anything noticed, because NOTHING IN CI EVER BUNDLED THIS
// APP -- `android-tests` runs `expo prebuild --no-install`, `tsc` and
// vitest, and not one of those three resolves a module the way Metro does.
// The first real EAS build (T311's, run 34369364166) died at `Bundle
// JavaScript` on the first such import Metro happened to reach.
//
// The shim rather than 207 edits, deliberately: `packages/*` are Node ESM
// and REQUIRE the `.js` specifier, so stripping it here would leave this
// repository with two opposite conventions and no mechanical way to tell
// which applies in a given file. `ci.yml`'s `android-tests` job, in its
// "Android bundle smoke (Metro resolution)" step, is the part that keeps
// this honest -- the shim makes today's imports resolve, but only a real
// bundle proves the next one does.
//
// Order matters: the literal specifier is tried FIRST, so a real `.js` file
// on disk (in `node_modules`, or this app's own `plugins/*.js`) still wins
// and this fallback only ever fires where resolution would otherwise fail.
const RELATIVE_JS_SPECIFIER = /^\.\.?\//;

/** @type {import("@expo/metro/metro-resolver").CustomResolver} */
const resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (moduleName === "react-native" || moduleName.startsWith("react-native/")) {
    return resolve({ ...context, originModulePath: REACT_NATIVE_ORIGIN }, moduleName, platform);
  }
  if (RELATIVE_JS_SPECIFIER.test(moduleName) && moduleName.endsWith(".js")) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.slice(0, -".js".length), platform);
    }
  }
  return resolve(context, moduleName, platform);
};

// T314: both block patterns below are scoped to THIS APP'S OWN `src/`.
//
// They used to match any absolute path Metro resolved, which included every
// dependency's files: `react-native-reanimated` ships
// `layoutReanimation/web/animation/Bounce.web.ts` and imports it from its
// own `config.ts`, so an unscoped `\.web\.` block made a real, correct
// third-party import unresolvable and failed the bundle. That was invisible
// for the same reason the `.js`-specifier defect above was -- nothing in CI
// ever bundled this app, so neither pattern had ever been applied to a
// dependency tree.
//
// Scoping matches what both patterns were always FOR, stated in their own
// comments: this app must ship no `.web.*` file of its own (plan.md §6,
// §9.1), and its own `*.test.*` files must not be swept into the bundle by
// Expo Router's `require.context`. Neither claim was ever about what a
// dependency ships. `apps/android/node_modules` is deliberately outside the
// scope too, which an `apps/android`-wide anchor would not have achieved.
const APP_SRC_PREFIX = path.join(__dirname, "src");

/** @param {string} value */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const APP_SRC_ANCHOR = `^${escapeRegExp(APP_SRC_PREFIX)}[\\\\/]`;

const WEB_FILE_BLOCK_PATTERN = new RegExp(`${APP_SRC_ANCHOR}.*\\.web\\.[^/\\\\.]+$`);

// Test sources are never part of a shipped Android bundle, and must be blocked
// from resolution outright rather than merely left unimported: Expo Router builds
// its route tree from a `require.context` over the whole router root, so a
// `*.test.ts` sitting next to the component it covers is pulled into the bundle as
// if it were a route. Several of this app's source-level contract tests read their
// subject via `new URL(..., import.meta.url)`, which Hermes rejects, so without
// this `expo export --platform android` fails outright.
const TEST_FILE_BLOCK_PATTERN = new RegExp(`${APP_SRC_ANCHOR}.*\\.(?:test|spec)\\.[^/\\\\.]+$`);

const existingBlockList = config.resolver.blockList;
const existingBlockListPatterns = Array.isArray(existingBlockList)
  ? existingBlockList
  : existingBlockList
    ? [existingBlockList]
    : [];

config.resolver.blockList = [
  ...existingBlockListPatterns,
  WEB_FILE_BLOCK_PATTERN,
  TEST_FILE_BLOCK_PATTERN,
];

// `resolver.resolveRequest` is the one field here Metro's own types declare
// read-only (`ConfigT.resolver: Readonly<ResolverConfigT>`, unlike `platforms`
// and `blockList` above, which `getDefaultConfig()`'s richer return type widens
// back to mutable). Rather than writing through the read-only property — which
// only "works" because Metro's runtime object isn't actually frozen — produce a
// new config object with the override applied, which is what a read-only type
// is asking for and changes nothing Metro reads at runtime.
module.exports = {
  ...config,
  resolver: {
    ...config.resolver,
    resolveRequest,
  },
};
