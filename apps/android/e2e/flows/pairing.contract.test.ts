import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { describePermissionRecovery } from "../../src/features/composer/permission-recovery.js";
import {
  CAMERA_UNAVAILABLE_EXPLANATION,
  describeQrScanPhase,
} from "../../src/features/connect/qr-scan-model.js";
import { PAIRING_FLOW } from "./pairing-contract.js";

/**
 * T37E1 — proves every testId/string `../../maestro/pairing.yaml` names
 * still exists in the real source it targets. This is `pairing.yaml`'s
 * only proof of life in this wave: there is no emulator, device, or
 * Maestro binary here (see that file's own header comment), so this
 * test is what stops the flow silently rotting before anyone with a
 * device first runs it.
 *
 * Two proof strategies, chosen per module:
 *
 * - `composer/permission-recovery.ts` and `connect/qr-scan-model.ts` are
 *   RN-free, so this file imports them directly and calls the real
 *   functions — stronger than a source-text match, and the preferred
 *   route wherever the module allows it.
 * - Every other module here (`OnboardingGate.tsx`, `connection-shell.tsx`,
 *   `ConnectForm.tsx`, `QrPairingPanel.tsx`, `connect.tsx`) reaches
 *   `react-native` and cannot be imported under this workspace's vitest
 *   setup (`CLAUDE.md`'s "VITEST LIMITATION" note), so those are proven
 *   with `readCode()` — comment-stripped source matched against a full
 *   JSX/prop expression, never a bare identifier (`CLAUDE.md`'s
 *   "SOURCE-TEXT REGEX TESTS ARE ON PROBATION" note): matching a bare
 *   `testId` or `"connect-form"` would also pass if the JSX that wires
 *   it were deleted, since this file's own strings would still be
 *   sitting right here to match against. See
 *   `../../src/app/h/[serverId]/session/[agentId]/index.test.ts` for the
 *   precedent this copies.
 *
 * Mutation-checked (see the wave report for the exact mutation, its
 * failure, and the byte-identical restore): the address-field testId
 * assertion below, and the `--no-relay` structural assertion.
 */

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("pairing.yaml anchors exist in source", () => {
  describe("onboarding (welcome + permissions steps)", () => {
    it('connect.tsx mounts OnboardingGate with testId="connect-onboarding" around ConnectionShell', () => {
      const code = readCode("../../src/app/connect.tsx");
      expect(code).toMatch(
        /<OnboardingGate\s+storage=\{core\.keyValueStorage\}\s+testId="connect-onboarding">\s*<ConnectionShell\s*\/>\s*<\/OnboardingGate>/,
      );
    });

    it("OnboardingGate's welcome step renders the title and a 'Get started' button under `${testId}-welcome-continue`", () => {
      const code = readCode("../../src/features/connect/OnboardingGate.tsx");
      expect(code).toMatch(/<Section title="Welcome to Pi Companion">/);
      expect(code).toMatch(
        /<Button\s+kind="primary"\s+label="Get started"\s+onPress=\{\(\) => void controller\.advance\(\)\}\s+testId=\{testId \? `\$\{testId\}-welcome-continue` : undefined\}/,
      );
    });

    it("OnboardingGate's permissions step renders the recovery banner under `${testId}-permission-banner` and a Continue button under `${testId}-permission-continue`", () => {
      const code = readCode("../../src/features/connect/OnboardingGate.tsx");
      expect(code).toMatch(
        /<Banner\s+tone=\{recovery\.action === "open-settings" \? "warning" : "info"\}\s+message=\{recovery\.message\}\s+testId=\{testId \? `\$\{testId\}-permission-banner` : undefined\}/,
      );
      expect(code).toMatch(
        /<Button\s+kind="primary"\s+label="Continue"\s+onPress=\{\(\) => void controller\.complete\(\)\}\s+testId=\{testId \? `\$\{testId\}-permission-continue` : undefined\}/,
      );
    });

    it("describePermissionRecovery('camera', 'unavailable') is exactly the banner text pairing.yaml asserts", () => {
      expect(describePermissionRecovery("camera", "unavailable").message).toBe(
        "Camera access isn't available in this build.",
      );
    });
  });

  describe("direct pairing (ConnectForm)", () => {
    it('connection-shell.tsx mounts ConnectForm under testId="connect-form"', () => {
      const code = readCode("../../src/features/connect/connection-shell.tsx");
      // T32S14 (P5-W20, this same wave) added the `profiles` prop so a
      // saved profile is reconnectable through this same form.
      expect(code).toMatch(
        /<ConnectForm testId="connect-form" onSubmit=\{handleSubmit\} profiles=\{profileOptions\} \/>/,
      );
    });

    it("ConnectForm's address field and submit button carry the testIds pairing.yaml drives", () => {
      const code = readCode("../../src/features/connect/ConnectForm.tsx");
      expect(code).toMatch(
        /<TextField\s+label="Host address"[\s\S]{0,400}?testId=\{testId \? `\$\{testId\}-address-field` : undefined\}/,
      );
      expect(code).toMatch(
        /<Button\s+kind="primary"\s+label=\{isNewProfile \? "Add host" : "Use this profile"\}\s+onPress=\{handleSubmit\}\s+testId=\{testId \? `\$\{testId\}-submit-button` : undefined\}/,
      );
    });

    it("describeConnectionStatus produces 'Connected via direct connection' for phase=connected/path=direct, and 'Not connected' for the idle default", () => {
      const code = readCode("../../src/features/connect/connection-shell.tsx");
      expect(code).toMatch(/path === "direct" \? " via direct connection"/);
      expect(code).toMatch(/case "connected":\s*return `Connected\$\{pathSuffix\}`;/);
      expect(code).toMatch(/return "Not connected";/);
    });
  });

  describe("relay entry point (honest 'unavailable' state, not a completed pairing)", () => {
    it('connection-shell.tsx wires the scanner toggle to QrPairingPanel(testId="connection-shell-qr-pairing") and both toggle buttons', () => {
      const code = readCode("../../src/features/connect/connection-shell.tsx");
      expect(code).toMatch(/<QrPairingPanel\s+testId="connection-shell-qr-pairing"/);
      expect(code).toMatch(
        /<Button\s+kind="secondary"\s+label="Scan a QR code"\s+onPress=\{\(\) => setShowScanner\(true\)\}\s+testId="connection-shell-show-scanner-button"/,
      );
      expect(code).toMatch(
        /<Button\s+kind="secondary"\s+label="Enter address manually instead"\s+onPress=\{\(\) => setShowScanner\(false\)\}\s+testId="connection-shell-hide-scanner-button"/,
      );
    });

    it("QrPairingPanel renders a retry button under `${testId}-retry-button` while phase is denied or unavailable", () => {
      const code = readCode("../../src/features/connect/QrPairingPanel.tsx");
      expect(code).toMatch(
        /const showRetry = snapshot\.phase === "denied" \|\| snapshot\.phase === "unavailable";/,
      );
      expect(code).toMatch(
        /<Button\s+kind="secondary"\s+label="Try again"\s+onPress=\{\(\) => void controller\.retryPermission\(\)\}\s+testId=\{testId \? `\$\{testId\}-retry-button` : undefined\}/,
      );
    });

    it("CAMERA_UNAVAILABLE_EXPLANATION is exactly the copy pairing.yaml asserts for the unavailable phase", () => {
      expect(CAMERA_UNAVAILABLE_EXPLANATION).toBe(
        "QR pairing isn't available in this build yet. Enter your host's address manually below instead.",
      );
      expect(describeQrScanPhase("unavailable")).toBe(CAMERA_UNAVAILABLE_EXPLANATION);
    });

    // P5-W18 merge gate: the second half of this used to be
    // `expect(panel).not.toMatch(/handleScannedText/)` — a negative pin
    // asserting that nothing in the rendered UI could reach the pairing
    // entry point. T32A8 deliberately closed that gap this wave with an
    // always-visible "Pairing link" field plus a "Pair" button, so the
    // pin is replaced by a positive assertion of the entry point that
    // now exists. The camera half is unchanged and still true: no camera
    // module is installed, so `createUnavailableCameraScannerPort` is
    // still the only port, and manual paste is the only way to drive a
    // pairing here.
    it("no camera module is installed, so manual paste is the only way handleScannedText is reached from QrPairingPanel's rendered UI", () => {
      const port = readCode("../../src/features/connect/qr-scanner-port.ts");
      expect(port).toMatch(
        /export function createUnavailableCameraScannerPort\(\): CameraScannerPort \{/,
      );
      const panel = readCode("../../src/features/connect/QrPairingPanel.tsx");
      expect(panel).toMatch(
        /function handlePastePress\(\): void \{\s*void controller\.handleScannedText\(pasteValue\);/,
      );
      expect(panel).toMatch(
        /<Button\s+kind="primary"\s+label="Pair"\s+onPress=\{handlePastePress\}\s+disabled=\{pairingInFlight \|\| pasteValue\.trim\(\)\.length === 0\}\s+testId=\{testId \? `\$\{testId\}-paste-input-pair-button` : undefined\}/,
      );
    });

    it("the isolated e2e daemon this flow runs against is started with --no-relay, so a relay pairing has nothing to pair through here", () => {
      const runPlan = readCode("../harness/run-plan.ts");
      expect(runPlan).toMatch(/startArgv:\s*\[[\s\S]{0,300}?"--no-relay"/);
    });
  });

  it("PAIRING_FLOW's testId constants match the literals pairing.yaml actually uses", () => {
    // pairing.yaml cannot import this module (Maestro has no module
    // system) — this pins the two copies (constants file, yaml literal)
    // against each other so they cannot silently drift apart unnoticed.
    expect(PAIRING_FLOW.onboardingRoot).toBe("connect-onboarding");
    expect(PAIRING_FLOW.onboardingWelcomeContinueButton).toBe(
      "connect-onboarding-welcome-continue",
    );
    expect(PAIRING_FLOW.onboardingPermissionContinueButton).toBe(
      "connect-onboarding-permission-continue",
    );
    expect(PAIRING_FLOW.connectFormSection).toBe("connect-form");
    expect(PAIRING_FLOW.connectFormAddressField).toBe("connect-form-address-field");
    expect(PAIRING_FLOW.connectFormSubmitButton).toBe("connect-form-submit-button");
    expect(PAIRING_FLOW.connectedDirectStatusText).toBe("Connected via direct connection");
    expect(PAIRING_FLOW.notConnectedStatusText).toBe("Not connected");
    expect(PAIRING_FLOW.sessionsScreenArrival).toBe("sessions-screen-.*");
    expect(PAIRING_FLOW.showScannerButton).toBe("connection-shell-show-scanner-button");
    expect(PAIRING_FLOW.hideScannerButton).toBe("connection-shell-hide-scanner-button");
    expect(PAIRING_FLOW.qrPairingSection).toBe("connection-shell-qr-pairing");
    expect(PAIRING_FLOW.qrPairingRetryButton).toBe("connection-shell-qr-pairing-retry-button");
  });
});
