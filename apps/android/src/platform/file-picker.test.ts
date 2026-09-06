import { describe, expect, it, vi } from "vitest";

import type { PermissionPort, PermissionState } from "../features/composer/permission-recovery.js";
import {
  FILE_PICKER_PERMISSION_DENIED,
  FILE_PICKER_PERMISSION_DENIED_PERMANENTLY,
  FILE_PICKER_UNAVAILABLE,
  FILE_PICKER_UNSUPPORTED_TYPE,
  createAndroidFilePicker,
  createUnavailableFilePicker,
  isImageOnlyAccept,
  matchesAccept,
  type AndroidFilePickerDeps,
  type DocumentPickerModule,
  type DocumentPickerResult,
  type ImageLibraryPickerModule,
  type ImagePickerResult,
} from "./file-picker.js";

function fixedPermission(state: PermissionState): PermissionPort {
  return {
    getPermissionStatus: async () => state,
    requestPermission: async () => state,
  };
}

function scriptedPermission(first: PermissionState, onRequest: PermissionState): PermissionPort {
  return {
    getPermissionStatus: async () => first,
    requestPermission: async () => onRequest,
  };
}

function fakeDocumentPicker(result: DocumentPickerResult): DocumentPickerModule & {
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    getDocumentAsync: async (options) => {
      calls.push(options);
      return result;
    },
  };
}

function fakeImagePicker(result: ImagePickerResult): ImageLibraryPickerModule & {
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    launchImageLibraryAsync: async (options) => {
      calls.push(options);
      return result;
    },
  };
}

function buildDeps(overrides: Partial<AndroidFilePickerDeps> = {}): AndroidFilePickerDeps {
  return {
    documentPicker: fakeDocumentPicker({ canceled: true }),
    imageLibraryPicker: fakeImagePicker({ canceled: true }),
    imageLibraryPermission: fixedPermission("granted"),
    readBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    ...overrides,
  };
}

describe("isImageOnlyAccept", () => {
  it("is true only when every pattern is image-specific", () => {
    expect(isImageOnlyAccept(["image/*"])).toBe(true);
    expect(isImageOnlyAccept(["image/png", "image/jpeg"])).toBe(true);
    expect(isImageOnlyAccept(["image/*", "text/plain"])).toBe(false);
    expect(isImageOnlyAccept(["*/*"])).toBe(false);
    expect(isImageOnlyAccept(undefined)).toBe(false);
    expect(isImageOnlyAccept([])).toBe(false);
  });
});

describe("matchesAccept", () => {
  it("accepts everything when there is no filter", () => {
    expect(matchesAccept("application/pdf", undefined)).toBe(true);
    expect(matchesAccept("application/pdf", [])).toBe(true);
  });

  it("accepts an unknown mimeType unconditionally (nothing left to validate)", () => {
    expect(matchesAccept(undefined, ["image/*"])).toBe(true);
  });

  it("matches an exact type and a wildcard prefix, rejects everything else", () => {
    expect(matchesAccept("text/plain", ["text/plain"])).toBe(true);
    expect(matchesAccept("image/png", ["image/*"])).toBe(true);
    expect(matchesAccept("application/zip", ["*/*"])).toBe(true);
    expect(matchesAccept("application/zip", ["image/*", "text/plain"])).toBe(false);
  });
});

describe("createAndroidFilePicker — document-picker branch (no accept filter, or a non-image-only one)", () => {
  it("returns picked files with lazy readAsBytes delegating to the injected reader", async () => {
    const readBytes = vi.fn(async (uri: string) => {
      expect(uri).toBe("content://provider/doc.txt");
      return new Uint8Array([9, 9]);
    });
    const documentPicker = fakeDocumentPicker({
      canceled: false,
      assets: [
        { uri: "content://provider/doc.txt", name: "doc.txt", size: 42, mimeType: "text/plain" },
      ],
    });
    const picker = createAndroidFilePicker(buildDeps({ documentPicker, readBytes }));

    const files = await picker.pickFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: "doc.txt", size: 42, mimeType: "text/plain" });
    expect(readBytes).not.toHaveBeenCalled();

    const bytes = await files[0].readAsBytes();
    expect(bytes).toEqual(new Uint8Array([9, 9]));
    expect(readBytes).toHaveBeenCalledTimes(1);
  });

  it("resolves an empty array when the user cancels — never a rejection", async () => {
    const documentPicker = fakeDocumentPicker({ canceled: true });
    const picker = createAndroidFilePicker(buildDeps({ documentPicker }));

    await expect(picker.pickFiles({ accept: ["text/*"] })).resolves.toEqual([]);
  });

  it("forwards accept/multiple to getDocumentAsync, defaulting to a wide-open filter", async () => {
    const documentPicker = fakeDocumentPicker({ canceled: true });
    const picker = createAndroidFilePicker(buildDeps({ documentPicker }));

    await picker.pickFiles();
    expect(documentPicker.calls[0]).toMatchObject({ type: "*/*", multiple: false });

    await picker.pickFiles({ accept: ["text/plain", "application/pdf"], multiple: true });
    expect(documentPicker.calls[1]).toMatchObject({
      type: ["text/plain", "application/pdf"],
      multiple: true,
    });
  });

  it("rejects with FILE_PICKER_UNSUPPORTED_TYPE when a provider ignores the requested type filter", async () => {
    const documentPicker = fakeDocumentPicker({
      canceled: false,
      assets: [
        { uri: "content://provider/x.exe", name: "x.exe", mimeType: "application/x-msdownload" },
      ],
    });
    const picker = createAndroidFilePicker(buildDeps({ documentPicker }));

    await expect(picker.pickFiles({ accept: ["text/plain"] })).rejects.toThrow(
      FILE_PICKER_UNSUPPORTED_TYPE,
    );
  });
});

