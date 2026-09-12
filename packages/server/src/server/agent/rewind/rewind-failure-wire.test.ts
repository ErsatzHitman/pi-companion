import { describe, expect, test } from "vitest";
import {
  REWIND_CONFLICT_ERROR_MARKER,
  REWIND_UNSUPPORTED_ERROR_MARKER,
} from "@picompanion/protocol/rewind-errors";
import { CheckpointConflictError } from "../checkpoints/index.js";
import { RewindCapabilityError } from "./rewind.js";
import { formatRewindFailureForWire } from "./rewind-failure-wire.js";

describe("formatRewindFailureForWire", () => {
  test("marks a checkpoint conflict and preserves its human sentence", () => {
    const marked = formatRewindFailureForWire(new CheckpointConflictError());

    expect(marked.startsWith(REWIND_CONFLICT_ERROR_MARKER)).toBe(true);
    expect(marked.slice(REWIND_CONFLICT_ERROR_MARKER.length)).toBe(
      new CheckpointConflictError().message,
    );
  });

  test("marks an unsupported rewind mode", () => {
    const marked = formatRewindFailureForWire(new RewindCapabilityError("files"));

    expect(marked.startsWith(REWIND_UNSUPPORTED_ERROR_MARKER)).toBe(true);
    expect(marked.slice(REWIND_UNSUPPORTED_ERROR_MARKER.length)).toBe(
      "Provider does not support rewinding files",
    );
  });

  test("leaves an unclassified failure unmarked", () => {
    expect(formatRewindFailureForWire(new Error("boom"))).toBe("boom");
  });

  test("falls back for a non-Error throw", () => {
    expect(formatRewindFailureForWire("boom")).toBe("Failed to rewind agent");
  });
});
