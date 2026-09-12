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

function readPreviewSource(): string {
  return readFileSync(fileURLToPath(new URL("./expo-camera-preview.tsx", import.meta.url)), "utf8");
}

/** Strips comments before matching, so a doc comment naming a symbol (this file's own module docstring names `handleScannedText`, `"settings"`, `openSettings`, ...) can never itself satisfy an assertion about real code. */
function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Comment-stripped preview source — `expo-camera-preview.tsx`'s own doc comment names `${testId}-preview`, so an unstripped match would pass even if the JSX were deleted. */
function readPreviewCode(): string {
  return readPreviewSource()
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

  // --- Real camera preview in the "ready" phase (T392) ----------------

  it("resolves the scanner default to the real expo-camera port (T392), leaving the unavailable factory importable", () => {
    expect(readCode()).toMatch(/scanner: scanner \?\? createExpoCameraScannerPort\(\)/);
    expect(readCode()).toMatch(
      /import type \{ CameraScannerPort \} from "\.\/qr-scanner-port\.js";/,
    );
  });

  it("loads the real preview lazily, so expo-camera is not in this panel's static import graph", () => {
    expect(readCode()).toMatch(
      /const LazyExpoCameraPreview = lazy\(\(\) => import\("\.\/expo-camera-preview"\)\);/,
    );
    expect(readCode()).not.toMatch(/from "expo-camera"/);
  });

  it("declares preview as an optional injectable prop, so a production caller never has to pass one", () => {
    expect(readCode()).toMatch(/preview\?: QrCameraPreviewComponent;/);
    expect(readCode()).toMatch(
      /import type \{ QrCameraPreviewComponent \} from "\.\/expo-camera-preview\.js";/,
    );
  });

  it("the 'ready' phase renders the preview seam under the `${testId}-preview` surface, with the honest placeholder as its loading/failure fallback", () => {
    const code = readCode();
    expect(code).toMatch(/const previewTestId = testId \? `\$\{testId\}-preview` : undefined;/);
    expect(code).toMatch(/const PreviewSurface = preview \?\? LazyExpoCameraPreview;/);
    expect(code).toMatch(/\{snapshot\.phase === "ready" \? \(/);
    expect(code).toMatch(/<CameraPreviewBoundary/);
    expect(code).toMatch(
      /fallback=\{<View style=\{styles\.previewPlaceholder\} testID=\{previewTestId\} \/>\}/,
    );
    expect(code).toMatch(
      /<Suspense fallback=\{<View style=\{styles\.previewPlaceholder\} testID=\{previewTestId\} \/>\}>/,
    );
    expect(code).toMatch(/getDerivedStateFromError/);
    expect(code).toMatch(
      /return this\.state\.failed \? this\.props\.fallback : this\.props\.children;/,
    );
  });

  it("forwards a decoded QR to controller.handleScannedText through handleScanned, not a second pipeline", () => {
    expect(readCode()).toMatch(
      /function handleScanned\(value: string\): void \{\s*void controller\.handleScannedText\(value\);\s*\}/,
    );
    expect(readCode()).toMatch(/onScanned=\{handleScanned\}/);
  });

  it("keeps the preview surface at or above the 48dp floor", () => {
    expect(readCode()).toMatch(/minHeight: 48,/);
  });

  it("expo-camera-preview.tsx renders a QR-only surface under `${testId}-preview` and hands onScanned the decoded text", () => {
    const code = readPreviewCode();
    expect(code).toMatch(/testID=\{testId \? `\$\{testId\}-preview` : undefined\}/);
    expect(code).toMatch(/barcodeTypes: \["qr"\]/);
    expect(code).toMatch(
      /function handleBarcodeScanned\(result: BarcodeScanningResult\): void \{\s*onScanned\(result\.data\);\s*\}/,
    );
    expect(code).toMatch(/onBarcodeScanned=\{handleBarcodeScanned\}/);
    expect(code).toMatch(/minHeight: 48,/);
    expect(code).toMatch(/export default ExpoCameraPreview;/);
  });
});
