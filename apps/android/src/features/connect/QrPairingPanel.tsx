import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { Banner } from "../../ui/primitives/Banner";
import { Button } from "../../ui/primitives/Button";
import { Card } from "../../ui/primitives/Card";
import { Section } from "../../ui/primitives/Section";
import { TextField } from "../../ui/primitives/TextField";
import { useTheme } from "../../ui/theme/theme-context";
import type {
  ApplyConnectionOfferAttempt,
  ApplyConnectionOfferSuccess,
} from "./apply-connection-offer.js";
import type { QrCameraPreviewComponent } from "./expo-camera-preview.js";
import { createExpoCameraScannerPort } from "./expo-camera-scanner-port.js";
import {
  createQrScanController,
  describeQrScanPhase,
  type QrScanSnapshot,
} from "./qr-scan-model.js";
import type { CameraScannerPort } from "./qr-scanner-port.js";

/**
 * The real preview, loaded on demand (T392). `expo-camera`'s `CameraView`
 * reaches `react-native` (and, at runtime, a native view that a given
 * build may not have linked), so it is deliberately kept out of this
 * module's static import graph: the import only happens when a
 * `"ready"` phase first renders the seam.
 */
const LazyExpoCameraPreview = lazy(() => import("./expo-camera-preview"));

interface CameraPreviewBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface CameraPreviewBoundaryState {
  failed: boolean;
}

/**
 * Turns a render-time failure of the native camera view (or of the
 * dynamic import above) into this panel's honest placeholder instead of
 * a crash. Deliberately local and tiny: the app's root
 * `AppErrorBoundary` would blank the whole shell, and a camera preview
 * that cannot mount is a per-surface, recoverable absence rather than a
 * product error.
 */
class CameraPreviewBoundary extends Component<
  CameraPreviewBoundaryProps,
  CameraPreviewBoundaryState