describe("createAndroidFilePicker — image-library branch (accept is image-only)", () => {
  it("routes an image-only accept to the permission-gated image picker, not the document picker", async () => {
    const documentPicker = fakeDocumentPicker({ canceled: true });
    const imageLibraryPicker = fakeImagePicker({
      canceled: false,
      assets: [
        { uri: "content://media/1.png", fileName: "1.png", fileSize: 10, mimeType: "image/png" },
      ],
    });
    const picker = createAndroidFilePicker(
      buildDeps({
        documentPicker,
        imageLibraryPicker,
        imageLibraryPermission: fixedPermission("granted"),
      }),
    );

    const files = await picker.pickFiles({ accept: ["image/*"] });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: "1.png", size: 10, mimeType: "image/png" });
    expect(documentPicker.calls).toHaveLength(0);
  });

  it("resolves an empty array when the image picker is cancelled", async () => {
    const imageLibraryPicker = fakeImagePicker({ canceled: true });
    const picker = createAndroidFilePicker(
      buildDeps({ imageLibraryPicker, imageLibraryPermission: fixedPermission("granted") }),
    );

    await expect(picker.pickFiles({ accept: ["image/*"] })).resolves.toEqual([]);
  });

  it("prompts exactly once when the permission is undetermined, then proceeds once granted", async () => {
    const imageLibraryPicker = fakeImagePicker({ canceled: true });
    const permission = scriptedPermission("undetermined", "granted");
    const requestSpy = vi.spyOn(permission, "requestPermission");
    const picker = createAndroidFilePicker(
      buildDeps({ imageLibraryPicker, imageLibraryPermission: permission }),
    );

    await picker.pickFiles({ accept: ["image/*"] });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects with FILE_PICKER_PERMISSION_DENIED on a plain denial, without ever opening the picker", async () => {
    const imageLibraryPicker = fakeImagePicker({ canceled: true });
    const picker = createAndroidFilePicker(
      buildDeps({ imageLibraryPicker, imageLibraryPermission: fixedPermission("denied") }),
    );

    await expect(picker.pickFiles({ accept: ["image/*"] })).rejects.toThrow(
      FILE_PICKER_PERMISSION_DENIED,
    );
    expect(imageLibraryPicker.calls).toHaveLength(0);
  });

  it("rejects with FILE_PICKER_PERMISSION_DENIED_PERMANENTLY on Android's 'don't ask again' state", async () => {
    const picker = createAndroidFilePicker(
      buildDeps({ imageLibraryPermission: fixedPermission("denied-permanently") }),
    );

    await expect(picker.pickFiles({ accept: ["image/*"] })).rejects.toThrow(
      FILE_PICKER_PERMISSION_DENIED_PERMANENTLY,
    );
  });

  it("rejects with FILE_PICKER_UNAVAILABLE when there is no permission module to ask at all", async () => {
    const picker = createAndroidFilePicker(
      buildDeps({ imageLibraryPermission: fixedPermission("unavailable") }),
    );

    await expect(picker.pickFiles({ accept: ["image/*"] })).rejects.toThrow(
      FILE_PICKER_UNAVAILABLE,
    );
  });

  it("passes through a picked file's size unchanged, even when it exceeds MAX_UPLOAD_BYTES — oversize is not this module's job", async () => {
    const hugeSize = 200 * 1024 * 1024;
    const documentPicker = fakeDocumentPicker({
      canceled: false,
      assets: [{ uri: "content://provider/huge.bin", name: "huge.bin", size: hugeSize }],
    });
    const picker = createAndroidFilePicker(buildDeps({ documentPicker }));

    const files = await picker.pickFiles();
    expect(files[0]?.size).toBe(hugeSize);
  });
});

describe("createUnavailableFilePicker", () => {
  it("always rejects with FILE_PICKER_UNAVAILABLE", async () => {
    const picker = createUnavailableFilePicker();
    await expect(picker.pickFiles()).rejects.toThrow(FILE_PICKER_UNAVAILABLE);
  });
});
