import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { describe, expect, it } from "vitest";

import { progressValueOf, statusToneOf, summarizeRailElement } from "./summarize-rail-element.js";

function element(kind: PiUiElement["kind"], payload?: unknown): PiUiElement {
  return {
    id: "el",
    ns: "ns",
    kind,
    placement: "pinned",
    title: "Title",
    payload,
  } as PiUiElement;
}

describe("summarizeRailElement", () => {
  it("falls back safely when there is no payload at all", () => {
    expect(summarizeRailElement(element("widget", undefined))).toBe("No further details");
  });

  it("summarizes status from text, falling back to detail", () => {
    expect(summarizeRailElement(element("status", { kind: "status", text: "Reviewing" }))).toBe(
      "Reviewing",
    );
    expect(
      summarizeRailElement(element("status", { kind: "status", detail: "Waiting on input" })),
    ).toBe("Waiting on input");
  });

  it("summarizes widget from text, then lines, then rows", () => {
    expect(summarizeRailElement(element("widget", { kind: "widget", text: "3 of 7 done" }))).toBe(
      "3 of 7 done",
    );
    expect(
      summarizeRailElement(element("widget", { kind: "widget", lines: ["a", "b", "c"] })),
    ).toBe("3 line(s)");
    expect(
      summarizeRailElement(element("widget", { kind: "widget", rows: [{}, {}] as unknown[] })),
    ).toBe("2 row(s)");
  });

  it("summarizes panel by section count", () => {
    expect(
      summarizeRailElement(
        element("panel", { kind: "panel", sections: [{ id: "1", kind: "log" }] }),
      ),
    ).toBe("1 section(s)");
    expect(summarizeRailElement(element("panel", { kind: "panel", sections: [] }))).toBe(
      "Composed panel",
    );
  });

  it("summarizes progress: indeterminate, value/max, value-only, then unknown", () => {
    expect(
      summarizeRailElement(element("progress", { kind: "progress", indeterminate: true })),
    ).toBe("In progress");
    expect(summarizeRailElement(element("progress", { kind: "progress", value: 2, max: 5 }))).toBe(
      "2/5",
    );
    expect(summarizeRailElement(element("progress", { kind: "progress", value: 0.5 }))).toBe("50%");
    expect(summarizeRailElement(element("progress", { kind: "progress" }))).toBe("Progress");
  });

  it("summarizes roster with a running-count callout", () => {
    expect(
      summarizeRailElement(
        element("roster", {
          kind: "roster",
          rows: [
            { id: "1", label: "a", state: "running" },
            { id: "2", label: "b", state: "done" },
            { id: "3", label: "c", state: "running" },
          ],
        }),
      ),
    ).toBe("3 row(s) • 2 running");
    expect(
      summarizeRailElement(
        element("roster", { kind: "roster", rows: [{ id: "1", label: "a", state: "done" }] }),
      ),
    ).toBe("1 row(s)");
  });

  it("summarizes log by line count", () => {
    expect(summarizeRailElement(element("log", { kind: "log", lines: ["a", "b"] }))).toBe(
      "2 line(s)",
    );
  });

  it("truncates long markdown", () => {
    const text = "x".repeat(200);
    const summary = summarizeRailElement(element("markdown", { kind: "markdown", text }));
    expect(summary.length).toBe(96);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("summarizes diff by file path, falling back to a generic label", () => {
    expect(
      summarizeRailElement(
        element("diff", { kind: "diff", unifiedDiff: "@@", filePath: "src/a.ts" }),
      ),
    ).toBe("src/a.ts");
    expect(summarizeRailElement(element("diff", { kind: "diff", unifiedDiff: "@@" }))).toBe(
      "Unified diff",
    );
  });

  it("summarizes form by field count", () => {
    expect(
      summarizeRailElement(
        element("form", {
          kind: "form",
          fields: [{ kind: "toggle", id: "a", label: "A" }],
        }),
      ),
    ).toBe("1 field(s)");
  });

  it("summarizes composer by mode", () => {
    expect(
      summarizeRailElement(element("composer", { kind: "composer", text: "hi", mode: "prefill" })),
    ).toBe("Draft prefill");
    expect(summarizeRailElement(element("composer", { kind: "composer", text: "hi" }))).toBe(
      "Composer update",
    );
  });
});

describe("progressValueOf", () => {
  it("returns null for indeterminate progress", () => {
    expect(progressValueOf({ kind: "progress", indeterminate: true })).toBeNull();
  });

  it("normalizes value/max to a 0-1 fraction", () => {
    expect(progressValueOf({ kind: "progress", value: 1, max: 4 })).toBe(0.25);
  });

  it("falls back to a bare 0-1 value, then null", () => {
    expect(progressValueOf({ kind: "progress", value: 0.75 })).toBe(0.75);
    expect(progressValueOf({ kind: "progress" })).toBeNull();
  });

  it("does not divide by a zero max", () => {
    expect(progressValueOf({ kind: "progress", value: 1, max: 0 })).toBe(1);
  });
});

describe("statusToneOf", () => {
  it("maps every Pi UI tone to a StatusIndicator tone", () => {
    expect(statusToneOf("default")).toBe("neutral");
    expect(statusToneOf("accent")).toBe("info");
    expect(statusToneOf("success")).toBe("success");
    expect(statusToneOf("warning")).toBe("warning");
    expect(statusToneOf("error")).toBe("danger");
    expect(statusToneOf(undefined)).toBe("neutral");
  });
});
