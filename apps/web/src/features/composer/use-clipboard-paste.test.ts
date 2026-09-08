import { describe, expect, it, vi } from "vitest";

import { useComposerPaste } from "./use-clipboard-paste.js";

function makeFile(name: string, mimeType: string): File {
  return new File(["x"], name, { type: mimeType });
}

function fileItem(file: File): DataTransferItem {
  return { kind: "file", getAsFile: () => file } as unknown as DataTransferItem;
}

function stringItem(): DataTransferItem {
  return { kind: "string", getAsFile: () => null } as unknown as DataTransferItem;
}

function pasteEvent(items: DataTransferItem[]) {
  return {
    clipboardData: { items: items as unknown as DataTransferItemList },
    preventDefault: vi.fn(),
  } as unknown as React.ClipboardEvent<HTMLElement>;
}

describe("useComposerPaste — the pasted-link rule (T279)", () => {
  it("direction 1: a bare pasted URL (text only, no file item) is never swallowed — no attachment, default paste proceeds", () => {
    const onFiles = vi.fn();
    const handlePaste = useComposerPaste({ onFiles, now: () => 1_000 });
    const event = pasteEvent([stringItem()]);

    handlePaste(event);

    expect(onFiles).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("direction 2: an image paste that ALSO carries a URL text item becomes an attachment, and the URL text is suppressed", () => {
    const onFiles = vi.fn();
    const handlePaste = useComposerPaste({ onFiles, now: () => 1_000 });
    // Chrome's "Copy image" from a web page: a real file item plus a
    // text/plain item carrying the image's source URL.
    const image = makeFile("cat.png", "image/png");
    const event = pasteEvent([fileItem(image), stringItem()]);

    handlePaste(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(onFiles).toHaveBeenCalledTimes(1);
    const [files] = onFiles.mock.calls[0];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("cat.png");
  });

  it("a plain sentence pasted (no file item) is never swallowed either", () => {
    const onFiles = vi.fn();
    const handlePaste = useComposerPaste({ onFiles, now: () => 1_000 });
    const event = pasteEvent([stringItem()]);

    handlePaste(event);

    expect(onFiles).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("a pasted screenshot with no text fallback at all is still staged as an attachment with a synthesized name", () => {
    const onFiles = vi.fn();
    const handlePaste = useComposerPaste({ onFiles, now: () => 1_700_000_000_000 });
    const screenshot = makeFile("", "image/png");
    const event = pasteEvent([fileItem(screenshot)]);

    handlePaste(event);

    expect(event.preventDefault).toHaveBeenCalled();
    const [files] = onFiles.mock.calls[0];
    expect(files[0].name).toBe("pasted-image-1700000000000.png");
  });

  it("does nothing at all for an empty clipboard", () => {
    const onFiles = vi.fn();
    const handlePaste = useComposerPaste({ onFiles, now: () => 1_000 });
    const event = {
      clipboardData: null,
      preventDefault: vi.fn(),
    } as unknown as React.ClipboardEvent<HTMLElement>;

    handlePaste(event);

    expect(onFiles).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
