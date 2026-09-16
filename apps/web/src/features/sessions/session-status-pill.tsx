import { StatusPill } from "../../ui/primitives/index.js";
import { statusPresentation } from "./status-presentation.js";
import type { SessionSummary } from "./types.js";

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
 * A thin wrapper (ATOMS-1) over the shared `ui/primitives/StatusPill`:
 * this file now owns only the session-specific presentation logic
 * (`statusPresentation`), and the pill's own visual treatment — 22px
 * height, 6px dot, tone tints — lives once in `primitives.css`'s
 * `.pc-status-pill` block, not duplicated here.
 *
 * Uses the same `statusPresentation` mapping `StatusIndicator` uses —
 * this is a second, more compact rendering of that one mapping, not a
 * second mapping.
 */
export function SessionStatusPill({ session, testId }: SessionStatusPillProps) {
  if (!session) return null;
  const { tone, text } = statusPresentation(session);
  return <StatusPill label={text} tone={tone} testId={testId} />;
}
