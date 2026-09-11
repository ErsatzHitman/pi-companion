import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/h/:serverId/settings` route coverage — T32S1C stubbed it against
 * `RoutePlaceholder`; T32S11 (P5-W16) mounts the real `SettingsScreen`
 * T32C1 built. Source-level contract test, same reason as
 * `sessions.test.ts`: this module imports `expo-router`.
 *
 * `readCode()` strips comments before matching — this file's own doc
 * comment names `SettingsScreen`/`core.keyValueStorage`, so an
 * unanchored match against the raw source would stay green even if the
 * real JSX props were deleted.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./settings.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("SettingsRoute source", () => {
  it("imports SettingsScreen from features/settings rather than the placeholder", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/features\/settings"/);
    expect(readCode()).toMatch(/<SettingsScreen\b/);
    expect(readCode()).not.toMatch(/RoutePlaceholder/);
  });

  it("passes the real keyValueStorage from useAppCore(), not a fake", () => {
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/core-context"/);
    expect(readCode()).toMatch(/const core = useAppCore\(\);/);
    expect(readCode()).toMatch(/storage=\{core\.keyValueStorage\}/);
  });

  it("still reads serverId from the route params, proving the route resolves", () => {
    expect(readCode()).toMatch(/useLocalSearchParams/);
    expect(readCode()).toMatch(/serverId/);
  });

  it("wires onOpenDevices through the real router and the shared navigation model (T301)", () => {
    expect(readCode()).toMatch(/import \{[\s\S]*?SettingsScreen,[\s\S]*?\}\s*from/);
    expect(readCode()).toMatch(/pressOpenDevices,/);
    expect(readCode()).toMatch(/pressOpenDiagnostics,?/);
    expect(readCode()).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/features\/settings"/);
    expect(readCode()).toMatch(/const router = useRouter\(\);/);
    expect(readCode()).toMatch(
      /onOpenDevices=\{\(\)\s*=>\s*pressOpenDevices\(router,\s*serverId\)\}/,
    );
  });

  it("wires onOpenDiagnostics through the real router and the shared navigation model (T301)", () => {
    expect(readCode()).toMatch(
      /onOpenDiagnostics=\{\(\)\s*=>\s*pressOpenDiagnostics\(router,\s*serverId\)\}/,
    );
  });

  it("never builds a devices/diagnostics href by hand — both go through the shared model", () => {
    // Guards against a regression that inlines a template-string href
    // (e.g. `/h/${serverId}/devices`) directly in this route file
    // instead of going through settings-navigation-model.ts, which is
    // what keeps SettingsScreen itself router-free.
    expect(readCode()).not.toMatch(/`\/h\/\$\{serverId\}/);
  });
});

describe("settings route: A3's host row and close action (T366)", () => {
  it("reads the saved profile from the same credential store the rest of the app uses", () => {
    const code = readCode();
    expect(code).toMatch(
      /import \{ listHostProfiles \} from "\.\.\/\.\.\/\.\.\/\.\.\/features\/connect\/credential-store";/,
    );
    expect(code).toMatch(/profiles\.find\(\(profile\) => profile\.id === serverId\)/);
  });

  it("passes on only the four non-secret fields", () => {
    // A password or a relay key has no business crossing into a
    // component that draws.
    const code = readCode();
    expect(code).toMatch(
      /label: match\.label,\s*endpoint: match\.endpoint,\s*kind: match\.kind,\s*useTls: match\.useTls,/,
    );
    expect(code).not.toMatch(/password/);
    expect(code).not.toMatch(/relayKey/);
  });

  it("fences the read so an abandoned one cannot land on a later mount", () => {
    const code = readCode();
    expect(code).toMatch(/if \(cancelled\) return;/);
    expect(code).toMatch(/return \(\) => \{\s*cancelled = true;\s*\};/);
  });

  it("feeds the pill the live phase, and closes only where it can", () => {
    const code = readCode();
    expect(code).toMatch(/const \{ phase \} = useConnectionStatus\(core\.connection\);/);
    expect(code).toMatch(/connectionPhase=\{phase\}/);
    expect(code).toMatch(/onClose=\{canClose \? handleClose : undefined\}/);
  });
});
