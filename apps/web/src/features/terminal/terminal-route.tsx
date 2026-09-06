import type { terminal } from "@picompanion/frontend-core";

import { EmptyState, Section } from "../../ui/primitives/index.js";
import "./terminal-route.css";
import { TerminalView } from "./terminal-view.js";

export interface TerminalRouteProps {
  serverId: string;
  agentId: string;
  terminalId: string;
  /**
   * The RPC client to mount xterm on. `undefined` renders a "waiting for
   * connection" state instead — the screen that mounts this route
   * (`routes/screens/host-session-terminal-screen.tsx`, T53A5) already
   * passes a real `DaemonClient` from `useDaemonClient()` (T53A1) once one
   * is connected; `undefined` only happens while no host connection
   * exists yet, e.g. before the user has connected to a daemon at all.
   * This prop stays an explicit, injectable seam either way, so tests
   * (and any future caller) never need a live connection to exercise
   * either state.
   */
  client?: terminal.TerminalRpcClient;
}

/**
 * `/h/:serverId/session/:agentId/terminal/:terminalId` route body
 * (plan.md §8.3/§8.4, T30A2). Shows the route's own identity (host,
 * session, terminal) above the mounted terminal, same as the T27S2
 * placeholder it replaces.
 */
export function TerminalRoute({ serverId, agentId, terminalId, client }: TerminalRouteProps) {
  return (
    <Section title="Terminal" className="pc-terminal-route">
      <dl className="pc-terminal-route__params">
        <div>
          <dt>Host</dt>
          <dd>{serverId}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{agentId}</dd>
        </div>
        <div>
          <dt>Terminal</dt>
          <dd>{terminalId}</dd>
        </div>
      </dl>
      {client ? (
        <TerminalView client={client} terminalId={terminalId} testId="terminal-view" />
      ) : (
        <EmptyState
          title="Waiting for a daemon connection"
          description="The terminal needs an active connection to this host before it can start."
          testId="terminal-route-no-client"
        />
      )}
    </Section>
  );
}
