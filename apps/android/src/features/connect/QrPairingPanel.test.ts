import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `QrPairingPanel.tsx` source-level contract — T32A8. Source-text only,
 * same reason as `connection-shell.test.ts`: this module imports
 * `react-native` (`../../CLAUDE.md`'s "VITEST LIMITATION" note). Every
 * rule the two new affordances below actually enforce (which
 * `PermissionState` maps to which `QrScanPhase`, and what
 * `handleScannedText` does with a payload) is already proven in
 * `qr-scan-model.test.ts`; this file proves only that the component
 * actually wires that tested model to a real, driveable field/button —
 * matching this wave's "registration is not receipt" standard.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./QrPairingPanel.tsx", import.meta.url)), "utf8");
}

/** Strips comments before matching, so a doc comment naming a symbol (this file's own module docstring names `handleScannedText`, `"settings"`, `openSettings`, ...) can never itself satisfy an assertion about real code. */
function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("QrPairingPanel source", () => {
  // --- Manual-paste entry point (T32A8 / T37E1's filed gap) ------------

  it("renders a 'Pairing link' TextField with a stable testId, independent of scan phase", () => {
    expect(readCode()).toMatch(/<TextField[\s\S]*?label="Pairing link"/);
    expect(readCode()).toMatch(/testId=\{testId \? `\$\{testId\}-paste-input` : undefined\}/);
  });

  it("the paste TextField is controlled by its own pasteValue state, not snapshot-derived", () => {
    expect(readCode()).toMatch(/const \[pasteValue, setPasteValue\] = useState\(""\);/);
    expect(readCode()).toMatch(/value=\{pasteValue\}/);
    expect(readCode()).toMatch(/onChangeText=\{setPasteValue\}/);
  });

  it("the 'Pair' button calls controller.handleScannedText with the pasted value — the same entry point a real camera decode uses, not a second pipeline", () => {
    expect(readCode()).toMatch(
      /function handlePastePress\(\): void \{\s*void controller\.handleScannedText\(pasteValue\);\s*\}/,
    );
    expect(readCode()).toMatch(/label="Pair"/);
    expect(readCode()).toMatch(/onPress=\{handlePastePress\}/);
    expect(readCode()).toMatch(
      /testId=\{testId \? `\$\{testId\}-paste-input-pair-button` : undefined\}/,
    );
  });

  it("disables 'Pair' while empty or while a pairing attempt is already in flight", () => {
    expect(readCode()).toMatch(
      /disabled=\{pairingInFlight \|\| pasteValue\.trim\(\)\.length === 0\}/,
    );
    expect(readCode()).toMatch(/const pairingInFlight = snapshot\.phase === "pairing";/);
  });

  // --- "Open settings" affordance for the "settings" phase (T60E's filed seam) ---

  it("renders an 'Open settings' button only for the 'settings' phase, distinct from the 'denied'/'unavailable' retry button", () => {
    expect(readCode()).toMatch(/const showOpenSettings = snapshot\.phase === "settings";/);
    expect(readCode()).toMatch(/\{showOpenSettings \? \(\s*<Button[\s\S]*?label="Open settings"/);
    expect(readCode()).toMatch(
      /testId=\{testId \? `\$\{testId\}-open-settings-button` : undefined\}/,
    );
  });

  it("'Open settings' never reuses controller.retryPermission() — that would silently no-op against a permanently-denied permission", () => {
    const openSettingsBlock = readCode().match(
      /\{showOpenSettings \? \([\s\S]*?\)\s*: null\}/,
    )?.[0];
    expect(
      openSettingsBlock,
      "expected an { showOpenSettings ? (...) : null } block",
    ).toBeDefined();
    expect(openSettingsBlock).not.toMatch(/retryPermission/);
    expect(openSettingsBlock).toMatch(/onPress=\{handleOpenSettingsPress\}/);
  });

  it("handleOpenSettingsPress defaults to RN's Linking.openSettings(), and the openSettings prop overrides it", () => {
    expect(readCode()).toMatch(/import \{ Linking, StyleSheet, Text, View \} from "react-native";/);
    expect(readCode()).toMatch(
      /function handleOpenSettingsPress\(\): void \{\s*\(openSettings \?\? \(\(\) => Linking\.openSettings\(\)\)\)\(\);\s*\}/,
    );
  });

  it("declares openSettings as an optional prop, so a production caller (connection-shell.tsx) never has to pass one", () => {
    expect(readCode()).toMatch(/openSettings\?: \(\) => void;/);
  });

  it("showRetry still covers only 'denied'/'unavailable', never 'settings'", () => {
    expect(readCode()).toMatch(
      /const showRetry = snapshot\.phase === "denied" \|\| snapshot\.phase === "unavailable";/,
    );
  });
});
