// @ts-check
// Android-only Metro configuration — plan.md §6, §9.1.
//
// `apps/android` never targets web (or iOS): resolvable platforms are
// restricted to `android`, and any `*.web.*` source file is blocked from
// resolution outright, even if nothing imports it yet. This is a runtime
// backstop; `scripts/guard-no-web-artifacts.mjs` is the authoritative,
// testable check wired into `npm run build`.
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

/** @type {import("@expo/metro/metro-resolver").CustomResolver} */
const resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (moduleName === "react-native" || moduleName.startsWith("react-native/")) {
    return resolve({ ...context, originModulePath: REACT_NATIVE_ORIGIN }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

const WEB_FILE_BLOCK_PATTERN = /\.web\.[^/\\.]+$/;

// Test sources are never part of a shipped Android bundle, and must be blocked
// from resolution outright rather than merely left unimported: Expo Router builds
// its route tree from a `require.context` over the whole router root, so a
// `*.test.ts` sitting next to the component it covers is pulled into the bundle as
// if it were a route. Several of this app's source-level contract tests read their
// subject via `new URL(..., import.meta.url)`, which Hermes rejects, so without
// this `expo export --platform android` fails outright.
const TEST_FILE_BLOCK_PATTERN = /\.(?:test|spec)\.[^/\\.]+$/;

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
