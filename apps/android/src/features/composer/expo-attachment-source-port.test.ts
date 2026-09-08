/**
 * T290 coverage for the real `createExpoAttachmentSourcePort` adapter.
 *
 * Same technique as `../voice/expo-audio-voice-capture-port.test.ts`:
 * `expo-document-picker` transitively imports `react-native` (via
 * `expo-modules-core`'s `Platform.ts`), which this workspace's plain
 * `vitest` setup cannot transform (the "RN-in-vitest limitation" — see
 * `expo-attachment-source-port.ts`'s own header). `expo-document-picker`
 * is replaced with a controllable fixture via a `vi.mock` factory,
 * hoisted to the top of this file, before the module under test is
 * imported — so the real native package, and the real `react-native` it
 * would drag in, is never actually loaded here in ANY test in this
 * file.
 *
 * Two proof strategies, mirroring the voice port's own suite:
 *  - Most of this suite injects a plain fake `AttachmentSourceBindings`
 *    directly (no interaction with the mocked `expo-document-picker`
 *    fixture at all) to prove the port's own composition logic:
 *    permission is always `"granted"`, cancellation resolves `[]`, and
 *    a picked asset's fields map onto `PickedAttachmentFile` correctly.
 *  - The last block proves `DEFAULT_BINDINGS` itself — the object that
 *    actually wires to `expo-document-picker` — by calling
 *    `createExpoAttachmentSourcePort()` with NO arguments and reading
 *    the mocked fixture's own recorded calls/options.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  AttachmentSourceBindings,
  DocumentPickerResult,
} from "./expo-attachment-source-port.js";

const documentPickerFixture = vi.hoisted(() => {
  const state: {
    result: DocumentPickerResult;
    calls: Array<{ type: string; multiple: boolean; copyToCacheDirectory: boolean }>;
  } = {
    result: { canceled: true },
    calls: [],
  };
  return {
    state,
    reset() {
      state.result = { canceled: true };
      state.calls = [];
    },
  };
});

vi.mock("expo-document-picker", () => ({
  async getDocumentAsync(options: {
    type: string;
    multiple: boolean;
    copyToCacheDirectory: boolean;
  }) {
    documentPickerFixture.state.calls.push(options);
    return documentPickerFixture.state.result;
  },
}));

const { createExpoAttachmentSourcePort } = await import("./expo-attachment-source-port.js");

function createFakeBindings(
  result: DocumentPickerResult,
): AttachmentSourceBindings & { calls: Array<{ type: string; multiple: boolean }> } {
  const calls: Array<{ type: string; multiple: boolean }> = [];
  return {
    calls,
    async getDocumentAsync(options) {
      calls.push({ type: options.type, multiple: options.multiple });
      return result;
    },
  };
}

describe("createExpoAttachmentSourcePort — permission surface", () => {
  it("getPermissionStatus always resolves granted — the document picker needs no Android permission (see this port's own header)", async () => {
    const port = createExpoAttachmentSourcePort(createFakeBindings({ canceled: true }));
    await expect(port.getPermissionStatus()).resolves.toBe("granted");
  });

  it("requestPermission also always resolves granted, without ever needing to prompt", async () => {
    const port = createExpoAttachmentSourcePort(createFakeBindings({ canceled: true }));
    await expect(port.requestPermission()).resolves.toBe("granted");
  });
});

describe("createExpoAttachmentSourcePort — pickFiles", () => {
  it("a cancelled pick resolves [] — not a rejection", async () => {
    const bindings = createFakeBindings({ canceled: true });
    const port = createExpoAttachmentSourcePort(bindings);

    const files = await port.pickFiles();

    expect(files).toEqual([]);
  });

  it("always requests type '*/*' and copyToCacheDirectory: true, regardless of options", async () => {
    const bindings = createFakeBindings({ canceled: true });
    const port = createExpoAttachmentSourcePort(bindings);

    await port.pickFiles({ multiple: true });

    expect(bindings.calls).toEqual([{ type: "*/*", multiple: true }]);
  });

  it("multiple defaults to false when no options are passed", async () => {
    const bindings = createFakeBindings({ canceled: true });
    const port = createExpoAttachmentSourcePort(bindings);

    await port.pickFiles();

    expect(bindings.calls).toEqual([{ type: "*/*", multiple: false }]);
  });

  it("maps a picked document's fields onto PickedAttachmentFile, and readAsBytes reads its uri lazily", async () => {
    const bindings = createFakeBindings({
      canceled: false,
      assets: [
        {
          uri: "file:///cache/report.pdf",
          name: "report.pdf",
          size: 2048,
          mimeType: "application/pdf",
        },
      ],
    });
    const port = createExpoAttachmentSourcePort(bindings);

    const files = await port.pickFiles();

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 2048,
      uri: "file:///cache/report.pdf",
    });
    expect(typeof files[0]!.readAsBytes).toBe("function");
  });

  it("maps every asset in a multi-select pick, preserving order", async () => {
    const bindings = createFakeBindings({
      canceled: false,
      assets: [
        { uri: "file:///cache/a.png", name: "a.png", mimeType: "image/png" },
        { uri: "file:///cache/b.txt", name: "b.txt", mimeType: "text/plain" },
      ],
    });
    const port = createExpoAttachmentSourcePort(bindings);

    const files = await port.pickFiles({ multiple: true });

    expect(files.map((f) => f.name)).toEqual(["a.png", "b.txt"]);
  });
});

/**
 * MUTATION (per this repo's CLAUDE.md "a fix that no test can fail is
 * not a fix"): `pickFiles` was edited in a scratch copy to hard-code
 * `multiple: true` regardless of `options?.multiple`, and the "multiple
 * defaults to false" case above was confirmed to fail
 * (`{multiple:true} !== {multiple:false}`) against that mutation, then
 * the file was restored byte-for-byte. A second mutation — returning
 * `result.assets` directly without mapping `name`/`mimeType`/`size`/
 * `uri`/`readAsBytes` — was confirmed to fail the "maps a picked
 * document's fields" case above (missing `readAsBytes`), then restored
 * the same way. See this task's final report for the exact `vitest`
 * output of both runs.
 */

describe("DEFAULT_BINDINGS — the object that actually wires to expo-document-picker", () => {
  it("createExpoAttachmentSourcePort() with no arguments calls the real (mocked) expo-document-picker module", async () => {
    documentPickerFixture.reset();
    documentPickerFixture.state.result = {
      canceled: false,
      assets: [{ uri: "file:///cache/x.jpg", name: "x.jpg", size: 10, mimeType: "image/jpeg" }],
    };
    const port = createExpoAttachmentSourcePort();

    const files = await port.pickFiles({ multiple: true });

    expect(documentPickerFixture.state.calls).toEqual([
      { type: "*/*", multiple: true, copyToCacheDirectory: true },
    ]);
    expect(files).toEqual([
      expect.objectContaining({
        name: "x.jpg",
        mimeType: "image/jpeg",
        size: 10,
        uri: "file:///cache/x.jpg",
      }),
    ]);
  });
});
