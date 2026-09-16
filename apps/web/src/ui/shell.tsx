import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link, useMatches, useNavigate, useParams } from "@tanstack/react-router";

import { ConnectionStatus } from "../features/connection/connection-status.js";
import { EmptyState, IconButton } from "./primitives/index.js";
import { useRailCollapse } from "./use-rail-collapse.js";
import "./shell.css";

/** IDs the header's collapse toggles point `aria-controls` at. */
const SESSION_RAIL_ID = "shell-session-rail-region";
const EXTENSION_RAIL_ID = "shell-extension-rail-region";

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
  /**
   * Header workspace crumb slot (this task's top-bar fidelity work):
   * `root-route.tsx` mounts `features/sessions`' `WorkspaceCrumb`, which
   * reads the open session's own `cwd`/branch. `Shell` owns the slot's
   * position between the brand mark and the spacer; it never invents a
   * workspace value itself.
   */
  headerWorkspace?: ReactNode;
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
/**
 * FIX-W7: true when `target` is (or sits inside) an editable surface that
 * owns its own keystrokes — a form control (`<input>`, `<textarea>`,
 * `<select>`) or any `contenteditable` region (a rich-text composer
 * field), or any open modal/dialog (`role="dialog"`/`role="alertdialog"`,
 * the shared contract `Dialog.tsx`/`Sheet.tsx`/`Popover.tsx` all render).
 * `Shell`'s global Ctrl/Cmd+B and Ctrl/Cmd+. keydown listener must defer
 * to all of these rather than hijack a keystroke a focused textarea, a
 * `TextField`, or a modal's own field is meant to receive.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return target.closest('[role="dialog"], [role="alertdialog"]') != null;
}

function useRouteHeading(): string {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const heading = ROUTE_HEADINGS[matches[i]!.routeId];
    if (heading) return heading;
  }
  return "Pi Companion";
}

/**
 * The authenticated app shell (plan.md §8.3): a header with the brand
 * mark, the open workspace's crumb, connection state and the settings
 * entry point, then the three-region workspace — left session rail,
 * centre transcript/composer, right Pi extension rail — collapsing to a
 * single stacked column under the design-tokens "wide" breakpoint (see
 * `shell.css`'s media query, kept in sync with
 * `@picompanion/design-tokens`' `breakpoints.wide` by `shell.test.tsx`).
 *
 * The settings gear is the header's own inbound link to
 * `/h/$serverId/settings`: that route existed with no reachable entry
 * point anywhere in the app until this header added one. It resolves
 * `serverId` from the currently matched route (the same loose-params
 * read `root-route.tsx` uses) and renders only when a host is genuinely
 * in context — on `/connect` there is no host to open settings for.
 *
 * UI-X3: the header's right side matches the design reference
 * (`docs/ui-reference/pi-companion-web.html`'s `.bar-tools`, which holds
 * only `#settings-btn`) pixel for pixel — it now renders the settings
 * gear alone. The `Files`/`Terminal` session-tool links and the
 * connection badge that used to sit here moved into
 * `HostSettingsScreen` (`routes/screens/host-settings-screen.tsx`,
 * `/h/$serverId/settings` — the same route this gear already opened, so
 * no second settings surface was created); their `data-testid`s
 * (`shell-files-link`/`shell-terminal-link`) moved with them onto the
 * elements now performing that role. The two manual rail-collapse
 * toggles are a separately-documented owner requirement with no
 * reference equivalent at all (see `shell.css`'s own header comment:
 * "The reference has no manual collapse affordance") and keep their
 * direct, one-click/one-keystroke reach — both now sit together left of
 * the spacer instead of split across it, so the reference's own
 * right-of-spacer position stays gear-only without losing either
 * toggle's immediacy or its Ctrl/Cmd+B / Ctrl/Cmd+. shortcut.
 */
