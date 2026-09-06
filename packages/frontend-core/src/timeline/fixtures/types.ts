// Shared shape for this directory's timeline reducer fixtures. Deliberately
// mirrors packages/protocol/src/fixtures/types.ts's FixtureFrame/*Fixture
// shape so both fixture sets read the same way.

export type FixtureFrameDirection = "client_to_daemon" | "daemon_to_client";

export interface FixtureFrame {
  id: string;
  direction: FixtureFrameDirection;
  wireType: string;
  note?: string;
  /** The literal WebSocket JSON envelope: `{ type: "session", message: <SessionOutboundMessage> }`. */
  message: unknown;
}

export interface TimelineFixtureScenario {
  scenario: string;
  description: string;
  planRef: string;
  frames: FixtureFrame[];
}
