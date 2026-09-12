/**
 * Session terminal state for the terminal route (plan.md §8.4/§12.4).
 *
 * The route is `/h/:serverId/session/:agentId/terminal/:terminalId`
 * (`routes/host-session-terminal.tsx`), but a daemon terminal id is not
 * something a person can type: this hook lists the terminals the daemon
 * already has for the session's workspace root and opens the requested
 * one when it exists. When it does not (including the app's own
 * `NEW_TERMINAL_ROUTE_SEGMENT` link target), it creates a real terminal
 * and opens that — so the route is genuinely usable and shareable
 * instead of only echoing its parameters.
 *
 * `SessionTerminalClient` is a narrow structural interface over the real
 * `DaemonClient` (`listTerminals`/`createTerminal` plus the
 * `terminal.TerminalRpcClient` slice `TerminalView` already mounts), so
 * a real client satisfies it as-is and tests can inject a fake — the
 * same pattern `daemon-sessions-client.ts` established.
 */
import type { terminal } from "@picompanion/frontend-core";
import { useEffect, useRef, useState } from "react";

import { NEW_TERMINAL_ROUTE_SEGMENT } from "./terminal-route-params.js";

/** The subset of a daemon `TerminalInfo` this route reads. */
export interface TerminalSummary {
  readonly id: string;
  readonly name: string;
  /** Absent on `list_terminals_response` entries (the daemon omits it there). */
  readonly cwd?: string;
  readonly title?: string;
}

export interface ListTerminalsResult {
  readonly terminals: readonly TerminalSummary[];
}

export interface CreateTerminalResult {
  readonly terminal: TerminalSummary | null;
  readonly error: string | null;
}

/**
 * Expanded seam for the terminal route: the `TerminalRpcClient` slice
 * `TerminalView` needs (subscribe/input/stream) plus the two workspace
 * RPCs that let the route resolve a real terminal. A real `DaemonClient`
 * satisfies this structurally.
 */
export interface SessionTerminalClient extends terminal.TerminalRpcClient {
  listTerminals(cwd?: string, requestId?: string): Promise<ListTerminalsResult>;
  createTerminal(cwd: string, name?: string, requestId?: string): Promise<CreateTerminalResult>;
}

export interface TerminalErrorExplanation {
  readonly title: string;
  readonly description: string;
  readonly raw: string;
}

export type SessionTerminalStatus = "no-client" | "loading" | "ready" | "error";

export interface SessionTerminalState {
  status: SessionTerminalStatus;
  /** The real terminal id to mount xterm on, once resolved. */
  terminalId: string | null;
  /** The session workspace's terminals, newest listing. */
  terminals: readonly TerminalSummary[];
  error: TerminalErrorExplanation | null;
}

export interface UseSessionTerminalOptions {
  /** The live client, or `null` while no daemon connection exists. */
  client: SessionTerminalClient | null;
  /** The session's daemon-side workspace root (protocol `cwd`); `""` while still resolving. */
  workspaceRoot: string;
  /** The route's `:terminalId` param: a real daemon id, or the "new" link segment. */
  requestedTerminalId: string;
}

export interface SessionTerminalController {
  state: SessionTerminalState;
  /** Re-runs the list/create resolution for the current params. */
  retry: () => void;
}

export function explainTerminalError(raw: unknown): TerminalErrorExplanation {
  const message = (raw instanceof Error ? raw.message : String(raw ?? "")).trim();
  if (/not connected|no connection|not_connected/i.test(message)) {
    return {
      title: "Not connected",
      description: "Connect to a daemon to open a terminal for this session.",
      raw: message,
    };
  }
  return {
    title: "Couldn't open a terminal",
    description:
      message.length > 0 ? message : "The daemon did not return a terminal for this session.",
    raw: message,
  };
}

export function useSessionTerminal(options: UseSessionTerminalOptions): SessionTerminalController {
  const { client, workspaceRoot, requestedTerminalId } = options;
  const [state, setState] = useState<SessionTerminalState>(() => ({
    status: client ? "loading" : "no-client",
    terminalId: null,
    terminals: [],
    error: null,
  }));
  const requestIdRef = useRef(0);
  const [retryToken, setRetryToken] = useState(0);
  // React StrictMode invokes this effect twice in development. Creating a
  // terminal is a real side effect (it spawns a PTY), so the in-flight
  // create promise is shared by key across both invocations; the second
  // awaits the first's promise instead of spawning a second shell.
  const createRef = useRef<{ key: string; promise: Promise<CreateTerminalResult> } | null>(null);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const isStale = () => requestIdRef.current !== requestId;

    if (!client) {
      setState({ status: "no-client", terminalId: null, terminals: [], error: null });
      return;
    }
    if (!workspaceRoot) {
      // The session's cwd has not resolved yet; wait rather than issuing
      // the list/create against an empty root.
      setState({ status: "loading", terminalId: null, terminals: [], error: null });
      return;
    }

    setState({ status: "loading", terminalId: null, terminals: [], error: null });

    void (async () => {
      let listed: readonly TerminalSummary[];
      try {
        const result = await client.listTerminals(workspaceRoot);
        listed = result.terminals;
      } catch (error) {
        if (isStale()) return;
        setState({
          status: "error",
          terminalId: null,
          terminals: [],
          error: explainTerminalError(error),
        });
        return;
      }
      if (isStale()) return;

      const requested = requestedTerminalId.trim();
      const existing =
        requested.length > 0 && requested !== NEW_TERMINAL_ROUTE_SEGMENT
          ? listed.find((entry) => entry.id === requested)
          : undefined;
      if (existing) {
        setState({ status: "ready", terminalId: existing.id, terminals: listed, error: null });
        return;
      }

      const key = `${workspaceRoot}::${requested}`;
      if (createRef.current?.key !== key) {
        createRef.current = {
          key,
          promise: client.createTerminal(workspaceRoot, "Terminal"),
        };
      }

      let created: CreateTerminalResult;
      try {
        created = await createRef.current.promise;
      } catch (error) {
        if (isStale()) return;
        createRef.current = null;
        setState({
          status: "error",
          terminalId: null,
          terminals: listed,
          error: explainTerminalError(error),
        });
        return;
      }
      if (isStale()) return;
      // Clear the shared promise now that it has resolved: it exists only to
      // stop StrictMode's second effect invocation from spawning a duplicate
      // PTY, not to cache a terminal. Without this, a later "New terminal"
      // visit (the same create key) would silently reopen the previously
      // created terminal instead of creating a fresh one.
      createRef.current = null;
      if (created.error || !created.terminal) {
        setState({
          status: "error",
          terminalId: null,
          terminals: listed,
          error: explainTerminalError(created.error ?? ""),
        });
        return;
      }

      const createdTerminal = created.terminal;
      const terminals = listed.some((entry) => entry.id === createdTerminal.id)
        ? listed
        : [...listed, createdTerminal];
      setState({ status: "ready", terminalId: createdTerminal.id, terminals, error: null });
    })();
    // `retryToken` intentionally participates only to force a re-run;
    // its value is never read.
  }, [client, workspaceRoot, requestedTerminalId, retryToken]);

  return {
    state,
    retry: () => setRetryToken((token) => token + 1),
  };
}
