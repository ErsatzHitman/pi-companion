import { describe, expect, it } from "vitest";

import {
  SESSION_PILL_STATES,
  buildTranscriptHeaderViewModel,
  deriveCwdBasename,
} from "./header-model";
import { TRANSCRIPT_STATUSES } from "./status-model";

describe("buildTranscriptHeaderViewModel", () => {
  const base = { hostLabel: "macbook-pro.local", sessionTitle: "Refactor auth module" };

  it("uses the session title as the bar title and the cwd basename as the subtitle", () => {
    const model = buildTranscriptHeaderViewModel({
      ...base,
      cwd: "/home/akshat/code/pi-companion",
      status: "connected",
    });
    expect(model.title).toBe(base.sessionTitle);
    expect(model.subtitle).toBe("pi-companion");
  });

  it("draws no subtitle at all when the daemon has not reported a cwd yet", () => {
    const model = buildTranscriptHeaderViewModel({ ...base, status: "connected" });
    expect(model.subtitle).toBe("");
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

  it("keeps announcing the host even though the bar no longer draws it", () => {
    const model = buildTranscriptHeaderViewModel({
      ...base,
      cwd: "/srv/projects/pi-companion",
      status: "connected",
    });
    expect(model.subtitle).not.toContain(base.hostLabel);
    expect(model.accessibilityLabel).toContain(base.hostLabel);
    expect(model.accessibilityLabel).toContain("pi-companion");
  });

  it("keeps title/subtitle stable while status-derived tone/chipLabel change with status", () => {
    const withCwd = { ...base, cwd: "/w/proj" };
    const connected = buildTranscriptHeaderViewModel({ ...withCwd, status: "connected" });
    const error = buildTranscriptHeaderViewModel({ ...withCwd, status: "error" });

    expect(connected.title).toBe(error.title);
    expect(connected.subtitle).toBe(error.subtitle);
    expect(connected.tone).not.toBe(error.tone);
    expect(connected.chipLabel).not.toBe(error.chipLabel);
  });

  it("folds a status detail into the accessibilityLabel but never into the pill's word", () => {
    const model = buildTranscriptHeaderViewModel({
      ...base,
      status: "error",
      statusDetail: "socket closed",
    });
    expect(model.accessibilityLabel).toContain("socket closed");
    expect(model.chipLabel).not.toContain("socket closed");
  });

  it("reports the session's own activity, not the connection's health, on the pill", () => {
    // A live socket with nothing running is the resting state, so the
    // pill is the artifact's neutral `idle` — not the green the status
    // strip correctly paints "Connected".
    const idle = buildTranscriptHeaderViewModel({ ...base, status: "connected" });
    expect(idle.chipLabel).toBe("Idle");
    expect(idle.tone).toBe("neutral");
    expect(idle.showDot).toBe(false);

    const working = buildTranscriptHeaderViewModel({ ...base, status: "streaming" });
    expect(working.chipLabel).toBe("Working");
    expect(working.tone).toBe("success");
    expect(working.showDot).toBe(true);
  });

  it("gives every status a pill word, and never two statuses the same word", () => {
    const words = TRANSCRIPT_STATUSES.map(
      (status) => buildTranscriptHeaderViewModel({ ...base, status }).chipLabel,
    );
    expect(words.every((word) => word.length > 0)).toBe(true);
    expect(new Set(words).size).toBe(TRANSCRIPT_STATUSES.length);
  });

  it("withholds the dot from exactly the two resting states", () => {
    const dotless = TRANSCRIPT_STATUSES.filter(
      (status) => !buildTranscriptHeaderViewModel({ ...base, status }).showDot,
    );
    expect([...dotless]).toEqual(["connected", "disconnected"]);
  });

  it("never leaves a pill word carrying colour as its only signal", () => {
    for (const state of Object.values(SESSION_PILL_STATES)) {
      expect(state.word.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("deriveCwdBasename", () => {
  it("takes the last segment of a POSIX path", () => {
    expect(deriveCwdBasename("/home/akshat/code/pi-companion")).toBe("pi-companion");
  });

  it("takes the last segment of a Windows path, because the daemon reports its own host's shape", () => {
    expect(deriveCwdBasename("D:\\work\\pi-companion")).toBe("pi-companion");
  });

  it("ignores a trailing separator, so /a/b/ and /a/b agree", () => {
    expect(deriveCwdBasename("/a/b/")).toBe(deriveCwdBasename("/a/b"));
    expect(deriveCwdBasename("/a/b/")).toBe("b");
  });

  it("collapses repeated separators rather than reporting an empty segment", () => {
    expect(deriveCwdBasename("/a//b")).toBe("b");
    expect(deriveCwdBasename("\\\\host\\share\\proj")).toBe("proj");
  });

  it("has no basename worth showing for a root path or an absent cwd", () => {
    expect(deriveCwdBasename("/")).toBe("");
    expect(deriveCwdBasename("C:\\")).toBe("C:");
    expect(deriveCwdBasename("")).toBe("");
    expect(deriveCwdBasename(undefined)).toBe("");
  });

  it("returns a bare directory name unchanged", () => {
    expect(deriveCwdBasename("pi-companion")).toBe("pi-companion");
  });
});
