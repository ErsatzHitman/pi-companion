import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T301 source-level coverage for `SettingsScreen.tsx`'s devices/
 * diagnostics navigation rows.
 *
 * `react-native` component modules can't be rendered under this
 * workspace's plain `vitest` setup (the "RN-in-vitest limitation" this
 * repo's `CLAUDE.md` names) — like `DevicesScreen.test.ts` and
 * `DiagnosticsScreen.test.ts`, this statically verifies the source
 * contracts a render pass would otherwise check. The real navigation
 * behaviour (the href each row navigates to) is unit tested directly in
 * `settings-navigation-model.test.ts`.
 */
function readScreenSource(): string {
  return readFileSync(fileURLToPath(new URL("./SettingsScreen.tsx", import.meta.url)), "utf8");
}

/** Comment-stripped: this file's own doc comments quote several of the strings/identifiers the assertions below look for. */
function readScreenCode(): string {
  return readScreenSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * Isolates one top-level function's body by splitting on every top-level
 * `function` declaration and returning the chunk starting with `name` —
 * matches this repo's own `QueueModePicker.test.ts` convention. A lazy
 * `[\s\S]*?\n\}` span (this test's own first draft) stops at the FIRST
 * `\n}`, which is the destructured-parameter list's closing brace, not
 * the function body's — this avoids that trap.
 */
function readFunctionCode(code: string, name: string): string {
  const body = code
    .split(/^(?:export default |export )?function /m)
    .map((part) => `function ${part}`)
    .find((part) => part.startsWith(`function ${name}(`));
  expect(body, `SettingsScreen.tsx should declare a top-level function ${name}`).toBeDefined();
  return body ?? "";
}

describe("SettingsScreen source", () => {
  const code = readScreenCode();

  it("declares onOpenDevices and onOpenDiagnostics as optional callback props, never importing a router", () => {
    expect(code).toMatch(/onOpenDevices\?:\s*\(\)\s*=>\s*void;/);
    expect(code).toMatch(/onOpenDiagnostics\?:\s*\(\)\s*=>\s*void;/);
    expect(code).not.toMatch(/from\s+["']expo-router["']/);
    expect(code).not.toMatch(/useRouter/);
  });

  it("renders the Devices row only when onOpenDevices is supplied, never unconditionally", () => {
    const body = readFunctionCode(code, "SettingsScreen");
    expect(body).toMatch(/\{onOpenDevices \? \(\s*<NavRow\s+label="Devices"/);
    expect(body).toMatch(/onPress=\{onOpenDevices\}/);
  });

  it("renders the Diagnostics row only when onOpenDiagnostics is supplied, never unconditionally", () => {
    const body = readFunctionCode(code, "SettingsScreen");
    expect(body).toMatch(/\{onOpenDiagnostics \? \(\s*<NavRow\s+label="Diagnostics"/);
    expect(body).toMatch(/onPress=\{onOpenDiagnostics\}/);
  });

  it("gates the whole More section on either callback being present, not a hand-typed true", () => {
    expect(code).toMatch(/\{onOpenDevices \|\| onOpenDiagnostics \? \(/);
    expect(code).toMatch(/<Section title="More"/);
  });

  it("proves each row independently — one prop passing must not stand in for the other", () => {
    // Deleting onOpenDevices's own conditional must not delete
    // onOpenDiagnostics's, and vice versa: both markers must exist as
    // two SEPARATE occurrences, not one shared guard.
    const devicesRowMatches = [...code.matchAll(/onOpenDevices \? \(/g)];
    const diagnosticsRowMatches = [...code.matchAll(/onOpenDiagnostics \? \(/g)];
    expect(devicesRowMatches.length).toBeGreaterThanOrEqual(1);
    expect(diagnosticsRowMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("is a named, importable export", () => {
    expect(code).toMatch(/export function SettingsScreen\(/);
  });

  it("uses only theme tokens for colour, never a raw hex literal", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).toMatch(/theme\.colors\./);
  });

  it("gives the NavRow a real 48dp touch target, matching this app's other pressables", () => {
    const navRowBody = readFunctionCode(code, "NavRow");
    expect(navRowBody).toMatch(/style=\{styles\.touchArea\}/);
    const navRowStylesBody = readFunctionCode(code, "createNavRowStyles");
    expect(navRowStylesBody).toMatch(/touchArea:\s*\{\s*minHeight:\s*48/);
  });

  it("gives the NavRow a real accessible label and button role, not a bare Text row", () => {
    const navRowBody = readFunctionCode(code, "NavRow");
    expect(navRowBody).toMatch(/accessibilityRole="button"/);
    expect(navRowBody).toMatch(/accessibilityLabel=\{label\}/);
  });
});
