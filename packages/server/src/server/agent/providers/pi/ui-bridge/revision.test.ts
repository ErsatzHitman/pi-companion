import { describe, expect, it } from "vitest";
import {
  PIUI_INITIAL_REVISION,
  PiUiRevisionTracker,
  decidePiUiDeltaRevision,
  decidePiUiFullStateRevision,
  nextPiUiRevision,
} from "./revision.js";

/**
 * One test per revision rule from plan.md §4.2:
 * discard <= current, apply current + 1, resync on a jump, accept a full state
 * at or above current.
 */
describe("Pi UI delta revision rules (plan.md §4.2)", () => {
  it("discards a delta below the current revision", () => {
    expect(decidePiUiDeltaRevision(7, 3)).toEqual({ action: "discard", reason: "stale" });
  });

  it("discards a delta at the current revision", () => {
    expect(decidePiUiDeltaRevision(7, 7)).toEqual({ action: "discard", reason: "stale" });
  });

  it("applies exactly current + 1", () => {
    expect(decidePiUiDeltaRevision(7, 8)).toEqual({
      action: "apply",
      reason: "next",
      revision: 8,
    });
  });

  it("requests a full state when a delta jumps ahead", () => {
    expect(decidePiUiDeltaRevision(7, 9)).toEqual({ action: "resync", reason: "gap" });
    expect(decidePiUiDeltaRevision(7, 1_000)).toEqual({ action: "resync", reason: "gap" });
  });

  it("requests a full state for an unusable revision", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "8", null, undefined]) {
      expect(decidePiUiDeltaRevision(7, bad)).toEqual({ action: "resync", reason: "invalid" });
    }
  });

  it("applies the first delta of a fresh agent", () => {
    expect(decidePiUiDeltaRevision(PIUI_INITIAL_REVISION, 1)).toEqual({
      action: "apply",
      reason: "next",
      revision: 1,
    });
    expect(decidePiUiDeltaRevision(PIUI_INITIAL_REVISION, 0)).toEqual({
      action: "discard",
      reason: "stale",
    });
  });
});

describe("Pi UI full-state revision rules (plan.md §4.2)", () => {
  it("accepts a full state at the current revision", () => {
    expect(decidePiUiFullStateRevision(4, 4)).toEqual({
      action: "apply",
      reason: "at-or-ahead",
      revision: 4,
    });
  });

  it("accepts a full state ahead of the current revision", () => {
    expect(decidePiUiFullStateRevision(4, 40)).toEqual({
      action: "apply",
      reason: "at-or-ahead",
      revision: 40,
    });
  });

  it("discards a full state below the current revision", () => {
    expect(decidePiUiFullStateRevision(4, 3)).toEqual({ action: "discard", reason: "stale" });
  });

  it("discards an unusable full-state revision", () => {
    expect(decidePiUiFullStateRevision(4, -2)).toEqual({ action: "discard", reason: "invalid" });
    expect(decidePiUiFullStateRevision(4, "4")).toEqual({ action: "discard", reason: "invalid" });
  });
});

describe("PiUiRevisionTracker", () => {
  it("starts at the initial revision and advances only on apply", () => {
    const tracker = new PiUiRevisionTracker();
    expect(tracker.current).toBe(PIUI_INITIAL_REVISION);

    expect(tracker.ingestDelta(1).action).toBe("apply");
    expect(tracker.current).toBe(1);

    expect(tracker.ingestDelta(1).action).toBe("discard");
    expect(tracker.current).toBe(1);

    expect(tracker.ingestDelta(5).action).toBe("resync");
    expect(tracker.current).toBe(1);
  });

  it("adopts an accepted full-state revision and ignores a stale one", () => {
    const tracker = new PiUiRevisionTracker(10);
    expect(tracker.ingestFullState(9).action).toBe("discard");
    expect(tracker.current).toBe(10);

    expect(tracker.ingestFullState(10).action).toBe("apply");
    expect(tracker.current).toBe(10);

    expect(tracker.ingestFullState(31).action).toBe("apply");
    expect(tracker.current).toBe(31);
    expect(tracker.ingestDelta(32).action).toBe("apply");
  });

  it("recovers after a gap by accepting the producer's full state", () => {
    const tracker = new PiUiRevisionTracker(2);
    expect(tracker.ingestDelta(6)).toEqual({ action: "resync", reason: "gap" });
    expect(tracker.ingestFullState(6).action).toBe("apply");
    expect(tracker.ingestDelta(7).action).toBe("apply");
  });

  it("resets to the initial revision on close/shutdown", () => {
    const tracker = new PiUiRevisionTracker(12);
    tracker.reset();
    expect(tracker.current).toBe(PIUI_INITIAL_REVISION);
    expect(tracker.ingestDelta(1).action).toBe("apply");
  });

  it("produces a stream that a consumer can always apply", () => {
    const producer = new PiUiRevisionTracker();
    const consumer = new PiUiRevisionTracker();
    for (let i = 0; i < 25; i++) {
      const revision = producer.bump();
      expect(nextPiUiRevision(revision - 1)).toBe(revision);
      expect(consumer.ingestDelta(revision).action).toBe("apply");
    }
    expect(consumer.current).toBe(producer.current);
  });
});
