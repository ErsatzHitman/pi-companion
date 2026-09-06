import { useEffect, useRef, useState } from "react";

import { Banner } from "../../ui/primitives/Banner.js";
import { Button } from "../../ui/primitives/Button.js";
import { Sheet } from "../../ui/primitives/Sheet.js";
import { CameraUnavailableError, classifyCameraError } from "./classify-camera-error.js";
import { captureQrFromVideo } from "./qr-decode.js";
import "./qr-capture.css";

type ScanState = "requesting" | "scanning" | "denied" | "unavailable" | "error";

async function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.mediaDevices?.getUserMedia !== "function"
  ) {
    throw new CameraUnavailableError();
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

export interface QrCaptureSheetProps {
  open: boolean;
  /** Closes the sheet without a scan result — the "fall back to manual entry" path. */
  onClose: () => void;
  /** Called once with the raw decoded QR payload; the sheet does not close itself afterwards, callers own that. */
  onScanned: (value: string) => void;
  /** Test seam: overrides `navigator.mediaDevices.getUserMedia`. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Test seam: overrides the per-frame capture + decode step. */
  captureFrame?: (video: HTMLVideoElement) => Promise<string | null>;
  /** Test seam: how often a frame is polled, in ms. */
  pollIntervalMs?: number;
}

const STATE_MESSAGE: Record<ScanState, { tone: "info" | "danger"; text: string }> = {
  requesting: { tone: "info", text: "Starting the camera\u2026" },
  scanning: { tone: "info", text: "Point the camera at the pairing QR code." },
  denied: {
    tone: "danger",
    text: "Camera access was denied. Allow camera access in your browser, or use manual entry below.",
  },
  unavailable: {
    tone: "danger",
    text: "No camera is available on this device. Use manual entry below.",
  },
  error: {
    tone: "danger",
    text: "Couldn't start the camera. Use manual entry below.",
  },
};

/**
 * Camera-driven QR pairing capture (plan.md §12.1, T27A4). Opens as a
 * modal `Sheet` over the connect form's "pair with a link" section;
 * while open it requests a rear-facing camera stream, polls decoded
 * frames (`captureQrFromVideo`, which lazily loads `jsqr` — "The QR
 * chunk is lazily loaded"), and calls `onScanned` once with the first
 * decoded payload — the same string shape `apply-connection-offer.ts`'s
 * `parseConnectionOfferInput` already accepts from pasted input, so a
 * scanned offer completes pairing through the identical path.
 *
 * A denied permission or a device with no camera is never a silent
 * dead end: `classifyCameraError` turns the `getUserMedia` rejection
 * into one of three named states, each rendered as a status `Banner`
 * (not a bare colour cue) that explains what happened and points back
 * at the manual-entry field below via the "Use manual entry instead"
 * button, which always closes the sheet regardless of state.
 */
export function QrCaptureSheet({
  open,
  onClose,
  onScanned,
  getUserMedia = defaultGetUserMedia,
  captureFrame = captureQrFromVideo,
  pollIntervalMs = 300,
}: QrCaptureSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<ScanState>("requesting");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    function stopStream(): void {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    setState("requesting");

    async function start(): Promise<void> {
      let stream: MediaStream;
      try {
        stream = await getUserMedia({ video: { facingMode: "environment" } });
      } catch (error) {
        if (cancelled) return;
        setState(classifyCameraError(error));
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // `HTMLVideoElement.play()` returns a `Promise` in real browsers
        // but `undefined` under jsdom ("not implemented"); `Promise.resolve`
        // normalizes both so a rejection here never crashes the scan.
        await Promise.resolve(video.play()).catch(() => {});
      }
      if (cancelled) return;
      setState("scanning");
      intervalId = setInterval(() => {
        const currentVideo = videoRef.current;
        if (!currentVideo) return;
        void captureFrame(currentVideo).then((value) => {
          if (cancelled || !value) return;
          cancelled = true;
          if (intervalId) clearInterval(intervalId);
          stopStream();
          onScanned(value);
        });
      }, pollIntervalMs);
    }

    void start();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, getUserMedia, captureFrame, pollIntervalMs]);

  const { tone, text } = STATE_MESSAGE[state];
  const showVideo = state === "requesting" || state === "scanning";

  return (
    <Sheet
      open={open}
      title="Scan pairing QR code"
      description="Point the camera at the pairing QR code shown by the daemon."
      onClose={onClose}
      testId="connect-qr-sheet"
    >
      {showVideo ? (
        <video
          ref={videoRef}
          className="pc-qr-capture__video"
          data-testid="connect-qr-video"
          muted
          playsInline
          aria-hidden="true"
        />
      ) : null}
      <Banner tone={tone} message={text} testId="connect-qr-status-banner" />
      <Button type="button" kind="secondary" onClick={onClose}>
        Use manual entry instead
      </Button>
    </Sheet>
  );
}
