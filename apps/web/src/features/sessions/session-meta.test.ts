import { describe, expect, it } from "vitest";

import {
  formatSessionAge,
  formatSessionTokens,
  sessionGlyph,
  sessionMetaParts,
  sessionModeLabel,
  sessionModelChipLabel,
} from "./session-meta.js";
import type { SessionSummary } from "./types.js";

const BASE: SessionSummary = {
  id: "s-1",
  title: "Refactor router",
  provider: "pi",
  cwd: "/repo/a",
  status: "idle",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const NOW = Date.parse("2026-01-01T00:00:00.000Z");

describe("sessionGlyph", () => {
  it("maps each real status to the reference glyph/tone pair", () => {
    expect(sessionGlyph({ ...BASE, status: "idle" })).toEqual({ glyph: "○", tone: "wait" });
    expect(sessionGlyph({ ...BASE, status: "running" })).toEqual({ glyph: "◐", tone: "now" });
    expect(sessionGlyph({ ...BASE, status: "initializing" })).toEqual({ glyph: "◐", tone: "now" });
    expect(sessionGlyph({ ...BASE, status: "closed" })).toEqual({ glyph: "✓", tone: "done" });
    expect(sessionGlyph({ ...BASE, status: "error" })).toEqual({ glyph: "◆", tone: "err" });
  });

  it("shows the hold glyph for a session that needs attention, unless it errored", () => {
    expect(sessionGlyph({ ...BASE, status: "idle", requiresAttention: true })).toEqual({
      glyph: "◆",
      tone: "hold",
    });
    // A real error outranks "needs attention": the failure is the fact.
    expect(sessionGlyph({ ...BASE, status: "error", requiresAttention: true })).toEqual({
      glyph: "◆",
      tone: "err",
    });
  });
});

describe("formatSessionAge", () => {
  it("renders the reference's 'now' for a just-updated session", () => {
    expect(formatSessionAge("2026-01-01T00:00:00.000Z", NOW)).toBe("now");
  });

  it("steps through minutes, hours, and days", () => {
    expect(formatSessionAge("2025-12-31T23:55:00.000Z", NOW)).toBe("5m");
    expect(formatSessionAge("2025-12-31T21:00:00.000Z", NOW)).toBe("3h");
    expect(formatSessionAge("2025-12-29T00:00:00.000Z", NOW)).toBe("3d");
  });

  it("clamps a future timestamp to 'now' rather than a negative age", () => {
    expect(formatSessionAge("2026-01-01T00:05:00.000Z", NOW)).toBe("now");
  });

  it("returns null for an unparseable timestamp so the caller omits the part", () => {
    expect(formatSessionAge("not-a-date", NOW)).toBeNull();
  });
});

describe("formatSessionTokens", () => {
  it("matches the reference's k/M formatting", () => {
    expect(formatSessionTokens(131_600)).toBe("131.6k");
    expect(formatSessionTokens(1_240_000)).toBe("1.2M");
    expect(formatSessionTokens(940)).toBe("940");
  });
});

describe("sessionMetaParts", () => {
  it("joins only the parts a session really carries", () => {
    expect(sessionMetaParts({ ...BASE, model: "opus-5" }, NOW)).toEqual(["now", "opus-5"]);
    expect(
      sessionMetaParts(
        { ...BASE, model: "opus-5", lastUsage: { contextWindowUsedTokens: 131_600 } },
        NOW,
      ),
    ).toEqual(["now", "131.6k", "opus-5"]);
  });

  it("omits the tokens and model parts when the session carries neither", () => {
    expect(sessionMetaParts(BASE, NOW)).toEqual(["now"]);
    expect(sessionMetaParts({ ...BASE, model: null }, NOW)).toEqual(["now"]);
  });

  it("ignores a non-finite usage figure rather than printing NaN", () => {
    expect(
      sessionMetaParts({ ...BASE, lastUsage: { contextWindowUsedTokens: Number.NaN } }, NOW),
    ).toEqual(["now"]);
  });
});

describe("sessionModeLabel", () => {
  it("resolves the current mode through the daemon's own labels", () => {
    expect(
      sessionModeLabel({
        ...BASE,
        currentModeId: "plan",
        availableModes: [
          { id: "default", label: "Build" },
          { id: "plan", label: "Plan" },
        ],
      }),
    ).toBe("Plan");
  });

  it("shows a real id the snapshot does not describe rather than dropping it", () => {
    expect(sessionModeLabel({ ...BASE, currentModeId: "custom" })).toBe("custom");
  });

  it("returns null when the provider reports no current mode", () => {
    expect(sessionModeLabel({ ...BASE, currentModeId: null })).toBeNull();
    expect(sessionModeLabel(BASE)).toBeNull();
  });
});

describe("sessionModelChipLabel", () => {
  it("pairs the model with the thinking effort when both are real", () => {
    expect(sessionModelChipLabel({ ...BASE, model: "opus-5", thinkingOptionId: "xhigh" })).toBe(
      "opus-5 · xhigh",
    );
  });

  it("omits whichever half is absent", () => {
    expect(sessionModelChipLabel({ ...BASE, model: "opus-5" })).toBe("opus-5");
    expect(sessionModelChipLabel({ ...BASE, thinkingOptionId: "high" })).toBe("high");
    expect(sessionModelChipLabel({ ...BASE, model: null, thinkingOptionId: null })).toBeNull();
  });
});
