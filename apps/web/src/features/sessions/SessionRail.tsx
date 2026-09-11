/**
 * Live left session rail (plan.md §8.3; the shell's `sessionRail` slot).
 *
 * Composes already-built, already-tested pieces — `groupSessions`,
 * `statusPresentation`, and the `ui/primitives` placeholders — into the
 * design reference's rail: a `Workspace` eyebrow + `New session` head, a
 * search field that filters the rows client-side, the grouped list, and
 * a connection foot. It owns no daemon access of its own; the caller
 * (`root-route.tsx`) supplies the list state, the connection snapshot,
 * and the navigation callbacks, matching the "pure assembly" split that
 * file's module doc already documents.
 *
 * Honest wiring, stated rather than implied:
 *
 * - `New session` navigates to the host's sessions route, because that is
 *   where the real create-session dialog (`SessionsScreen`'s
 *   `CreateSessionDialog`) lives and this rail has no controller for it.
 *   It is not a second dialog implementation.
 * - The search field filters the rail's own session rows (title and
 *   `cwd` substring) and never leaves the selected session's row hidden
 *   silently: the selected row is always kept visible, and when the
 *   filter would have excluded it (or matched nothing at all) a stated
 *   `role="status"` note says so.
 * - The foot shows a real connection state derived from
 *   `HostControllerConnectionInfo` (`status`/`kind`). It renders no
 *   version chip: this app has no build constant exposing its package
 *   version, and the one fixed version constant that does exist
 *   (`DAEMON_APP_VERSION`) is a protocol-compatibility declaration, not
 *   this app's version — so, per the task's rule, the chip is omitted
 *   rather than filled with something that would mean something else.
 */
import { useEffect, useRef, useState } from "react";

import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
} from "../../ui/primitives/index.js";
import { groupSessions } from "./group-sessions.js";
import { sessionGlyph, sessionMetaParts } from "./session-meta.js";
import { statusPresentation } from "./status-presentation.js";
import type { SessionListState, SessionSummary } from "./types.js";

import "./session-rail.css";

/** The connection facts the rail's foot reports, taken verbatim from `HostControllerConnectionInfo`. */
export interface SessionRailConnection {
  status: string;
  kind: "direct" | "relay" | null;
}

export interface SessionRailProps {
  /** The session-list core state (plan.md §8.3 left session rail). */
  state: SessionListState;
  /** The currently open session, so its row stays marked and visible. */
  selectedSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  /**
   * Navigates to the route that owns the real create-session dialog.
   * Omitted renders no `New session` affordance at all rather than a
   * button that cannot do anything.
   */
  onNewSession?: () => void;
  connection: SessionRailConnection;
  /** Injected "now" so row-age rendering is deterministic in tests. */
  now?: number;
}

function sessionMatchesQuery(session: SessionSummary, query: string): boolean {
  const title = session.title ?? "Untitled session";
  return title.toLowerCase().includes(query) || session.cwd.toLowerCase().includes(query);
}

function SessionRailFoot({ connection }: { connection: SessionRailConnection }) {
  const connected = connection.status === "connected";
  const statusWord = connected ? "connected" : connection.status;
  // "relay off" means the open connection is a direct one; a relay
  // connection says so, and with no connection open there is no relay
  // fact to state at all.
  const relayWord =
    connected && connection.kind ? (connection.kind === "relay" ? "relay on" : "relay off") : null;

  return (
    <div className="pc-session-rail__foot" data-testid="shell-session-rail-foot">
      <span className="pc-session-rail__connection" data-state={connection.status}>
        <span className="pc-session-rail__connection-dot" aria-hidden="true" />
        {statusWord}
        {relayWord ? <> · {relayWord}</> : null}
      </span>
    </div>
  );
}

