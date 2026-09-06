/**
 * Proves T37B's third acceptance criterion, "Stale state is announced,
 * not colour-only": every stale case below produces a full sentence
 * (`.text`), never a bare label, and `describeTimelineStaleness`
 * returns `null` — nothing to announce — once `stale` is `false`.
 */
import { describe, expect, it } from "vitest";

import { describeSessionListStaleness, describeTimelineStaleness } from "./stale-announcement.js";

describe("describeTimelineStaleness", () => {
  it("returns null when not stale — nothing to announce", () => {
    expect(describeTimelineStaleness({ stale: false, gap: null })).toBeNull();
    // Even a leftover gap value is irrelevant once stale is false.
    expect(
      describeTimelineStaleness({
        stale: false,
        gap: { epoch: "epoch-1", fromSeq: 1, toSeq: 2 },
      }),
    ).toBeNull();
  });

  it("prioritizes the gap-backfill reason and text when a gap is open", () => {
    const result = describeTimelineStaleness({
      stale: true,
      gap: { epoch: "epoch-1", fromSeq: 11, toSeq: 19 },
      cachedAt: 1_000,
      now: 1_000,
    });
    expect(result).toEqual({
      reason: "gap-backfill",
      since: 1_000,
      text: "Catching up on missing messages before this view is up to date.",
    });
  });

  it("falls back to awaiting-catch-up with elapsed time when stale but no gap is known", () => {
    const result = describeTimelineStaleness({
      stale: true,
      gap: null,
      cachedAt: 0,
      now: 90_000, // 90s later
    });
    expect(result).toEqual({
      reason: "awaiting-catch-up",
      since: 0,
      text: "Showing messages cached 1 minute ago — confirming with the server.",
    });
  });

  it("falls back to a generic sentence when stale but cachedAt is unknown", () => {
    const result = describeTimelineStaleness({ stale: true, gap: null });
    expect(result).toEqual({
      reason: "awaiting-catch-up",
      since: null,
      text: "Showing cached messages — confirming with the server.",
    });
  });

  it.each([
    [0, "moments ago"],
    [59_000, "moments ago"],
    [60_000, "1 minute ago"],
    [125_000, "2 minutes ago"],
    [3_600_000, "1 hour ago"],
    [7_200_000, "2 hours ago"],
    [86_400_000, "1 day ago"],
    [172_800_000, "2 days ago"],
  ])("formats an elapsed delta of %dms as %s", (deltaMs, expectedPhrase) => {
    const result = describeTimelineStaleness({
      stale: true,
      gap: null,
      cachedAt: 0,
      now: deltaMs,
    });
    expect(result?.text).toContain(expectedPhrase);
  });

  it("defaults `now` to Date.now() when not supplied", () => {
    const realNow = Date.now();
    const result = describeTimelineStaleness({
      stale: true,
      gap: null,
      cachedAt: realNow - 60_000,
    });
    expect(result?.text).toContain("1 minute ago");
  });
});

describe("describeSessionListStaleness", () => {
  it("returns null when not stale", () => {
    expect(describeSessionListStaleness({ stale: false })).toBeNull();
  });

  it("names the session list specifically, with elapsed time, when stale with a known cachedAt", () => {
    const result = describeSessionListStaleness({ stale: true, cachedAt: 0, now: 60_000 });
    expect(result).toEqual({
      reason: "awaiting-catch-up",
      since: 0,
      text: "Showing your last known session list from 1 minute ago — confirming with the server.",
    });
  });

  it("falls back to a generic sentence when cachedAt is unknown", () => {
    const result = describeSessionListStaleness({ stale: true });
    expect(result).toEqual({
      reason: "awaiting-catch-up",
      since: null,
      text: "Showing your last known session list — confirming with the server.",
    });
  });
});
