import { describe, expect, it } from "vitest";

import { buildTranscriptHeaderViewModel } from "./header-model";

describe("buildTranscriptHeaderViewModel", () => {
  const base = { hostLabel: "macbook-pro.local", sessionTitle: "Refactor auth module" };

  it("uses the session title as the header title and the host label as the subtitle", () => {
    const model = buildTranscriptHeaderViewModel({ ...base, status: "connected" });
    expect(model.title).toBe(base.sessionTitle);
    expect(model.subtitle).toBe(base.hostLabel);
  });

  it("falls back to a placeholder title when the session has no title yet", () => {
    const blank = buildTranscriptHeaderViewModel({
      ...base,
      sessionTitle: "   ",
      status: "connected",
    });
    const empty = buildTranscriptHeaderViewModel({
      ...base,
      sessionTitle: "",
      status: "connected",
    });
    expect(blank.title).toBe("Untitled session");
    expect(empty.title).toBe("Untitled session");
  });

  it("produces a distinct accessibilityLabel for each of connected/reconnecting/streaming/error", () => {
    const statuses = ["connected", "reconnecting", "streaming", "error"] as const;
    const labels = statuses.map(
      (status) => buildTranscriptHeaderViewModel({ ...base, status }).accessibilityLabel,
    );

    expect(new Set(labels).size).toBe(statuses.length);
    for (const label of labels) {
      expect(label).toContain(base.sessionTitle);
      expect(label).toContain(base.hostLabel);
    }
  });

  it("keeps title/subtitle stable while status-derived tone/chipLabel change with status", () => {
    const connected = buildTranscriptHeaderViewModel({ ...base, status: "connected" });
    const error = buildTranscriptHeaderViewModel({ ...base, status: "error" });

    expect(connected.title).toBe(error.title);
    expect(connected.subtitle).toBe(error.subtitle);
    expect(connected.tone).not.toBe(error.tone);
    expect(connected.chipLabel).not.toBe(error.chipLabel);
  });

  it("folds a status detail into the accessibilityLabel", () => {
    const model = buildTranscriptHeaderViewModel({
      ...base,
      status: "error",
      statusDetail: "socket closed",
    });
    expect(model.accessibilityLabel).toContain("socket closed");
  });
});
