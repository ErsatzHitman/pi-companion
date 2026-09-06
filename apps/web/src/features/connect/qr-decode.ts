/**
 * QR frame decoding (plan.md §12.1, T27A4).
 *
 * `jsqr` (a small, pure-JS QR decoder with no camera/DOM dependency of
 * its own) is only ever reached through `loadQrFrameDecoder`'s dynamic
 * `import("jsqr")`, so it lands in its own chunk that Vite only fetches
 * once a user actually opens the QR capture sheet — never as part of
 * the initial `/connect` bundle (acceptance criterion: "The QR chunk is
 * lazily loaded"). The decoder module is cached after the first load so
 * repeated scans (or reopening the sheet) never re-fetch the chunk.
 */

export type QrFrameDecoder = (imageData: ImageData) => string | null;

let decoderPromise: Promise<QrFrameDecoder> | null = null;

/**
 * Resolves to a decoder that reads a raw QR payload string out of an
 * `ImageData` frame, or `null` when the frame contains no decodable QR
 * code. Safe to call on every polled frame: the underlying `jsqr` import
 * only ever happens once per page load.
 */
export function loadQrFrameDecoder(): Promise<QrFrameDecoder> {
  decoderPromise ??= import("jsqr").then((mod) => {
    const jsQR = mod.default;
    return (imageData: ImageData): string | null => {
      const result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });
      return result ? result.data : null;
    };
  });
  return decoderPromise;
}

/**
 * Draws the current frame of a playing `<video>` element onto an
 * offscreen canvas and decodes it. Returns `null` (rather than
 * throwing) for a video that has no frame yet (`readyState` too low, or
 * zero intrinsic size) and for a frame with no decodable QR code, so
 * callers can poll this on a timer without special-casing "not ready
 * yet" against "no code in this frame".
 */
export async function captureQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  if (
    video.readyState < video.HAVE_CURRENT_DATA ||
    video.videoWidth === 0 ||
    video.videoHeight === 0
  ) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const decode = await loadQrFrameDecoder();
  return decode(imageData);
}
