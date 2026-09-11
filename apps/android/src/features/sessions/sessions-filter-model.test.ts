import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_FILTER_CHIP_ID,
  SESSION_FILTER_CHIPS,
  filterSessionGroups,
  isSessionFilterActive,
  matchesSessionQuery,
  sessionFilterChipAccessibilityLabel,
  sessionFilterChipById,
  sessionFilterEmptyMessage,
  sessionGroupLabel,
} from "./sessions-filter-model";
import { groupSessionRows, type SessionRowModel, type SessionSummary } from "./sessions-model";

function session(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: null,
    provider: "pi",
    cwd: "/w/pi-companion",
    status: "idle",
    updatedAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

function row(overrides: Partial<SessionRowModel>): SessionRowModel {
  return {
    id: "s1",
    title: "Refactor the composer",
    tone: "neutral",
    statusText: "Idle",
    meta: "pi · /w/pi-companion",
    accessibilityLabel: "Refactor the composer, Idle, pi · /w/pi-companion",
    ...overrides,
  };
}

describe("SESSION_FILTER_CHIPS (T362)", () => {
  it("is the artifact's four chips, in its order", () => {
    expect(SESSION_FILTER_CHIPS.map((chip) => chip.label)).toEqual([
      "All",
      "Active",
      "Idle",
      "Needs you",
    ]);
  });

  it("narrows to a group kind, never to a raw status", () => {
    // `categorizeSession` already folds `requiresAttention` and an
    // `error` status into "needs attention"; a chip reading status
    // itself would disagree with the heading over the rows it filtered.
    expect(SESSION_FILTER_CHIPS.map((chip) => chip.group)).toEqual([
      null,
      "active",
      "idle",
      "needs-attention",
    ]);
  });

  it("starts on a chip that hides nothing", () => {
    expect(sessionFilterChipById(DEFAULT_SESSION_FILTER_CHIP_ID).group).toBeNull();
  });

  it("falls back to All for an id nothing defines", () => {
    expect(sessionFilterChipById("archived").label).toBe("All");
  });
});

describe("matchesSessionQuery (T362)", () => {
  it("matches the title case-insensitively", () => {
    expect(matchesSessionQuery(row({}), "COMPOSER")).toBe(true);
  });

  it("matches the meta line too, so a working directory finds its sessions", () => {
    // Two untitled sessions are often distinguished only by their cwd.
    expect(matchesSessionQuery(row({ title: "Untitled session" }), "pi-companion")).toBe(true);
  });

  it("keeps every row for an empty or all-whitespace query", () => {
    expect(matchesSessionQuery(row({}), "")).toBe(true);
    expect(matchesSessionQuery(row({}), "   ")).toBe(true);
  });

  it("hides a row nothing in it matches", () => {
    expect(matchesSessionQuery(row({}), "terminal")).toBe(false);
  });
});

describe("filterSessionGroups (T362)", () => {
  const groups = groupSessionRows([
    session({ id: "a", title: "Running one", status: "running" }),
    session({ id: "b", title: "Resting one", status: "idle" }),
    session({ id: "c", title: "Stuck one", status: "error" }),
  ]);

  it("passes every group through on All with no query", () => {
    const filtered = filterSessionGroups(groups, { chipId: "all", query: "" });
    expect(filtered.map((group) => group.kind)).toEqual(["needs-attention", "active", "idle"]);
  });

  it("keeps only the chip's own group", () => {
    const filtered = filterSessionGroups(groups, { chipId: "needs-you", query: "" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.rows.map((r) => r.id)).toEqual(["c"]);
  });

  it("drops a group the query empties rather than rendering a bare heading", () => {
    const filtered = filterSessionGroups(groups, { chipId: "all", query: "Running" });
    expect(filtered.map((group) => group.kind)).toEqual(["active"]);
  });

  it("returns nothing at all when the chip and the query disagree", () => {
    expect(filterSessionGroups(groups, { chipId: "idle", query: "Running" })).toEqual([]);
  });

  it("leaves the groups it was given untouched", () => {
    filterSessionGroups(groups, { chipId: "idle", query: "" });
    expect(groups).toHaveLength(3);
  });
});

describe("sessionGroupLabel (T362)", () => {
  it("is the artifact's name-and-count heading", () => {
    const groups = groupSessionRows([
      session({ id: "a", status: "idle" }),
      session({ id: "b", status: "idle" }),
    ]);
    expect(sessionGroupLabel(groups[0]!)).toBe("Idle · 2");
  });

  it("counts what is drawn, not what the group started with", () => {
    const groups = groupSessionRows([
      session({ id: "a", title: "Keep me", status: "idle" }),
      session({ id: "b", title: "Hide me", status: "idle" }),
    ]);
    const filtered = filterSessionGroups(groups, { chipId: "all", query: "Keep" });
    expect(sessionGroupLabel(filtered[0]!)).toBe("Idle · 1");
  });
});

describe("sessionFilterEmptyMessage (T362)", () => {
  it("says nothing while nothing is being hidden", () => {
    // The screen's own empty state is then the honest thing to draw.
    expect(sessionFilterEmptyMessage({ chipId: "all", query: "" })).toBeNull();
    expect(sessionFilterEmptyMessage({ chipId: "all", query: "  " })).toBeNull();
  });

  it("names the query when only the search is narrowing", () => {
    expect(sessionFilterEmptyMessage({ chipId: "all", query: "terminal" })).toBe(
      'No sessions match "terminal". Clear the search to see them all.',
    );
  });

  it("names the chip when only it is narrowing", () => {
    expect(sessionFilterEmptyMessage({ chipId: "needs-you", query: "" })).toBe(
      "No needs you sessions right now. Pick All to see the others.",
    );
  });

  it("names both when both are", () => {
    expect(sessionFilterEmptyMessage({ chipId: "idle", query: "web" })).toBe(
      'No idle sessions match "web". Clear the search or pick All.',
    );
  });

  it("never claims there are no sessions at all", () => {
    // That sentence belongs to the empty state, and it would send a
    // reader to create a session they already have.
    for (const chipId of SESSION_FILTER_CHIPS.map((chip) => chip.id)) {
      const message = sessionFilterEmptyMessage({ chipId, query: "x" });
      expect(message).not.toBeNull();
      expect(message).toMatch(/Clear the search/);
    }
  });
});

describe("isSessionFilterActive (T362)", () => {
  it("is false only on All with nothing typed", () => {
    expect(isSessionFilterActive({ chipId: "all", query: " " })).toBe(false);
    expect(isSessionFilterActive({ chipId: "all", query: "x" })).toBe(true);
    expect(isSessionFilterActive({ chipId: "active", query: "" })).toBe(true);
  });
});

describe("sessionFilterChipAccessibilityLabel (T362)", () => {
  it("names what the chip shows, not the bare word on it", () => {
    expect(sessionFilterChipAccessibilityLabel(SESSION_FILTER_CHIPS[0]!)).toBe("All sessions");
    expect(sessionFilterChipAccessibilityLabel(SESSION_FILTER_CHIPS[3]!)).toBe(
      "Needs you sessions",
    );
  });

  it("leaves selection to accessibilityState rather than saying it twice", () => {
    for (const chip of SESSION_FILTER_CHIPS) {
      expect(sessionFilterChipAccessibilityLabel(chip)).not.toMatch(/selected/i);
    }
  });
});
