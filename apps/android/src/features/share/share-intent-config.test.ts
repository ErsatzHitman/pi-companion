import { describe, expect, it } from "vitest";

import { ACCEPTED_FILE_MIME_TYPES } from "./share-intent-model";
import { buildShareIntentFilters } from "./share-intent-config";

describe("buildShareIntentFilters", () => {
  it("declares a text/plain SEND filter", () => {
    const filters = buildShareIntentFilters();
    const textFilter = filters.find((f) => f.data.some((d) => d.mimeType === "text/plain"));
    expect(textFilter).toBeDefined();
    expect(textFilter?.action).toBe("SEND");
    expect(textFilter?.data).toEqual([{ mimeType: "text/plain" }]);
  });

  it("declares exactly the allowlist's file MIME types — no more, no fewer", () => {
    const filters = buildShareIntentFilters();
    const fileFilter = filters.find((f) => f !== filters[0]);
    expect(fileFilter).toBeDefined();
    const declared = fileFilter?.data.map((d) => d.mimeType) ?? [];
    expect(declared).toEqual([...ACCEPTED_FILE_MIME_TYPES]);
  });

  it("never declares SEND_MULTIPLE", () => {
    const filters = buildShareIntentFilters();
    for (const filter of filters) {
      expect(filter.action).toBe("SEND");
      expect(filter.action).not.toBe("SEND_MULTIPLE");
    }
  });

  it("every declared MIME type is one classifyShareIntent actually accepts", async () => {
    const { classifyShareIntent } = await import("./share-intent-model");
    const filters = buildShareIntentFilters();
    for (const filter of filters) {
      for (const { mimeType } of filter.data) {
        if (mimeType === "text/plain") {
          const result = classifyShareIntent({ action: "SEND", mimeType, text: "hello" });
          expect(result.accepted).toBe(true);
          continue;
        }
        const result = classifyShareIntent({
          action: "SEND",
          mimeType,
          file: { name: "f", mimeType, sizeBytes: 10, uri: "content://x" },
        });
        expect(result.accepted).toBe(true);
      }
    }
  });
});
