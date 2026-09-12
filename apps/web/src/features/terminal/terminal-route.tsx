import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
} from "../../ui/primitives/index.js";
import "./terminal-route.css";
import { NEW_TERMINAL_ROUTE_SEGMENT } from "./terminal-route-params.js";
import { TerminalView } from "./terminal-view.js";
import type { SessionTerminalClient } from "./use-session-terminal.js";
import { useSessionTerminal } from "./use-session-terminal.js";

export interface TerminalRouteProps {
  serverId: string;
  agentId: string;
  terminalId: string;
  /**
   * The live client, or `undefined` while no daemon connection exists.
   * A real `DaemonClient` satisfies `SessionTerminalClient` structurally
   * (`listTerminals`/`createTerminal` plus the `TerminalRpcClient` slice
   * `TerminalView` mounts), so the route can both resolve a real terminal
   * and drive xterm from the one prop.
   */
  client?: SessionTerminalClient;
  /**
   * The session's daemon-side workspace root (protocol `cwd`). `""` while
   * the session snapshot is still resolving; the route waits rather than
   * listing against an empty root.
   */
  workspaceRoot?: string;
}

/**
 * `/h/:serverId/session/:agentId/terminal/:terminalId` route body
 * (plan.md §8.3/§8.4, T30A2; list/create/open wiring added later).
 *
 * A real daemon terminal id is not human-typable, so this route does not
 * just echo its `:terminalId` param: it lists the workspace's terminals
 * and opens the requested one when it exists, otherwise creates a real
 * terminal and opens that (the app's `NEW_TERMINAL_ROUTE_SEGMENT` link
 * target relies on the second half). The resolved terminal id is what
 * `TerminalView` subscribes and mounts xterm on, so a deep link to a
 * stale or placeholder id still lands somewhere usable rather than on a
 * dead terminal.
 */
export function TerminalRoute({
  serverId,
  agentId,
  terminalId,
  client,
  workspaceRoot = "",
}: TerminalRouteProps) {
  const controller = useSessionTerminal({
    client: client ?? null,
    workspaceRoot,
    requestedTerminalId: terminalId,
  });
  const { state } = controller;
  const navigate = useNavigate();

  // Keep the URL naming the terminal actually on screen: a `/terminal/new`
  // (or stale-id) deep link resolves to a real id by creating one, and the
  // route replaces its param with that id so a refresh or a copied link
  // lands on the same terminal. Navigation only fires on an actual
  // mismatch, so the re-run it triggers resolves back to the same id and
  // stops here.
  useEffect(() => {
    if (state.status !== "ready" || !state.terminalId || state.terminalId === terminalId) {
      return;
    }
    void navigate({
      to: "/h/$serverId/session/$agentId/terminal/$terminalId",
      params: { serverId, agentId, terminalId: state.terminalId },
      replace: true,
    });
  }, [state.status, state.terminalId, terminalId, navigate, serverId, agentId]);

  return (
    <Section title="Terminal" className="pc-terminal-route">
      {state.status === "ready" && state.terminals.length > 0 ? (
        <nav className="pc-terminal-route__switcher" aria-label="Terminals">
          <ul className="pc-terminal-route__list" data-testid="terminal-route-list">
            {state.terminals.map((entry) => (
              <li key={entry.id}>
                <Link
                  className="pc-link"
                  to="/h/$serverId/session/$agentId/terminal/$terminalId"
                  params={{ serverId, agentId, terminalId: entry.id }}
                  aria-current={entry.id === state.terminalId ? "page" : undefined}
                  data-testid={`terminal-route-list-item-${entry.id}`}
                >
                  {entry.title ?? entry.name}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            className="pc-link"
            to="/h/$serverId/session/$agentId/terminal/$terminalId"
            params={{ serverId, agentId, terminalId: NEW_TERMINAL_ROUTE_SEGMENT }}
            data-testid="terminal-route-new"
          >
            New terminal
          </Link>
        </nav>
      ) : null}

      {state.status === "loading" ? (
        <LoadingState
          title="Opening terminal…"
          description="Finding a terminal for this session."
          testId="terminal-route-loading"
        />
      ) : null}
      {state.status === "error" && state.error ? (
        <div className="pc-terminal-route__error">
          <ErrorState
            title={state.error.title}
            description={state.error.description}
            testId="terminal-route-error"
          />
          <Button kind="secondary" onClick={controller.retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {state.status === "no-client" ? (
        <EmptyState
          title="Waiting for a daemon connection"
          description="The terminal needs an active connection to this host before it can start."
          testId="terminal-route-no-client"
        />
      ) : null}
      {state.status === "ready" && state.terminalId && client ? (
        <TerminalView client={client} terminalId={state.terminalId} testId="terminal-view" />
      ) : null}
    </Section>
  );
}
