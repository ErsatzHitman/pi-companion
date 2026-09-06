import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QrCaptureSheet } from "./QrCaptureSheet.js";

afterEach(cleanup);

function fakeStream(): { stream: MediaStream; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}

describe("QrCaptureSheet (T27A4)", () => {
  it("renders nothing when closed and never requests the camera", () => {
    const getUserMedia = vi.fn();
    render(
      <QrCaptureSheet
        open={false}
        onClose={vi.fn()}
        onScanned={vi.fn()}
        getUserMedia={getUserMedia}
      />,
    );

    expect(screen.queryByTestId("connect-qr-sheet")).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("requests a rear-facing camera and shows a starting status before it resolves", () => {
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}));
    render(
      <QrCaptureSheet open onClose={vi.fn()} onScanned={vi.fn()} getUserMedia={getUserMedia} />,
    );

    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" } });
    expect(screen.getByRole("status").textContent).toContain("Starting the camera");
  });

  it("polls decoded frames once scanning and completes pairing on the first decoded value", async () => {
    const { stream, stop } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const captureFrame = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("https://app.paseo.sh/#offer=abc");
    const onScanned = vi.fn();

    render(
      <QrCaptureSheet
        open
        onClose={vi.fn()}
        onScanned={onScanned}
        getUserMedia={getUserMedia}
        captureFrame={captureFrame}
        pollIntervalMs={5}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Point the camera"),
    );
    await waitFor(() => expect(onScanned).toHaveBeenCalledWith("https://app.paseo.sh/#offer=abc"));
    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  }, 10_000);

  it("shows a denied fallback, distinct from a missing camera, when permission is refused", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    render(
      <QrCaptureSheet open onClose={vi.fn()} onScanned={vi.fn()} getUserMedia={getUserMedia} />,
    );

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("denied");
    expect(screen.queryByTestId("connect-qr-video")).toBeNull();
  });

  it("shows a no-camera fallback, distinct from denied, when there is no camera device", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("no", "NotFoundError"));
    render(
      <QrCaptureSheet open onClose={vi.fn()} onScanned={vi.fn()} getUserMedia={getUserMedia} />,
    );

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("No camera is available");
    expect(status.textContent).not.toContain("denied");
  });

  it("always offers a keyboard-operable way back to manual entry, regardless of camera state", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("no", "NotFoundError"));
    render(
      <QrCaptureSheet open onClose={onClose} onScanned={vi.fn()} getUserMedia={getUserMedia} />,
    );

    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "Use manual entry instead" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops the camera stream and its poll loop when closed mid-scan", async () => {
    const { stream, stop } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const captureFrame = vi.fn().mockResolvedValue(null);
    const onScanned = vi.fn();

    const { rerender } = render(
      <QrCaptureSheet
        open
        onClose={vi.fn()}
        onScanned={onScanned}
        getUserMedia={getUserMedia}
        captureFrame={captureFrame}
        pollIntervalMs={5}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Point the camera"),
    );
    const callsBeforeClose = captureFrame.mock.calls.length;

    rerender(
      <QrCaptureSheet
        open={false}
        onClose={vi.fn()}
        onScanned={onScanned}
        getUserMedia={getUserMedia}
        captureFrame={captureFrame}
        pollIntervalMs={5}
      />,
    );

    expect(stop).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(captureFrame.mock.calls.length).toBe(callsBeforeClose);
    expect(onScanned).not.toHaveBeenCalled();
  });

  it("has no axe violations while scanning or after a denied camera", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const captureFrame = vi.fn().mockResolvedValue(null);

    const { container, unmount } = render(
      <QrCaptureSheet
        open
        onClose={vi.fn()}
        onScanned={vi.fn()}
        getUserMedia={getUserMedia}
        captureFrame={captureFrame}
        pollIntervalMs={5}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Point the camera"),
    );
    expect(await axe(container)).toHaveNoViolations();
    unmount();

    const deniedGetUserMedia = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    const { container: deniedContainer } = render(
      <QrCaptureSheet
        open
        onClose={vi.fn()}
        onScanned={vi.fn()}
        getUserMedia={deniedGetUserMedia}
      />,
    );
    await screen.findByRole("status");
    expect(await axe(deniedContainer)).toHaveNoViolations();
  }, 20_000);
});
