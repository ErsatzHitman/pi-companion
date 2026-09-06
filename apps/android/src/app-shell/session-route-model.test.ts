import { describe, expect, it } from "vitest";

import { deriveTranscriptStatus } from "../features/transcript/status-model.js";
import { deriveSessionRouteStatus } from "./session-route-model.js";

const PHASES = ["idle", "connecting", "connected", "disconnected", "disposed"] as const;

describe("deriveSessionRouteStatus", () => {
  for (const phase of PHASES) {
    it(`agrees with deriveTranscriptStatus for "${phase}"`, () => {
      expect(deriveSessionRouteStatus(phase)).toBe(deriveTranscriptStatus({ connection: phase }));
    });
  }

  it('maps idle and connecting to "connecting"', () => {
    expect(deriveSessionRouteStatus("idle")).toBe("connecting");
    expect(deriveSessionRouteStatus("connecting")).toBe("connecting");
  });

  it('maps connected to "connected"', () => {
    expect(deriveSessionRouteStatus("connected")).toBe("connected");
  });

  it('maps disconnected and disposed to "disconnected"', () => {
    expect(deriveSessionRouteStatus("disconnected")).toBe("disconnected");
    expect(deriveSessionRouteStatus("disposed")).toBe("disconnected");
  });
});
