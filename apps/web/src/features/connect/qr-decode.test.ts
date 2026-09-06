import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `loadQrFrameDecoder` caches its dynamic `import("jsqr")` at module
 * scope (T27A4: the decoder is fetched once, not once per frame), so
 * each test that swaps the `jsqr` mock resets the module registry and
 * re-imports `qr-decode.js` to get a fresh, uncached decoder.
 */
async function freshQrDecode() {
  vi.resetModules();
  return import("./qr-decode.js");
}

afterEach(() => {
  vi.doUnmock("jsqr");
  vi.resetModules();
});

describe("loadQrFrameDecoder (T27A4)", () => {
  it("returns the payload jsQR decoded from a frame", async () => {
    const jsQR = vi.fn(() => ({ data: "https://app.paseo.sh/#offer=abc" }));
    vi.doMock("jsqr", () => ({ default: jsQR }));

    const { loadQrFrameDecoder } = await freshQrDecode();
    const decode = await loadQrFrameDecoder();
    const imageData = {
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    } as unknown as ImageData;

    expect(decode(imageData)).toBe("https://app.paseo.sh/#offer=abc");
    expect(jsQR).toHaveBeenCalledWith(imageData.data, 1, 1, { inversionAttempts: "dontInvert" });
  });

  it("returns null for a frame with no decodable QR code", async () => {
    vi.doMock("jsqr", () => ({ default: vi.fn(() => null) }));

    const { loadQrFrameDecoder } = await freshQrDecode();
    const decode = await loadQrFrameDecoder();
    const imageData = {
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    } as unknown as ImageData;

    expect(decode(imageData)).toBeNull();
  });

  it("only imports the jsqr module once across repeated calls", async () => {
    let importCount = 0;
    vi.doMock("jsqr", () => {
      importCount += 1;
      return { default: vi.fn(() => null) };
    });

    const { loadQrFrameDecoder } = await freshQrDecode();
    await loadQrFrameDecoder();
    await loadQrFrameDecoder();
    await loadQrFrameDecoder();

    expect(importCount).toBe(1);
  });
});

describe("captureQrFromVideo (T27A4)", () => {
  it("returns null without touching the canvas when the video has no current frame yet", async () => {
    const { captureQrFromVideo } = await freshQrDecode();
    const video = {
      readyState: 0,
      videoWidth: 640,
      videoHeight: 480,
      HAVE_CURRENT_DATA: 2,
    } as unknown as HTMLVideoElement;

    await expect(captureQrFromVideo(video)).resolves.toBeNull();
  });

  it("returns null for a video with zero intrinsic size", async () => {
    const { captureQrFromVideo } = await freshQrDecode();
    const video = {
      readyState: 4,
      videoWidth: 0,
      videoHeight: 0,
      HAVE_CURRENT_DATA: 2,
    } as unknown as HTMLVideoElement;

    await expect(captureQrFromVideo(video)).resolves.toBeNull();
  });

  it("draws the current frame onto a canvas and decodes it when a 2D context is available", async () => {
    vi.doMock("jsqr", () => ({ default: vi.fn(() => ({ data: "scanned-value" })) }));
    const { captureQrFromVideo } = await freshQrDecode();

    const drawImage = vi.fn();
    const fakeImageData = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
    const getImageData = vi.fn(() => fakeImageData);
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage, getImageData } as unknown as CanvasRenderingContext2D);

    const video = {
      readyState: 4,
      videoWidth: 2,
      videoHeight: 2,
      HAVE_CURRENT_DATA: 2,
    } as unknown as HTMLVideoElement;

    await expect(captureQrFromVideo(video)).resolves.toBe("scanned-value");
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 2, 2);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 2, 2);

    getContextSpy.mockRestore();
  });

  it("returns null when the canvas has no 2D context available", async () => {
    const { captureQrFromVideo } = await freshQrDecode();
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    const video = {
      readyState: 4,
      videoWidth: 2,
      videoHeight: 2,
      HAVE_CURRENT_DATA: 2,
    } as unknown as HTMLVideoElement;

    await expect(captureQrFromVideo(video)).resolves.toBeNull();

    getContextSpy.mockRestore();
  });
});
