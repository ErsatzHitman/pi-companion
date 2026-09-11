import { statusPresentation } from "./status-presentation.js";
import type { SessionSummary } from "./types.js";

import "./session-status.css";

export interface SessionStatusPillProps {
  /**
   * The session whose status this pill reports. `null` renders nothing:
   * a pill with no real status behind it would be an invented one.
   */
  session: SessionSummary | null;
  testId?: string;
}

/**
 * The "dot + word" status pill (plan.md §10.5: shape and text, never
 * colour alone). Shared by the per-session head (`SessionResumeView`)
 * and the live rail's own head (`root-route.tsx`'s extension rail), so
 * the two surfaces can never disagree about how a session's state reads.
 *
 * Uses the same `statusPresentation` mapping `StatusIndicator` uses —
 * this is a second, more compact rendering of that one mapping, not a
 * second mapping.
 */
export function SessionStatusPill({ session, testId }: SessionStatusPillProps) {
  if (!session) return null;
  const { tone, text } = statusPresentation(session);
  return (
    <span className={`pc-session-pill pc-session-pill--${tone}`} role="status" data-testid={testId}>
      <span className="pc-session-pill__dot" aria-hidden="true" />
      <span className="pc-session-pill__label">{text}</span>
    </span>
  );
}
