/**
 * The real `expo-camera` preview surface for `QrPairingPanel.tsx` (T392,
 * plan.md §7.1/§9.2/§12.1).
 *
 * Deliberately a SEPARATE file from `QrPairingPanel.tsx`, for the same
 * reason `expo-camera-scanner-port.ts` is split from `qr-scanner-port.ts`
 * and `../composer/expo-camera-capture-port.ts` is split from
 * `../composer/attachment-source-port.ts`: `expo-camera`'s `CameraView`
 * reaches `react-native` transitively, so a component that renders it
 * must not be pulled into any module graph a test loads. The panel holds
 * it behind a dynamic `import()` (`React.lazy`, inside a small error
 * boundary), so the JS module can be present while the native view is
 * not — a build without the linked native module renders the panel's
 * honest placeholder instead of crashing.
 *
 * `QrCameraPreviewProps`/`QrCameraPreviewComponent` are the panel's
 * injectable preview seam; `QrPairingPanel.tsx` imports them as types
 * only (erased at build time, so the dynamic import stays the sole
 * runtime edge to this file).
 */
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import type { ComponentType } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

export interface QrCameraPreviewProps {
  /** The panel's own `testId`; the preview must render its surface with `${testId}-preview`. */
  testId?: string;
  /** One decoded QR payload. The panel forwards this straight to `controller.handleScannedText`. */
  onScanned: (value: string) => void;
  /** The panel's shared preview-surface style (height, radius, background). */
  style?: StyleProp<ViewStyle>;
}

/** The panel's injectable preview component shape — see `QrPairingPanel.tsx`'s `preview` prop. */
export type QrCameraPreviewComponent = ComponentType<QrCameraPreviewProps>;

/**
 * The real preview. QR-only on purpose: a pairing QR carries the offer
 * text and nothing else in this flow should ever be decoded, so the
 * scanner is narrowed to the one barcode type the feature means.
 */
export function ExpoCameraPreview({ testId, onScanned, style }: QrCameraPreviewProps) {
  function handleBarcodeScanned(result: BarcodeScanningResult): void {
    onScanned(result.data);
  }

  return (
    <CameraView
      style={[styles.preview, style]}
      testID={testId ? `${testId}-preview` : undefined}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      onBarcodeScanned={handleBarcodeScanned}
      accessibilityRole="image"
      accessibilityLabel="Camera preview for scanning the pairing QR code"
    />
  );
}

const styles = StyleSheet.create({
  // `minHeight: 48` keeps the surface itself above this repository's
  // 48dp floor even though the panel's shared style is taller; the
  // explicit `height` is the panel's `previewPlaceholder` shape.
  preview: {
    height: 200,
    minHeight: 48,
    overflow: "hidden",
  },
});

export default ExpoCameraPreview;
