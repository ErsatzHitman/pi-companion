/**
 * Pure session-row/head metadata formatting (plan.md §8.3's session rail
 * and the per-session head). Every function here is clock-injectable and
 * free of React/DOM, so the row's `age · tokens · model` line and the
 * head's status glyph/pill are unit-testable without rendering or fake
 * timers.
 *
 * Every value comes from the real `SessionSummary` fields
 * `daemon-sessions-client.ts`'s `toSessionSummary` maps off a daemon
 * `AgentSnapshotPayload`; a part with no real value is OMITTED by the
 * caller (`SessionRail`/`SessionResumeView`) rather than filled with a
 * placeholder. Nothing here invents a session fact.
 */
import type { SessionStatus, SessionSummary } from "./types.js";

/** The four status glyphs the rail's glyph column can show. */
export type SessionGlyph = "○" | "◐" | "✓" | "◆";

/**
 * The glyph's colour role. `wait`/`now`/`done`/`hold` mirror the design
 * reference's `.gl-wait`/`.gl-now`/`.gl-done`/`.gl-hold`; `err` is this
 * feature's own addition for a session whose daemon status is `error`,
 * so a failure is not painted the same orange as "needs attention".
 */
export type SessionGlyphTone = "wait" | "now" | "done" | "hold" | "err";

export interface SessionGlyphPresentation {
  glyph: SessionGlyph;
  tone: SessionGlyphTone;
}

const GLYPH_BY_STATUS: Record<SessionStatus, SessionGlyph> = {
  // `idle` is the reference's `.gl-wait` ○ ("nothing in flight").
  idle: "○",
  // `initializing` is a turn-shaped state that has not started running
  // yet, so it shares the running ◐ rather than claiming idle.
  initializing: "◐",
  running: "◐",
  // `closed` is the reference's "finished" ✓.
  closed: "✓",
  error: "◆",
};

const TONE_BY_STATUS: Record<SessionStatus, SessionGlyphTone> = {
  idle: "wait",
  initializing: "now",
  running: "now",
  closed: "done",
  error: "err",
};

/**
 * Maps a session's raw status (plus `requiresAttention`) to the glyph
 * column's shape and colour role. The glyph is never the only status
 * signal: callers pair it with a visually hidden status word (see
 * `SessionRail`'s row), so the row keeps plan.md §10.5's "never colour
 * alone" guarantee.
 */
export function sessionGlyph(session: SessionSummary): SessionGlyphPresentation {
  if (session.status !== "error" && session.requiresAttention) {
    // Waiting on the user is the reference's `.gl-hold` ◆, and outranks
    // the underlying status for the glyph slot.
    return { glyph: "◆", tone: "hold" };
  }
  return { glyph: GLYPH_BY_STATUS[session.status], tone: TONE_BY_STATUS[session.status] };
}

/**
 * `"now"` / `"5m"` / `"3h"` / `"2d"` for a session's `updatedAt`. `now`
 * is a parameter (not `Date.now()` inside) so a test pins the exact
 * output; `null` means the timestamp is not parseable, and the caller
 * omits the age part rather than printing `NaN`.
 */
export function formatSessionAge(updatedAt: string, now: number): string | null {
  const then = Date.parse(updatedAt);
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** `131.6k` / `1.2M`, matching the design reference's own `fmtTok`. */
export function formatSessionTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

/**
 * The rail row's meta line, as an array of real parts joined by ` · ` by
 * the caller. A session with no usage report and no model yields
 * `["now"]`, never a fabricated token count or model name.
 */
export function sessionMetaParts(session: SessionSummary, now: number): string[] {
  const parts: string[] = [];
  const age = formatSessionAge(session.updatedAt, now);
  if (age) parts.push(age);
  const used = session.lastUsage?.contextWindowUsedTokens;
  if (typeof used === "number" && Number.isFinite(used)) {
    parts.push(formatSessionTokens(used));
  }
  if (session.model) parts.push(session.model);
  return parts;
}

/**
 * The current mode's display label, resolved through the daemon's own
 * `availableModes` labels where possible. Returns `null` when the
 * provider has no current mode at all; an id the snapshot does not
 * describe is still shown verbatim (it is a real daemon value) rather
 * than dropped.
 */
export function sessionModeLabel(session: SessionSummary): string | null {
  const id = session.currentModeId;
  if (!id) return null;
  return session.availableModes?.find((mode) => mode.id === id)?.label ?? id;
}

/**
 * The head's model-and-effort chip label (`opus-5 · xhigh` in the design
 * reference), built only from parts the session actually carries.
 * `null` when neither is available.
 */
export function sessionModelChipLabel(session: SessionSummary): string | null {
  const parts: string[] = [];
  if (session.model) parts.push(session.model);
  if (session.thinkingOptionId) parts.push(session.thinkingOptionId);
  return parts.length > 0 ? parts.join(" · ") : null;
}
