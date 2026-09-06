import { describe, expect, it } from "vitest";
import {
  PIUI_INITIAL_REVISION,
  PiUiRevisionTracker,
  decidePiUiDeltaRevision,
  decidePiUiFullStateRevision,
  isPiUiRevision,
} from "./revision.js";

/**
 * Client-side revision rules (plan.md §4.2, "Bridge state correctness";
 * T21B acceptance criterion "Stale and jumped revisions handled per plan
 * §4.2"). These mirror `packages/server/.../pi/ui-bridge/revision.test.ts`
 * one-for-one so the daemon producer and this client consumer are provably
 * exercised against the exact same rule statements.
 */

describe("isPiUiRevision", () => {
  it("accepts non-negative safe integers", () => {
    expect(isPiUiRevision(0)).toBe(true);
    expect(isPiUiRevision(1)).toBe(true);
    expect(isPiUiRevision(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isPiUiRevision(-1)).toBe(false);
    expect(isPiUiRevision(1.5)).toBe(false);
    expect(isPiUiRevision(Number.NaN)).toBe(false);
    expect(isPiUiRevision("1")).toBe(false);
    expect(isPiUiRevision(null)).toBe(false);
    expect(isPiUiRevision(undefined)).toBe(false);
  });
});

describe("decidePiUiDeltaRevision", () => {
  it("discards a delta at or below the current revision (stale)", () => {
    expect(decidePiUiDeltaRevision(5, 5)).toEqual({ action: "discard", reason: "stale" });
    expect(decidePiUiDeltaRevision(5, 3)).toEqual({ action: "discard", reason: "stale" });
    expect(decidePiUiDeltaRevision(0, 0)).toEqual({ action: "discard", reason: "stale" });
  });

  it("applies only current + 1", () => {
    expect(decidePiUiDeltaRevision(5, 6)).toEqual({ action: "apply", reason: "next", revision: 6 });
    expect(decidePiUiDeltaRevision(0, 1)).toEqual({ action: "apply", reason: "next", revision: 1 });
  });

  it("requests a resync when a delta jumps ahead (gap)", () => {
    expect(decidePiUiDeltaRevision(5, 8)).toEqual({ action: "resync", reason: "gap" });
    expect(decidePiUiDeltaRevision(0, 2)).toEqual({ action: "resync", reason: "gap" });
  });

  it("requests a resync for an unusable revision", () => {
    expect(decidePiUiDeltaRevision(5, -1)).toEqual({ action: "resync", reason: "invalid" });
    expect(decidePiUiDeltaRevision(5, "6")).toEqual({ action: "resync", reason: "invalid" });
    expect(decidePiUiDeltaRevision(5, undefined)).toEqual({ action: "resync", reason: "invalid" });
  });
});

describe("decidePiUiFullStateRevision", () => {
  it("accepts a full state at or ahead of current and adopts its revision", () => {
    expect(decidePiUiFullStateRevision(5, 5)).toEqual({
      action: "apply",
      reason: "at-or-ahead",
      revision: 5,
    });
    expect(decidePiUiFullStateRevision(5, 9)).toEqual({
      action: "apply",
      reason: "at-or-ahead",
      revision: 9,
    });
    expect(decidePiUiFullStateRevision(0, 0)).toEqual({
      action: "apply",
      reason: "at-or-ahead",
      revision: 0,
    });
  });

  it("discards a stale full state (never rolls state backwards)", () => {
    expect(decidePiUiFullStateRevision(5, 4)).toEqual({ action: "discard", reason: "stale" });
  });

  it("discards an unusable full-state revision", () => {
    expect(decidePiUiFullStateRevision(5, Number.NaN)).toEqual({
      action: "discard",
      reason: "invalid",
    });
    expect(decidePiUiFullStateRevision(5, null)).toEqual({ action: "discard", reason: "invalid" });
  });
});

describe("PiUiRevisionTracker", () => {
  it("starts at the initial revision", () => {
    const tracker = new PiUiRevisionTracker();
    expect(tracker.current).toBe(PIUI_INITIAL_REVISION);
  });

  it("advances only on an applied delta", () => {
    const tracker = new PiUiRevisionTracker();
    expect(tracker.ingestDelta(1)).toEqual({ action: "apply", reason: "next", revision: 1 });
    expect(tracker.current).toBe(1);

    // Stale: replays the same revision without advancing.
    expect(tracker.ingestDelta(1)).toEqual({ action: "discard", reason: "stale" });
    expect(tracker.current).toBe(1);

    // Gap: does not advance, caller must resync.
    expect(tracker.ingestDelta(4)).toEqual({ action: "resync", reason: "gap" });
    expect(tracker.current).toBe(1);

    expect(tracker.ingestDelta(2)).toEqual({ action: "apply", reason: "next", revision: 2 });
    expect(tracker.current).toBe(2);
  });

  it("adopts a full state's revision directly, even far ahead", () => {
    const tracker = new PiUiRevisionTracker();
    tracker.ingestDelta(1);
    expect(tracker.ingestFullState(9)).toEqual({
      action: "apply",
      reason: "at-or-ahead",
      revision: 9,
    });
    expect(tracker.current).toBe(9);
  });

  it("ignores a stale full state", () => {
    const tracker = new PiUiRevisionTracker(9);
    expect(tracker.ingestFullState(3)).toEqual({ action: "discard", reason: "stale" });
    expect(tracker.current).toBe(9);
  });

  it("resets back to the initial revision", () => {
    const tracker = new PiUiRevisionTracker(9);
    tracker.reset();
    expect(tracker.current).toBe(PIUI_INITIAL_REVISION);
  });

  it("resets to an explicit revision (e.g. a known durable snapshot revision)", () => {
    const tracker = new PiUiRevisionTracker(9);
    tracker.reset(4);
    expect(tracker.current).toBe(4);
  });
});
