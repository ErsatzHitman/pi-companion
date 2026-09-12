/**
 * T32S11 coverage for the real `createExpoFilePicker` adapter.
 *
 * Same technique as `../features/composer/expo-attachment-source-port.test.ts`:
 * `expo-document-picker` and `expo-image-picker` each transitively import
 * `react-native` (via `expo-modules-core`'s `Platform.ts`), which this
 * workspace's plain `vitest` setup cannot transform (the "RN-in-vitest
 * limitation" — see `expo-file-picker.ts`'s own header). Both packages are
 * replaced with controllable fixtures via `vi.mock` factories, hoisted to
 * the top of this file, before the module under test is imported — so the
 * real native packages are never actually loaded here in ANY test.
 *
 * Two proof strategies, mirroring the sibling adapter's own suite:
 *  - Most of this suite injects a plain fake `ExpoFilePickerBindings`
 *    directly (no interaction with the mocked fixtures at all) to prove the
 *    port's own composition logic: permission maps onto this app's
 *    `PermissionState`, an image-only accept routes to the image picker, and
 *    a picked asset's fields flow through unchanged.
 *  - The last block proves `DEFAULT_BINDINGS` itself — the object that
 *    actually wires to the two native packages — by calling
 *    `createExpoFilePicker()` with NO arguments and reading the mocked
 *    fixtures' own recorded calls.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  ExpoFilePickerBindings,
  ExpoMediaLibraryPermissionResponse,
} from "./expo-file-picker.js";

const documentPickerFixture = vi.hoisted(() => {
  const state = {
    canceled: true as boolean,
    calls: [] as unknown[],
  };
  return {
    state,
    reset() {
      state.canceled = true;
      state.calls = [];
    },
  };
});

const imagePickerFixture = vi.hoisted(() => {
  const state = {
    canceled: true as boolean,
    calls: [] as unknown[],
    permission: {
      granted: false,
      status: "undetermined",
      canAskAgain: true,
    } as ExpoMediaLibraryPermissionResponse,
    permissionCalls: 0,
  };
  return {
    state,
    reset() {
      state.canceled = true;
      state.calls = [];
      state.permission = { granted: false, status: "undetermined", canAskAgain: true };
      state.permissionCalls = 0;
    },
  };
});

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: async (options: unknown) => {
    documentPickerFixture.state.calls.push(options);
    return documentPickerFixture.state.canceled
      ? { canceled: true }
      : {
          canceled: false,
          assets: [
            {
              uri: "file:///cache/report.pdf",
              name: "report.pdf",
              size: 3,
              mimeType: "application/pdf",
            },
          ],
        };
  },
}));

vi.mock("expo-image-picker", () => ({
  getMediaLibraryPermissionsAsync: async () => {
    imagePickerFixture.state.permissionCalls += 1;
    return imagePickerFixture.state.permission;
  },
  requestMediaLibraryPermissionsAsync: async () => {
    imagePickerFixture.state.permissionCalls += 1;
    return imagePickerFixture.state.permission;
  },
  launchImageLibraryAsync: async (options: unknown) => {
    imagePickerFixture.state.calls.push(options);
    return imagePickerFixture.state.canceled
      ? { canceled: true }
      : {
          canceled: false,
          assets: [
            {
              uri: "file:///cache/photo.png",
              fileName: "photo.png",
              fileSize: 3,
              mimeType: "image/png",
            },
          ],
        };
  },
}));

const { createExpoFilePicker } = await import("./expo-file-picker.js");

function buildBindings(overrides: Partial<ExpoFilePickerBindings> = {}): ExpoFilePickerBindings {
  return {
    documentPicker: { getDocumentAsync: async () => ({ canceled: true }) },
    imageLibraryPicker: { launchImageLibraryAsync: async () => ({ canceled: true }) },
    getMediaLibraryPermissionsAsync: async () => ({
      granted: true,
      status: "granted",
      canAskAgain: true,
    }),
    requestMediaLibraryPermissionsAsync: async () => ({
      granted: true,
      status: "granted",
      canAskAgain: true,
    }),
    readBytes: async () => new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

describe("createExpoFilePicker — media-library permission mapping", () => {
  async function refusalMessage(
    response: ExpoMediaLibraryPermissionResponse,
  ): Promise<string | null> {
    const picker = createExpoFilePicker(
      buildBindings({
        getMediaLibraryPermissionsAsync: async () => response,
        // A read that already settles on a non-undetermined state never
        // reaches this, so its response is irrelevant to the denial cases.
        requestMediaLibraryPermissionsAsync: async () => response,
      }),
    );
    try {
      await picker.pickFiles({ accept: ["image/*"] });
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }

  it("maps a granted media-library response onto a working pick, and a denial onto the port's own sentinel", async () => {
    expect(
      await refusalMessage({ granted: true, status: "granted", canAskAgain: true }),
    ).toBeNull();
    expect(await refusalMessage({ granted: false, status: "denied", canAskAgain: true })).toBe(
      "FILE_PICKER_PERMISSION_DENIED",
    );
    expect(await refusalMessage({ granted: false, status: "denied", canAskAgain: false })).toBe(
      "FILE_PICKER_PERMISSION_DENIED_PERMANENTLY",
    );
  });

  it("an undetermined read prompts exactly once and then proceeds on the request's answer", async () => {
    const permissionRequests: number[] = [];
    const picker = createExpoFilePicker(
      buildBindings({
        getMediaLibraryPermissionsAsync: async () => ({
          granted: false,
          status: "undetermined",
          canAskAgain: true,
        }),
        requestMediaLibraryPermissionsAsync: async () => {
          permissionRequests.push(1);
          return { granted: true, status: "granted", canAskAgain: true };
        },
      }),
    );

    await expect(picker.pickFiles({ accept: ["image/*"] })).resolves.toEqual([]);
    expect(permissionRequests).toHaveLength(1);
  });
});

describe("createExpoFilePicker — routing", () => {
  it("sends a non-image accept to the document picker and an image-only accept to the image picker", async () => {
    const documentCalls: unknown[] = [];
    const imageCalls: unknown[] = [];
    const picker = createExpoFilePicker(
      buildBindings({
        documentPicker: {
          getDocumentAsync: async (options) => {
            documentCalls.push(options);
            return { canceled: true };
          },
        },
        imageLibraryPicker: {
          launchImageLibraryAsync: async (options) => {
            imageCalls.push(options);
            return { canceled: true };
          },
        },
      }),
    );

    await picker.pickFiles({ accept: ["application/pdf"] });
    await picker.pickFiles({ accept: ["image/*"] });

    expect(documentCalls).toHaveLength(1);
    expect(imageCalls).toHaveLength(1);
  });

  it("maps a picked document's fields and reads its uri lazily through the injected reader", async () => {
    const readBytes = vi.fn(async () => new Uint8Array([7, 7]));
    const picker = createExpoFilePicker(
      buildBindings({
        documentPicker: {
          getDocumentAsync: async () => ({
            canceled: false,
            assets: [
              {
                uri: "file:///cache/report.pdf",
                name: "report.pdf",
                size: 3,
                mimeType: "application/pdf",
              },
            ],
          }),
        },
        readBytes,
      }),
    );

    const files = await picker.pickFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: "report.pdf", mimeType: "application/pdf", size: 3 });
    expect(readBytes).not.toHaveBeenCalled();
    await files[0]!.readAsBytes();
    expect(readBytes).toHaveBeenCalledWith("file:///cache/report.pdf");
  });
});

describe("createExpoFilePicker — DEFAULT_BINDINGS wire the real packages", () => {
  it("calls expo-document-picker's getDocumentAsync for a generic pick", async () => {
    documentPickerFixture.reset();
    const picker = createExpoFilePicker();

    const files = await picker.pickFiles({ accept: ["application/pdf"], multiple: true });

    expect(documentPickerFixture.state.calls).toHaveLength(1);
    expect(documentPickerFixture.state.calls[0]).toMatchObject({
      type: ["application/pdf"],
      multiple: true,
      copyToCacheDirectory: true,
    });
    expect(files).toEqual([]);
  });

  it("reads expo-image-picker's media-library permission and launches its picker for an image-only accept", async () => {
    imagePickerFixture.reset();
    imagePickerFixture.state.permission = { granted: true, status: "granted", canAskAgain: true };
    const picker = createExpoFilePicker();

    await picker.pickFiles({ accept: ["image/*"] });

    expect(imagePickerFixture.state.permissionCalls).toBe(1);
    expect(imagePickerFixture.state.calls).toHaveLength(1);
  });
});
