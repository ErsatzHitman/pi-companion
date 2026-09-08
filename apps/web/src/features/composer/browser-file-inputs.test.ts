import { describe, expect, it } from "vitest";

import {
  filesFromClipboardItems,
  filesFromDataTransfer,
  synthesizePastedImageName,
  toPickedFile,
} from "./browser-file-inputs.js";

function makeFile(name: string, mimeType: string, bytes = "x"): File {
  return new File([bytes], name, { type: mimeType });
}

/** Minimal `DataTransferItem`-shaped object, since jsdom's own `DataTransferItem` cannot be constructed directly in a test. */
function fileItem(file: File): DataTransferItem {
  return { kind: "file", getAsFile: () => file } as unknown as DataTransferItem;
}

function stringItem(): DataTransferItem {
  return { kind: "string", getAsFile: () => null } as unknown as DataTransferItem;
}

describe("synthesizePastedImageName", () => {
  it("names a screenshot with a recognized extension for its MIME type", () => {
    expect(synthesizePastedImageName("image/png", 1_700_000_000_000)).toBe(
      "pasted-image-1700000000000.png",
    );
    expect(synthesizePastedImageName("image/jpeg", 5)).toBe("pasted-image-5.jpg");
  });

  it("falls back to .png for an unrecognized image MIME subtype", () => {
    expect(synthesizePastedImageName("image/tiff", 9)).toBe("pasted-image-9.png");
  });
});

describe("toPickedFile", () => {
  it("converts a DOM File into a PickedFile that reads back the same bytes", async () => {
    const file = makeFile("notes.txt", "text/plain", "hello");
    const picked = toPickedFile(file);
    expect(picked.name).toBe("notes.txt");
    expect(picked.mimeType).toBe("text/plain");
    expect(picked.size).toBe(5);
    expect(new TextDecoder().decode(await picked.readAsBytes())).toBe("hello");
  });

  it("applies a name override, for a synthesized pasted-image name", () => {
    const file = makeFile("", "image/png");
    const picked = toPickedFile(file, "pasted-image-42.png");
    expect(picked.name).toBe("pasted-image-42.png");
  });
});

describe("filesFromDataTransfer", () => {
  it("converts every dropped file, keeping its real name", () => {
    const files = [makeFile("a.png", "image/png"), makeFile("b.pdf", "application/pdf")];
    const dataTransfer = { files } as unknown as DataTransfer;
    const picked = filesFromDataTransfer(dataTransfer);
    expect(picked.map((file) => file.name)).toEqual(["a.png", "b.pdf"]);
  });

  it("returns nothing for a null DataTransfer", () => {
    expect(filesFromDataTransfer(null)).toEqual([]);
  });
});

describe("filesFromClipboardItems", () => {
  it("extracts only the file-kind items, ignoring text items entirely", () => {
    const image = makeFile("", "image/png");
    const items = [stringItem(), fileItem(image)] as unknown as DataTransferItemList;
    const picked = filesFromClipboardItems(items, 1_000);
    expect(picked).toHaveLength(1);
    expect(picked[0].mimeType).toBe("image/png");
  });

  it("synthesizes a name for a nameless pasted file, and states what: pasted-image-<now>.<ext>", () => {
    const screenshot = makeFile("", "image/png");
    const items = [fileItem(screenshot)] as unknown as DataTransferItemList;
    const picked = filesFromClipboardItems(items, 1_700_000_000_000);
    expect(picked[0].name).toBe("pasted-image-1700000000000.png");
  });

  it("keeps a real filename when the browser provides one", () => {
    const namedFile = makeFile("chart.png", "image/png");
    const items = [fileItem(namedFile)] as unknown as DataTransferItemList;
    const picked = filesFromClipboardItems(items, 1_000);
    expect(picked[0].name).toBe("chart.png");
  });

  it("gives two nameless pasted files distinct synthesized names in one event", () => {
    const items = [
      fileItem(makeFile("", "image/png")),
      fileItem(makeFile("", "image/jpeg")),
    ] as unknown as DataTransferItemList;
    const picked = filesFromClipboardItems(items, 1_000);
    expect(picked[0].name).not.toBe(picked[1].name);
  });

  it("returns nothing for null/undefined clipboard items", () => {
    expect(filesFromClipboardItems(null, 1_000)).toEqual([]);
    expect(filesFromClipboardItems(undefined, 1_000)).toEqual([]);
  });
});
