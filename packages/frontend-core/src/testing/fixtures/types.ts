// Shared shape for this directory's recorded-session fixture chapters.
// Deliberately mirrors packages/protocol/src/fixtures/types.ts's
// FixtureFrame/*Fixture shape and timeline/fixtures/types.ts's
// TimelineFixtureScenario, so every fixture set in this repository reads the
// same way.

export type FixtureFrameDirection = "client_to_daemon" | "daemon_to_client";

export interface FixtureFrame {
  id: string;
  direction: FixtureFrameDirection;
  wireType: string;
  note?: string;
  /** The literal wire payload: either a bare `WSInboundMessage`/`WSOutboundMessage`
   * hello envelope, or `{ type: "session", message: <SessionOutboundMessage> }`. */
  message: unknown;
}

/** One named, ordered step of a recorded session (plan.md §13 Phase 2 exit). */
export interface RecordedSessionChapter {
  chapter: string;
  description: string;
  planRef: string;
  frames: FixtureFrame[];
}