> {
  state: CameraPreviewBoundaryState = { failed: false };

  static getDerivedStateFromError(): CameraPreviewBoundaryState {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface QrPairingPanelProps {
  applyOffer: ApplyConnectionOfferAttempt;
  onPaired: (result: ApplyConnectionOfferSuccess) => void;
  /**
   * Injectable, RN-free camera-permission seam — test/DI seam, mirrors
   * `daemon-connect-attempt.ts`'s `webSocketFactory`. Defaults to the
   * real `createExpoCameraScannerPort()` (T392); pass
   * `createUnavailableCameraScannerPort()` to disable camera permission
   * explicitly, or a scripted fake from a test.
   */
  scanner?: CameraScannerPort;
  /**
   * Injectable camera-preview seam (T392) — the component rendered while
   * `snapshot.phase === "ready"`. Defaults to
   * `./expo-camera-preview.tsx`'s `ExpoCameraPreview`, reached through a
   * dynamic `import()`. A caller (or a build without the linked native
   * camera view) can supply its own surface, and the panel renders its
   * honest `previewPlaceholder` for the loading and render-failure cases
   * either way. The injected component must render its surface with
   * `${testId}-preview`.
   */
  preview?: QrCameraPreviewComponent;
  /**
   * Injectable seam for the `"settings"` phase's "Open settings"
   * affordance (T32A8, T60E's filed seam — see this component's module
   * docstring). Defaults to React Native's own `Linking.openSettings()`
   * (core RN, not an extra install — mirrors `onboarding-permissions-
   * port.ts`'s identical default), so a production caller never passes
   * this; a test can override it to assert the affordance without
   * actually leaving the app.
   */
  openSettings?: () => void;
  testId?: string;
}

/**
 * The QR-pairing scan surface (plan.md §7.1/§9.2/§12.1, T32A4, extended
 * by T32A8): entered from `ConnectionShell`'s "Scan a QR code" toggle,
 * never rendered at app launch, so its mount effect below is the first
 * and only moment `qr-scan-model.ts`'s `enterScanSurface()` — and
 * therefore any camera permission prompt — can fire (see that module's
 * docstring for the full rule this satisfies).
 *
 * `scanner` defaults to the real `createExpoCameraScannerPort()` (T392)
 * and `preview` to `./expo-camera-preview.tsx`'s `ExpoCameraPreview`, so
 * a `"ready"` read now shows a live, QR-only camera preview whose
 * decoded payload is forwarded to `controller.handleScannedText`. The
 * preview is held behind a dynamic `import()` inside a small error
 * boundary, and both its loading and render-failure fallbacks are the
 * existing `previewPlaceholder` — a build whose native camera view is
 * not linked renders that honest, empty surface rather than crashing.
 * Every phase this component can reach is proven at the model level
 * (`qr-scan-model.test.ts`) against a scripted `CameraScannerPort`;
 * this file itself is untestable under this workspace's vitest setup
 * (any module reaching `react-native` fails — see `CLAUDE.md`'s
 * "VITEST LIMITATION" note) and is therefore a thin view over that
 * tested model, pinned at the source level by `QrPairingPanel.test.ts`,
 * exactly like `ConnectForm.tsx` is over `connect-form-model.ts`.
 *
 * **T32A8: the manual-paste entry point.** Found by T37E1 (P5-W16): with
 * no camera module installed, this panel used to have no way at all to
 * *drive* a pairing — `controller.handleScannedText` had no caller a
 * script (or a camera-less human) could reach. The `TextField` below
 * (`testId-paste-input`) plus its "Pair" button
 * (`testId-paste-input-pair-button`) call that exact same
 * `controller.handleScannedText`, the one entry point `qr-scan-model.ts`
 * already exposes for "one decoded QR payload" — this field is simply a
 * second way to produce that payload, not a second pairing pipeline.
 * Always rendered, independent of `snapshot.phase`: even once a real
 * camera module lands, pasting a link is still the faster path for
 * pairing with an already-open browser tab. Disabled while a pairing
 * attempt is already in flight (`snapshot.phase === "pairing"`) so a
 * script (or an impatient user) can't fire two concurrent attempts —
 * `handleScannedText` itself also ignores a call made mid-attempt, so
 * this is belt-and-suspenders, not the only guard.
 *
 * **T32A8: the `"settings"` phase's "Open settings" affordance.** T60E's
 * filed seam: `qr-scan-model.ts`'s `mapPermissionStatus` already maps
 * Android's "don't ask again" permission read to its own `"settings"`
 * phase (distinct from `"denied"`, which `showRetry` covers with a "Try
 * again" button that would otherwise silently no-op against a
 * permanently-denied permission — see that module's docstring). Before
 * this task a `"settings"` read fell through to static text with no
 * affordance at all. `showOpenSettings` below renders a dedicated
 * button for exactly that phase, calling `openSettings` (default: RN's
 * own `Linking.openSettings()`) rather than `controller.retryPermission()`
 * — reusing "Try again" here would be the same lie `qr-scan-model.ts`'s
 * docstring already calls out for `"denied"`.
 */
export function QrPairingPanel({
  applyOffer,
  onPaired,
  scanner,
  preview,
  openSettings,
  testId,
}: QrPairingPanelProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const controller = useMemo(
    () =>
      createQrScanController({
        scanner: scanner ?? createExpoCameraScannerPort(),
        applyOffer,
        onPaired,
      }),
    [scanner, applyOffer, onPaired],
  );

  const [snapshot, setSnapshot] = useState<QrScanSnapshot>(controller.getSnapshot());
  useEffect(() => {
    setSnapshot(controller.getSnapshot());
    return controller.subscribe(setSnapshot);
  }, [controller]);

  // The one and only place a camera-permission prompt can be triggered
  // — fires when this panel is actually mounted (the user tapped "Scan
  // a QR code" in `connection-shell.tsx`), never at app launch.
  useEffect(() => {
    void controller.enterScanSurface();
  }, [controller]);

  const [pasteValue, setPasteValue] = useState("");

  const showRetry = snapshot.phase === "denied" || snapshot.phase === "unavailable";
  const showOpenSettings = snapshot.phase === "settings";
  const pairingInFlight = snapshot.phase === "pairing";
  const previewTestId = testId ? `${testId}-preview` : undefined;
  const PreviewSurface = preview ?? LazyExpoCameraPreview;

  function handlePastePress(): void {
    void controller.handleScannedText(pasteValue);
  }

  // The camera decode's one entry point into the same tested model the
  // paste field uses — a successful QR scan calls exactly this.
  function handleScanned(value: string): void {
    void controller.handleScannedText(value);
  }

  function handleOpenSettingsPress(): void {
    (openSettings ?? (() => Linking.openSettings()))();
  }

  return (
    <Section title="Scan a QR code" testId={testId}>
      <Card style={styles.card}>
        {snapshot.phase === "error" && snapshot.error ? (
          <Banner
            tone="danger"
            message={snapshot.error}
            testId={testId ? `${testId}-error-banner` : undefined}
          />
        ) : null}
        <Text style={styles.body} accessibilityRole="text" accessibilityLiveRegion="polite">
          {describeQrScanPhase(snapshot.phase)}
        </Text>
        {snapshot.phase === "ready" ? (
          <CameraPreviewBoundary
            fallback={<View style={styles.previewPlaceholder} testID={previewTestId} />}
          >
            <Suspense fallback={<View style={styles.previewPlaceholder} testID={previewTestId} />}>
              <PreviewSurface
                testId={testId}
                onScanned={handleScanned}
                style={styles.previewPlaceholder}
              />
            </Suspense>
          </CameraPreviewBoundary>
        ) : null}
        {showRetry ? (
          <Button
            kind="secondary"
            label="Try again"
            onPress={() => void controller.retryPermission()}
            testId={testId ? `${testId}-retry-button` : undefined}
          />
        ) : null}
        {showOpenSettings ? (
          <Button
            kind="secondary"
            label="Open settings"
            onPress={handleOpenSettingsPress}
            testId={testId ? `${testId}-open-settings-button` : undefined}
          />
        ) : null}
        <TextField
          label="Pairing link"
          value={pasteValue}
          onChangeText={setPasteValue}
          placeholder="https://app.paseo.sh/#offer=..."
          autoCapitalize="none"
          autoCorrect={false}
          testId={testId ? `${testId}-paste-input` : undefined}
        />
        <Button
          kind="primary"
          label="Pair"
          onPress={handlePastePress}
          disabled={pairingInFlight || pasteValue.trim().length === 0}
          testId={testId ? `${testId}-paste-input-pair-button` : undefined}
        />
      </Card>
    </Section>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: { gap: theme.spacing[3] },
    body: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.body.fontSize,
    },
    previewPlaceholder: {
      height: 200,
      // 48dp floor (plan.md T26C): the preview is a display surface, not
      // a control, but keeping the floor here means it can never render
      // smaller than a touch target even under a caller-supplied style.
      minHeight: 48,
      borderRadius: theme.radii.card,
      backgroundColor: theme.colors.surface,
      overflow: "hidden",
    },
  });
}

export default QrPairingPanel;
