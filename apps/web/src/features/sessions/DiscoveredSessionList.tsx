import { ErrorState, LoadingState, Section } from "../../ui/primitives/index.js";
import { DiscoveredSessionRow } from "./DiscoveredSessionRow.js";
import type { DiscoveredSessionsController } from "./use-discovered-sessions.js";

import "./discovered-session-list.css";

export interface DiscoveredSessionListProps {
  controller: DiscoveredSessionsController;
}

/**
 * The "discovered sessions" list (T27B5, plan.md §8.3 left rail):
 * Pi sessions found on this host's disk — including ones started from
 * a bare terminal, outside the daemon — that have no matching agent
 * record yet. Rendered as its own `Section`, entirely separate from
 * `SessionList`'s already-imported sessions (this task's "discovered
 * sessions are listed distinctly from imported ones" acceptance
 * criterion), and collapses to nothing once there is nothing to show
 * (plan.md §8.3: "Empty extension state may collapse").
 */
export function DiscoveredSessionList({ controller }: DiscoveredSessionListProps) {
  if (controller.phase === "loading" && controller.sessions.length === 0) {
    return (
      <LoadingState
        title="Looking for Pi sessions"
        description="Scanning this host for Pi sessions that haven't been imported yet."
        testId="discovered-session-list-loading"
      />
    );
  }

  if (controller.phase === "error" && controller.sessions.length === 0) {
    return (
      <ErrorState
        title="Couldn't find Pi sessions"
        description={controller.errorMessage ?? "The daemon returned an unknown error."}
        testId="discovered-session-list-error"
      />
    );
  }

  if (controller.sessions.length === 0) {
    return null;
  }

  return (
    <Section
      title="Discovered sessions"
      className="pc-discovered-session-list"
      data-testid="discovered-session-list"
    >
      <ul className="pc-discovered-session-rows">
        {controller.sessions.map((session) => (
          <DiscoveredSessionRow
            key={session.providerHandleId}
            session={session}
            importing={session.providerHandleId === controller.importingHandleId}
            onImport={controller.importDiscovered}
          />
        ))}
      </ul>
    </Section>
  );
}
