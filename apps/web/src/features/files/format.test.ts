import { describe, expect, it } from "vitest";

import { formatFileSize, formatModifiedAt } from "./format.js";

describe("formatFileSize (T30B1)", () => {
  it("shows bytes below 1024 with a B unit", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("shows kilobytes with one decimal below 10 units", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("shows whole units at 10 or more", () => {
    expect(formatFileSize(12 * 1024)).toBe("12 KB");
  });

  it("scales up through MB/GB, keeping one decimal below 10 units", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("returns an em dash placeholder for invalid sizes", () => {
    expect(formatFileSize(Number.NaN)).toBe("—");
    expect(formatFileSize(-1)).toBe("—");
  });
});

describe("formatModifiedAt (T30B1)", () => {
  it("formats a known instant in UTC regardless of host time zone", () => {
    const formatted = formatModifiedAt("2026-01-15T09:30:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("Jan");
  });

  it("falls back to the raw string for an unparseable value", () => {
    expect(formatModifiedAt("not-a-date")).toBe("not-a-date");
  });
});
