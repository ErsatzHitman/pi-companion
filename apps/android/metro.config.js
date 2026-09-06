// Android-only Metro configuration — plan.md §6, §9.1.
//
// `apps/android` never targets web (or iOS): resolvable platforms are
// restricted to `android`, and any `*.web.*` source file is blocked from
// resolution outright, even if nothing imports it yet. This is a runtime
// backstop; `scripts/guard-no-web-artifacts.mjs` is the authoritative,
// testable check wired into `npm run build`.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
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

config.resolver.resolveRequest = (context, moduleName, platform) => {
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

module.exports = config;
