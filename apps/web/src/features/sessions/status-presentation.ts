import type { StatusTone } from "../../ui/primitives/index.js";
import type { SessionStatus, SessionSummary } from "./types.js";

const STATUS_LABEL: Record<SessionStatus, string> = {
  initializing: "Initializing",
  idle: "Idle",
  running: "Running",
  error: "Error",
  closed: "Closed",
};

const STATUS_TONE: Record<SessionStatus, StatusTone> = {
  initializing: "info",
  idle: "neutral",
  // A running session is the design reference's `.pill-run`
  // (`background: var(--accent-tint); color: var(--accent-ink);`), which is
  // this app's `"info"` tone (`packages/design-tokens/src/tokens.ts`'s
  // `status.info` is built from the same `accent`/`accent-tint` pair).
  // `"success"` (`status.success`, `green`/`green-tint`) is the reference's
  // `.pill-ok` — a settled/finished state, not an in-flight turn — so it
  // was the wrong tone for a session actively running.
  running: "info",
  error: "danger",
  closed: "neutral",
};

export interface SessionStatusPresentation {
  tone: StatusTone;
  text: string;
}

/**
 * Maps a session's raw `status` (plus `requiresAttention`) to the
 * `StatusIndicator` tone/text pair (plan.md §10.5 "non-colour status
 * signalling" — `tone` drives colour, `text` is always visible).
 */
export function statusPresentation(session: SessionSummary): SessionStatusPresentation {
  if (session.requiresAttention) {
    return { tone: "warning", text: `${STATUS_LABEL[session.status]} · needs attention` };
  }
  return { tone: STATUS_TONE[session.status], text: STATUS_LABEL[session.status] };
}
