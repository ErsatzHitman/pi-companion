import type { ReactNode } from "react";
import { Link, useMatches } from "@tanstack/react-router";

import { ConnectionStatus } from "../features/connection/connection-status.js";
import { EmptyState } from "./primitives/index.js";
import "./shell.css";

/**
 * Named slots for the plan.md §8.3 three-region wide layout. Feature
 * tasks (T27B* for `sessionRail`, T28A* / T28B* for the centre transcript
 * and composer via `children`, T29R* / T29C2 for `extensionRail`) mount
 * into these without ever editing this file — this task (T27S1) owns
 * `shell.tsx`/`shell.css` alone so no wave collides on it.
 */
export interface ShellProps {
  /**
   * Left session rail (plan §8.3): sessions, host state, search, and
   * session creation. Renders a neutral empty state until a feature
   * mounts real content.
   */
  sessionRail?: ReactNode;
  /**
   * Right live Pi extension rail (plan §8.3, §11.5): fleet, workflow,
   * loop, and goal state stay visible here for the life of the session,
   * never demoted to a collapsed status chip while content exists
   * (§8.3, "A running subagent fleet ... remains visible in the right
   * rail. It does not disappear into a collapsed status chip.").
   */
  extensionRail?: ReactNode;
  /** Centre transcript-and-composer column. */
  children: ReactNode;
}

/**
 * T54A2 — the level-one heading for each route (plan.md §10.5).
 *
 * axe's `page-has-heading-one` failed in the first real-browser run: no
 * route rendered an `<h1>` at all. `Shell` is `rootRoute`'s own component
 * and wraps every route's `<Outlet />`, so putting the single `<h1>` here
 * gives every route exactly one, and gives the `<h2>`s that `Section`,
 * `Dialog` and `Sheet` already render something to descend from instead of
 * starting the document at level two.
 *
 * Keyed by route id (the path pattern — see `routes/route-tree.ts`). The
 * names are deliberately distinct from the `Section`/`RoutePlaceholder`
 * headings inside each screen ("Host", "Settings", ...), so that a
 * by-name heading query resolves to one element rather than two.
 *
 * Exported (T138) so `shell.test.tsx` can assert this map's coverage
 * against the REAL `routes/route-tree.ts` instead of a hand-typed copy of
 * the route list — see that file's "ROUTE_HEADINGS coverage" tests.
 */
export const ROUTE_HEADINGS: Record<string, string> = {
  "/connect": "Connect to a host",
  "/h/$serverId": "Host overview",
  "/h/$serverId/sessions": "Session list",
  "/h/$serverId/session/$agentId": "Session transcript",
  "/h/$serverId/session/$agentId/files/$": "Session files",
  "/h/$serverId/session/$agentId/terminal/$terminalId": "Session terminal",
  "/h/$serverId/settings": "Host settings",
  "/h/$serverId/diagnostics": "Diagnostics",
};

/**
 * The deepest matched route names the view. Falls back to the product
 * name, which covers `/` (it redirects before rendering), the 404 and
 * error boundaries, and the dev-only labs — none of which should be left
 * without an `<h1>` either.
 */
function useRouteHeading(): string {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const heading = ROUTE_HEADINGS[matches[i]!.routeId];
    if (heading) return heading;
  }
  return "Pi Companion";
}

/**
 * The authenticated app shell (plan.md §8.3): a header with connection
 * state, then the three-region workspace — left session rail, centre
 * transcript/composer, right Pi extension rail — collapsing to a single
 * stacked column under the design-tokens "wide" breakpoint (see
 * `shell.css`'s media query, kept in sync with
 * `@picompanion/design-tokens`' `breakpoints.wide` by `shell.test.tsx`).
 */
export function Shell({ sessionRail, extensionRail, children }: ShellProps) {
  const hasExtensionContent = extensionRail != null;
  const heading = useRouteHeading();

  return (
    <div className="shell">
      <header className="shell__header">
        {/*
          Visually hidden rather than rendered: the header already carries
          the brand mark and the connection badge, and §10.5 accepts a
          visually-hidden heading so long as it reaches a screen reader.
          Reuses the existing `.pc-visually-hidden` primitive utility rather
          than adding a second one in `shell.css` (plan.md §10: one approved
          treatment per concern).

          It lives INSIDE the header, not as a sibling above it: axe's
          `region` rule requires every piece of page content to sit within a
          landmark, and a bare `<h1>` between `.shell` and `<header>` is not
          in one. The real-browser run caught that; jsdom did not.
        */}
        <h1 className="pc-visually-hidden">{heading}</h1>
        <Link to="/connect" className="shell__brand">
          Pi Companion
        </Link>
        <ConnectionStatus />
      </header>
      <div className="shell__regions" data-testid="shell-regions">
        <nav
          className="shell__rail shell__rail--session"
          aria-label="Sessions"
          data-testid="shell-session-rail"
        >
          {sessionRail ?? (
            <EmptyState
              title="No sessions yet"
              description="Connect to a host to see its sessions here."
              testId="shell-session-rail-empty"
            />
          )}
        </nav>
        <main className="shell__center" data-testid="shell-center">
          {children}
        </main>
        <aside
          className="shell__rail shell__rail--extension"
          aria-label="Pi extensions"
          data-testid="shell-extension-rail"
          data-has-content={hasExtensionContent}
        >
          {extensionRail ?? (
            <EmptyState
              title="No live extensions"
              description="Fleet, workflow, loop, and goal activity appear here while a session runs."
              testId="shell-extension-rail-empty"
            />
          )}
        </aside>
      </div>
    </div>
  );
}
