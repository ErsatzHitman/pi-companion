import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `/h/:serverId/diagnostics` route coverage — added by the P7-W7 merge
 * gate, which mounted the `DiagnosticsScreen` T42A3 built. Source-level
 * contract test, same reason as `(tabs)/settings.test.ts`: this module
 * imports `expo-router`, which is not installed in this workspace, so it
 * cannot be rendered here.
 *
 * `readCode()` strips comments before matching — this file's own route
 * docstring names `DiagnosticsScreen`, `core.connection` and
 * `getActiveLifecycle`, so an unanchored match against the raw source
 * would stay green even if every real JSX prop were deleted.
 */
function readSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = readSource("./diagnostics.tsx");
const code = stripComments(source);
const coreCode = stripComments(readSource("../../../app-shell/core.ts"));

describe("DiagnosticsRoute source", () => {
  it("mounts the real DiagnosticsScreen from features/diagnostics, not the placeholder", () => {
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/features\/diagnostics"/);
    expect(code).toMatch(/<DiagnosticsScreen\b/);
    expect(code).not.toMatch(/RoutePlaceholder/);
  });

  it("passes the real connection store from useAppCore() as the connection source", () => {
    expect(code).toMatch(/from "\.\.\/\.\.\/core-context"/);
    expect(code).toMatch(/const core = useAppCore\(\);/);
    expect(code).toMatch(/connectionSource=\{core\.connection\}/);
  });

  it("re-reads the live daemon client on every call, never closing over one instance", () => {
    // A reconnect swaps in a new client, so the arrow must call
    // getActiveLifecycle() itself rather than capture a client above.
    expect(code).toMatch(/getDaemonClient=\{\(\)\s*=>/);
    expect(code).toMatch(/core\.connection\.getActiveLifecycle\(\)\?\.getDaemonClient\(\)/);
    expect(code).not.toMatch(/const\s+client\s*=\s*core\.connection\.getActiveLifecycle/);
  });

  it("supplies the real Sharing implementation so the export control actually renders", () => {
    // `sharing` is optional on the screen and omitting it renders NO
    // export affordance at all. A real one exists on AppCore, so the
    // omitted branch would be the wrong branch here.
    expect(code).toMatch(/sharing=\{core\.sharing\}/);
  });

  it("passes the resolved cold-start host profile rather than a hand-built object", () => {
    expect(code).toMatch(/const profile = useColdStartProfile\(\);/);
    expect(code).toMatch(/profile=\{profile\}/);
  });

  it("reads the identity constants core really connects with, never re-typed literals", () => {
    expect(code).toMatch(
      /import \{ ANDROID_DAEMON_APP_VERSION, ANDROID_DAEMON_CLIENT_ID \} from "\.\.\/\.\.\/\.\.\/app-shell\/core"/,
    );
    expect(code).toMatch(/appVersion=\{ANDROID_DAEMON_APP_VERSION\}/);
    expect(code).toMatch(/clientId=\{ANDROID_DAEMON_CLIENT_ID\}/);
    // The whole point of the shared constants: a diagnostics screen that
    // re-typed these would drift from what `hello` actually sends.
    expect(code).not.toMatch(/appVersion="[\d.]+"/);
    expect(code).not.toMatch(/clientId="picompanion-android"/);
  });

  it("still reads serverId from the route params, proving the route resolves", () => {
    expect(code).toMatch(/useLocalSearchParams/);
  });

  it("is a default export, as expo-router's file-based routing requires", () => {
    expect(code).toMatch(/export default function DiagnosticsRoute\(\)/);
  });
});

describe("the identity constants this route reads", () => {
  it("are exported by app-shell/core.ts", () => {
    expect(coreCode).toMatch(/export const ANDROID_DAEMON_CLIENT_ID = "picompanion-android";/);
    expect(coreCode).toMatch(/export const ANDROID_DAEMON_APP_VERSION = "[\d.]+";/);
  });

  it("are what core actually builds its daemon connections with", () => {
    // Both construction sites (the direct-connect attempt and
    // reconnectHostProfile) must use the constant. A bare literal at
    // either one is exactly the drift this route's screen would then
    // report incorrectly.
    expect(coreCode).not.toMatch(/appVersion: "[\d.]+"/);
    expect(coreCode.match(/appVersion: ANDROID_DAEMON_APP_VERSION/g)).toHaveLength(2);
    expect(coreCode.match(/clientId: ANDROID_DAEMON_CLIENT_ID/g)).toHaveLength(2);
  });
});
