import { describe, expect, it } from "vitest";

import { ACCEPTED_FILE_MIME_TYPES } from "./share-intent-model";
import { buildShareIntentFilters } from "./share-intent-config";
import type { ShareIntentFilter } from "./share-intent-config";

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

/**
 * T201: `app.config.ts` can no longer call `buildShareIntentFilters()`
 * directly (`@expo/require-utils`'s loader has no `.ts` handler for a
 * nested `require`, so a two-hop-deep relative TypeScript import from
 * `app.config.ts` fails — see `share-intent-config.ts`'s doc comment).
 * `app.config.ts` now builds its `android.intentFilters` inline from
 * `accepted-file-mime-types.json` instead, so the assertions above (on
 * `buildShareIntentFilters()` alone) no longer say anything about what
 * the real Expo config declares. These assertions import `app.config.ts`
 * itself and check its ACTUAL `android.intentFilters` output — the
 * config `expo prebuild`/`expo config` really reads.
 */
describe("app.config.ts's real android.intentFilters", () => {
  it("equals buildShareIntentFilters()'s output — proves the inline build in app.config.ts has not drifted from this feature's reference derivation", async () => {
    const { default: config } = await import("../../../app.config");
    expect(config.android?.intentFilters).toEqual(buildShareIntentFilters());
  });

  it("names every entry of ACCEPTED_FILE_MIME_TYPES plus text/plain, and nothing else", async () => {
    const { default: config } = await import("../../../app.config");
    const filters = (config.android?.intentFilters ?? []) as unknown as ShareIntentFilter[];
    const declaredMimeTypes = filters.flatMap((filter) =>
      filter.data.map((entry) => entry.mimeType),
    );
    expect(declaredMimeTypes.sort()).toEqual(["text/plain", ...ACCEPTED_FILE_MIME_TYPES].sort());
  });

  it("every filter is a plain SEND filter — never SEND_MULTIPLE", async () => {
    const { default: config } = await import("../../../app.config");
    const filters = (config.android?.intentFilters ?? []) as unknown as ShareIntentFilter[];
    expect(filters.length).toBeGreaterThan(0);
    for (const filter of filters) {
      expect(filter.action).toBe("SEND");
    }
  });
});