export function SessionRail({
  state,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  connection,
  now,
}: SessionRailProps) {
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // ⌘K / Ctrl+K focuses the rail search from anywhere in the app, the
  // same shortcut the reference documents on its own field.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const sessions = state.kind === "ready" ? state.sessions : [];
  const trimmedQuery = query.trim().toLowerCase();
  const matching = trimmedQuery
    ? sessions.filter((session) => sessionMatchesQuery(session, trimmedQuery))
    : sessions;
  const selected = selectedSessionId
    ? (sessions.find((session) => session.id === selectedSessionId) ?? null)
    : null;
  const selectedExcluded = Boolean(trimmedQuery && selected && !matching.includes(selected));
  // The selected row always stays visible; the note below states that
  // rather than letting the filter hide it silently.
  const visibleSessions = selectedExcluded && selected ? [...matching, selected] : matching;
  const groups = groupSessions(visibleSessions);
  const resolvedNow = now ?? Date.now();

  return (
    <div className="pc-session-rail">
      <div className="pc-session-rail__head">
        <span className="pc-session-rail__eyebrow">Workspace</span>
        {onNewSession ? (
          <button
            type="button"
            className="pc-session-rail__new"
            onClick={onNewSession}
            data-testid="shell-session-rail-new-session"
          >
            New session
          </button>
        ) : null}
      </div>

      <div className="pc-session-rail__search">
        <label className="pc-session-rail__search-field">
          <span className="pc-visually-hidden">Search sessions</span>
          <input
            ref={searchInputRef}
            type="search"
            className="pc-session-rail__search-input"
            placeholder="Search sessions and files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            data-testid="shell-session-rail-search"
          />
          <kbd className="pc-session-rail__search-kbd" aria-hidden="true">
            ⌘K
          </kbd>
        </label>
      </div>

      <div className="pc-session-rail__scroll">
        {state.kind === "loading" ? (
          <LoadingState
            title="Loading sessions"
            description="Fetching sessions from this host."
            testId="shell-session-rail-loading"
          />
        ) : null}

        {state.kind === "error" ? (
          <ErrorState
            title="Couldn't load sessions"
            description={state.message}
            testId="shell-session-rail-error"
          />
        ) : null}

        {state.kind === "ready" && sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description="Create a session on this host to see it here."
            testId="shell-session-rail-empty"
          />
        ) : null}

        {state.kind === "ready" && sessions.length > 0 ? (
          <Section title="Sessions" id="shell-session-rail">
            {state.stale ? (
              <Banner
                tone="warning"
                message="Reconnecting — this list may be out of date."
                testId="shell-session-rail-stale-banner"
              />
            ) : null}
            {selectedExcluded && selected ? (
              <p
                className="pc-session-rail__filter-note"
                role="status"
                data-testid="shell-session-rail-filter-note"
              >
                The open session is shown even though it doesn&apos;t match &ldquo;
                {query.trim()}&rdquo;.
              </p>
            ) : null}
            {visibleSessions.length === 0 ? (
              <EmptyState
                title="No matching sessions"
                description={`No session title or path contains “${query.trim()}”.`}
                testId="shell-session-rail-filter-empty"
              />
            ) : null}
            {groups.map((group) => (
              <Section key={group.kind} title={group.label}>
                <ul
                  className="pc-session-rail__rows"
                  data-testid={`shell-session-rail-group-${group.kind}`}
                >
                  {group.sessions.map((session) => {
                    const glyph = sessionGlyph(session);
                    const { text } = statusPresentation(session);
                    const selectedRow = session.id === selectedSessionId;
                    const title = session.title ?? "Untitled session";
                    const meta = sessionMetaParts(session, resolvedNow);
                    return (
                      <li key={session.id} className="pc-session-rail__row-item">
                        <button
                          type="button"
                          className="pc-session-rail__row"
                          data-selected={selectedRow}
                          aria-current={selectedRow ? "true" : undefined}
                          data-testid={`shell-session-rail-row-${session.id}`}
                          onClick={() => onSelectSession?.(session.id)}
                        >
                          <span
                            className={`pc-session-rail__glyph pc-session-rail__glyph--${glyph.tone}`}
                            aria-hidden="true"
                          >
                            {glyph.glyph}
                          </span>
                          <span className="pc-session-rail__row-text">
                            <span className="pc-visually-hidden">{text}. </span>
                            <span className="pc-session-rail__title">{title}</span>
                            {meta.length > 0 ? (
                              <span className="pc-session-rail__meta">{meta.join(" · ")}</span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            ))}
          </Section>
        ) : null}
      </div>

      <SessionRailFoot connection={connection} />
    </div>
  );
}
