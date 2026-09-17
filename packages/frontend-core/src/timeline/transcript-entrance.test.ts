/**
 * Tests for `./transcript-entrance.ts` (W12-ENTRANCE).
 *
 * Fixtures are plain values — no `apps/*` import, no timeline reducer —
 * because this module's contract is purely about row counts and indices,
 * never about what a row actually contains.
 */
import { describe, expect, it } from "vitest";

import {
  advanceTranscriptEntranceWatermark,
  INITIAL_TRANSCRIPT_ENTRANCE_WATERMARK,
  TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS,
  TRANSCRIPT_ENTRANCE_STAGGER_MS,
  transcriptEntranceDelayMs,
  type TranscriptEntranceWatermark,
} from "./transcript-entrance.js";

describe("advanceTranscriptEntranceWatermark", () => {
  it("treats the first batch from the initial state as entering from row 0", () => {
    const next = advanceTranscriptEntranceWatermark(INITIAL_TRANSCRIPT_ENTRANCE_WATERMARK, 5);
    expect(next.enteringFromRow).toBe(0);
    expect(next.settledRowCount).toBe(5);
  });

  it("opens a new batch, whose enteringFromRow is the PREVIOUS settled count, when the row count changes", () => {
    const first = advanceTranscriptEntranceWatermark(INITIAL_TRANSCRIPT_ENTRANCE_WATERMARK, 5);
    const second = advanceTranscriptEntranceWatermark(first, 8);
    expect(second.enteringFromRow).toBe(5);
    expect(second.settledRowCount).toBe(8);
  });

  it("leaves the state completely untouched when the row count has not changed", () => {
    const first = advanceTranscriptEntranceWatermark(INITIAL_TRANSCRIPT_ENTRANCE_WATERMARK, 5);
    const again = advanceTranscriptEntranceWatermark(first, 5);
    expect(again).toBe(first);
    expect(again.enteringFromRow).toBe(first.enteringFromRow);
    expect(again.settledRowCount).toBe(first.settledRowCount);
  });

  it("is idempotent: applying the advance twice for the same new count yields the same result both times", () => {
    const base = advanceTranscriptEntranceWatermark(INITIAL_TRANSCRIPT_ENTRANCE_WATERMARK, 5);
    const firstApplication = advanceTranscriptEntranceWatermark(base, 9);
    const secondApplication = advanceTranscriptEntranceWatermark(firstApplication, 9);
    expect(secondApplication).toEqual(firstApplication);
    expect(secondApplication.enteringFromRow).toBe(firstApplication.enteringFromRow);
  });
});

describe("transcriptEntranceDelayMs", () => {
  it("answers null, not a zero delay, for a row below the watermark", () => {
    expect(transcriptEntranceDelayMs(2, 5)).toBeNull();
  });

  it("gives the first, second, and third entering rows 0ms, 120ms, and 240ms", () => {
    const enteringFromRow = 10;
    expect(transcriptEntranceDelayMs(10, enteringFromRow)).toBe(0);
    expect(transcriptEntranceDelayMs(11, enteringFromRow)).toBe(TRANSCRIPT_ENTRANCE_STAGGER_MS);
    expect(transcriptEntranceDelayMs(12, enteringFromRow)).toBe(2 * TRANSCRIPT_ENTRANCE_STAGGER_MS);
  });

  it("caps the delay at the seventh entering row and every one after it", () => {
    const enteringFromRow = 0;
    // The seventh entering row is index 6 (0-based): 6 * 120 = 720, the cap.
    expect(transcriptEntranceDelayMs(6, enteringFromRow)).toBe(TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS);
    expect(transcriptEntranceDelayMs(7, enteringFromRow)).toBe(TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS);
    expect(transcriptEntranceDelayMs(50, enteringFromRow)).toBe(TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS);
  });

  it("BATCH-RELATIVE PIN: one new row arriving after 50 already-settled rows gets 0ms, never the 720ms cap", () => {
    // This is the exact shipped defect web's own implementation found and
    // fixed: keying the stagger to a row's ABSOLUTE transcript index would
    // give a late-arriving single turn a flat cap delay instead of an
    // immediate entrance. `enteringFromRow` here is 50 (the previous
    // settled count) and the new row's absolute index is also 50 — its
    // position WITHIN the batch is 0, not 50.
    const settledBeforeThisBatch = 50;
    const watermark: TranscriptEntranceWatermark = advanceTranscriptEntranceWatermark(
      { enteringFromRow: 0, settledRowCount: settledBeforeThisBatch },
      settledBeforeThisBatch + 1,
    );
    const newRowAbsoluteIndex = settledBeforeThisBatch;
    expect(transcriptEntranceDelayMs(newRowAbsoluteIndex, watermark.enteringFromRow)).toBe(0);
  });
});
