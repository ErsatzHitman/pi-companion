// Shared shape for the recorded daemon WebSocket / Pi UI Bridge fixtures in this
// directory. See README.md for scope and plan.md §14.2 for the source requirement.

/** Which side of the daemon WebSocket connection sent a frame. */
export type FixtureFrameDirection = "client_to_daemon" | "daemon_to_client";

/** One recorded WebSocket frame in a fixture sequence. */
export interface FixtureFrame {
  /** Stable id for referencing this frame from tests or docs. */
  id: string;
  direction: FixtureFrameDirection;
  /** Human-readable wire type, e.g. "session(create_agent_request)". Not validated. */
  wireType: string;
  /** Optional free-text context for readers. */
  note?: string;
  /** The literal WebSocket JSON payload, matching WSInboundMessage or WSOutboundMessage. */
  message: unknown;
}

/** A recorded daemon-side WebSocket scenario from plan.md §14.2. */
export interface DaemonWsFixture {
  scenario: string;
  description: string;
  planRef: string;
  frames: FixtureFrame[];
}

/** A recorded fixture for one Pi UI Bridge kind (plan.md §11.3). */
export interface PiUiBridgeFixture {
  kind: string;
  description: string;
  planRef: string;
  frames: FixtureFrame[];
}
