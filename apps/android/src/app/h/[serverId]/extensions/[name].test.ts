import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `/h/:serverId/extensions/:name` route coverage (ANDROID-EXT-1) — same
 * shape as `../devices.test.ts` and `../diagnostics.test.ts`: this
 * module imports `expo-router`, which is not installed in this
 * workspace, so it cannot be rendered here.
 *
 * `readCode()` strips comments before matching — this file's own route
 * docstring names `ExtensionDetailScreen` and `useLocalSearchParams`, so
 * an unanchored match against the raw source would stay green even if
 * the real JSX props were deleted.
 */
function readSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = readSource("./[name].tsx");
const code = stripComments(source);

describe("ExtensionDetailRoute source", () => {
  it("mounts the real ExtensionDetailScreen from features/settings", () => {
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/features\/settings"/);
    expect(code).toMatch(/<ExtensionDetailScreen\b/);
  });

  it("passes the name route param straight through, never a re-typed literal", () => {
    expect(code).toMatch(/const \{ name \} = useLocalSearchParams</);
    expect(code).toMatch(/name=\{name\}/);
  });

  it("reads serverId as a typed route param, proving the route resolves", () => {
    expect(code).toMatch(/useLocalSearchParams<\{ serverId: string; name: string \}>\(\);/);
  });

  it("offers back only where the router can actually go back", () => {
    expect(code).toMatch(/const canBack = router\.canGoBack\(\);/);
    expect(code).toMatch(/onBack=\{canBack \? handleBack : undefined\}/);
  });

  it("is a default export, as expo-router's file-based routing requires", () => {
    expect(code).toMatch(/export default function ExtensionDetailRoute\(\)/);
  });

  it("documents the real Settings-tab entry point (ANDROID-EXT-1)", () => {
    expect(source).toMatch(/Reachable from the Settings tab \(ANDROID-EXT-1\)/);
    expect(source).toMatch(/pressOpenExtension/);
  });
});
