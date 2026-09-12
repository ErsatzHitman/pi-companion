import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `/h/:serverId/devices` route coverage (T42A1) — same shape as
 * `diagnostics.test.ts`: this module imports `expo-router`, which is not
 * installed in this workspace, so it cannot be rendered here.
 *
 * `readCode()` strips comments before matching — this file's own route
 * docstring names `DevicesScreen`, `core.connection`, and
 * `getActiveLifecycle`, so an unanchored match against the raw source
 * would stay green even if every real JSX prop were deleted.
 */
function readSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const source = readSource("./devices.tsx");
const code = stripComments(source);

describe("DevicesRoute source", () => {
  it("mounts the real DevicesScreen from features/devices", () => {
    expect(code).toMatch(/from "\.\.\/\.\.\/\.\.\/features\/devices"/);
    expect(code).toMatch(/<DevicesScreen\b/);
  });

  it("passes the real fixed daemon clientId, never a re-typed literal", () => {
    expect(code).toMatch(
      /import \{ ANDROID_DAEMON_CLIENT_ID \} from "\.\.\/\.\.\/\.\.\/app-shell\/core"/,
    );
    expect(code).toMatch(/thisClientId=\{ANDROID_DAEMON_CLIENT_ID\}/);
    expect(code).not.toMatch(/thisClientId="picompanion-android"/);
  });

  it("re-reads the live daemon client on every call, never closing over one instance", () => {
    expect(code).toMatch(/getClient=\{\(\)\s*=>/);
    expect(code).toMatch(/core\.connection\.getActiveLifecycle\(\)\?\.getDaemonClient\(\)/);
    expect(code).not.toMatch(/const\s+client\s*=\s*core\.connection\.getActiveLifecycle/);
  });

  it("wires reconnects to refresh both the device list and the push status", () => {
    expect(code).toMatch(/subscribeToConnectionChanges=\{\(onChange\)\s*=>/);
    expect(code).toMatch(/core\.connection\.subscribe\(\(\)\s*=>\s*onChange\(\)\)/);
  });

  it("reads push permission status from the real expo-notifications port, not a fabricated stub (T391)", () => {
    expect(code).toMatch(
      /import \{ createExpoPushRegistrationPort \} from "\.\.\/\.\.\/\.\.\/features\/notifications\/expo-push-registration-port"/,
    );
    expect(code).toMatch(/const pushPort = createExpoPushRegistrationPort\(\);/);
    expect(code).toMatch(/getPermissionStatus=\{\(\)\s*=>\s*pushPort\.getPermissionStatus\(\)\}/);
  });

  it("reads registration state off the real AppCore pushRegistration controller", () => {
    expect(code).toMatch(
      /isRegistered=\{\(\)\s*=>\s*core\.pushRegistration\.getLastRegisteredToken\(\) !== null\}/,
    );
  });

  it("still reads serverId from the route params, proving the route resolves", () => {
    expect(code).toMatch(/useLocalSearchParams/);
  });

  it("is a default export, as expo-router's file-based routing requires", () => {
    expect(code).toMatch(/export default function DevicesRoute\(\)/);
  });

  it("documents the real Settings-tab entry point, not the old 'not tapped to' disclosure (T301)", () => {
    // CORRECTED (T301): this test used to pin the OPPOSITE claim — "Not
    // tapped to from anywhere in the app yet". T301 wired the Settings
    // row this comment already named, so pin the capability that now
    // exists instead of the old disclosure.
    expect(source).not.toMatch(/Not tapped to from anywhere in the app yet/);
    expect(source).toMatch(/Reachable from the Settings tab \(T301\)/);
  });
});