export function Shell({ sessionRail, extensionRail, headerWorkspace, children }: ShellProps) {
  const hasExtensionContent = extensionRail != null;
  const heading = useRouteHeading();
  const params = useParams({ strict: false }) as { serverId?: string };
  const serverId = params.serverId;
  const navigate = useNavigate();
  const { sessionCollapsed, extensionCollapsed, toggleSessionRail, toggleExtensionRail } =
    useRailCollapse();

  // Keyboard shortcuts (owner requirement): Ctrl/Cmd+B toggles the left
  // (session) rail, Ctrl/Cmd+. toggles the right (live extension) rail —
  // both also stated in the buttons' own `title` below. `event.metaKey`
  // covers macOS Cmd; `event.ctrlKey` covers Windows/Linux Ctrl, so only
  // one of the two needs to be held.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      // FIX-W7: an input/textarea/select, a contenteditable region, or an
      // open dialog owns this keystroke instead — see `isEditableTarget`.
      if (isEditableTarget(event.target)) return;
      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        toggleSessionRail();
      } else if (event.key === ".") {
        event.preventDefault();
        toggleExtensionRail();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSessionRail, toggleExtensionRail]);

  return (
    <div
      className="shell"
      data-rail-session={sessionCollapsed ? "collapsed" : "expanded"}
      data-rail-extension={extensionCollapsed ? "collapsed" : "expanded"}
    >
      <header className="shell__header">
        {/*
          Visually hidden rather than rendered: the header already carries
          the brand mark, and §10.5 accepts a visually-hidden heading so
          long as it reaches a screen reader.
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
          <span className="shell__brand-tile" aria-hidden="true">
            π
          </span>
          <span className="shell__brand-name">Pi Companion</span>
        </Link>
        {headerWorkspace}
        <IconButton
          icon="panel-left"
          accessibleName={sessionCollapsed ? "Show sessions" : "Hide sessions"}
          aria-expanded={!sessionCollapsed}
          aria-controls={SESSION_RAIL_ID}
          title={`${sessionCollapsed ? "Show sessions" : "Hide sessions"} (Ctrl/Cmd+B)`}
          className="shell__rail-toggle"
          data-testid="shell-toggle-session-rail"
          onClick={toggleSessionRail}
        />
        <div className="shell__header-spacer" />
        <div className="shell__header-tools">
          {/*
           * UI-X12. Each rail toggle sits on the side it controls: the session
           * rail's stays left by the brand, the live pane's moved here. UI-X3
           * had grouped both on the left while reducing the header to a single
           * gear, which left a control that collapses the RIGHT panel sitting
           * at the far left, pointing away from the thing it acts on.
           *
           * The reference has no rail-collapse affordance at all, so nothing is
           * being diverged from -- these are the owner's own controls and this
           * is purely their arrangement.
           */}
          <IconButton
            icon="panel-right"
            accessibleName={extensionCollapsed ? "Show live pane" : "Hide live pane"}
            aria-expanded={!extensionCollapsed}
            aria-controls={EXTENSION_RAIL_ID}
            title={`${extensionCollapsed ? "Show live pane" : "Hide live pane"} (Ctrl/Cmd+.)`}
            className="shell__rail-toggle"
            data-testid="shell-toggle-extension-rail"
            onClick={toggleExtensionRail}
          />
          {serverId ? (
            <IconButton
              icon="settings"
              accessibleName="Settings"
              className="shell__gear"
              data-testid="shell-settings-trigger"
              onClick={() => {
                void navigate({ to: "/h/$serverId/settings", params: { serverId } });
              }}
            />
          ) : (
            // UI-X9. UI-X3 moved the connection badge into `HostSettingsScreen`
            // to match the reference top bar, which holds nothing but a
            // settings gear. That is right for a session, and wrong before
            // there is one: the gear above renders only with a `serverId`, so
            // without this branch the bootstrap and `/connect` routes carry no
            // connection feedback at all, and the screen it moved to is
            // reachable only from inside a host session.
            //
            // No parity is given up. The reference mockup is a single-session
            // view and defines no connect screen, so it says nothing about
            // this state; the badge appears exactly where the reference has no
            // opinion, and never beside the gear it replaced.
            <ConnectionStatus />
          )}
        </div>
      </header>
      <div className="shell__regions" data-testid="shell-regions">
        <nav
          id={SESSION_RAIL_ID}
          className="shell__rail shell__rail--session"
          aria-label="Sessions"
          data-testid="shell-session-rail"
        >
          {sessionRail ?? (
            <div className="shell__rail-fallback">
              <EmptyState
                title="No sessions yet"
                description="Connect to a host to see its sessions here."
                testId="shell-session-rail-empty"
              />
            </div>
          )}
        </nav>
        <main className="shell__center" data-testid="shell-center">
          {children}
        </main>
        <aside
          id={EXTENSION_RAIL_ID}
          className="shell__rail shell__rail--extension"
          aria-label="Pi extensions"
          data-testid="shell-extension-rail"
          data-has-content={hasExtensionContent}
        >
          {extensionRail ?? (
            // UI-P9: `.shell__live-scroll` is the reference `.live-scroll`'s
            // padded/scrolling row-2 grid cell (see `shell.css`'s own
            // comment on that class) — wrapping the fallback here keeps it
            // sitting at the reference's padding instead of flush against
            // the rail's edges, matching the populated case below where
            // `ExtensionRailContent` wraps its own non-head children the
            // same way.
            <div className="shell__live-scroll">
              <EmptyState
                title="No live extensions"
                description="Fleet, workflow, loop, and goal activity appear here while a session runs."
                testId="shell-extension-rail-empty"
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
