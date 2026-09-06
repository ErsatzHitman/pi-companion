import { useCallback, useEffect, useState } from "react";

import type { AgentSlashCommand, AgentTurnClient } from "./agent-turn-client.js";

/**
 * Slash-command completion (T28B4, plan.md §11.1's "commands and
 * slash-command completion").
 *
 * `commands` mirrors the daemon's own `list_commands_response` for this
 * agent (`AgentTurnClient.listCommands`, `agent-turn-client.ts`) rather
 * than a hard-coded set: it starts empty and stays empty for a client
 * that omits `listCommands` (the same "no client yet" seam
 * `onQueueUpdate`/`abort` already use), and re-fetches whenever the
 * agent or client identity changes.
 *
 * The palette (rendered by `Composer` with the `CommandSearch` recipe)
 * opens automatically the instant the whole draft is `/` plus a
 * space-free token — i.e. before the user has started typing a command's
 * arguments — and can also be opened manually via `open()` for
 * discoverability without relying on typing "/" (plan.md §10.5:
 * keyboard operable without a mouse). It never blocks a send: an
 * unrecognized slash command is simply text `useComposer.submit` sends
 * as-is (`agent-turn-client.ts`'s `sendAgentMessage` does no client-side
 * command validation), so closing or ignoring this palette never stops a
 * submission from going through.
 */
export interface UseSlashCommandsOptions {
  /** Agent this palette lists commands for. */
  sessionId: string;
  /** Optional turn-control client; `listCommands` is itself optional on it. */
  client?: AgentTurnClient;
  /** The composer's current draft text. */
  draftText: string;
}

export interface UseSlashCommandsState {
  /** Every command the daemon reported for this agent; empty until resolved (or unsupported). */
  commands: readonly AgentSlashCommand[];
  /** True while the palette should be shown. */
  isOpen: boolean;
  /** Opens the palette manually, independent of what is currently typed. */
  open: () => void;
  /** Closes the palette without changing the draft. */
  dismiss: () => void;
  /** The most recent `listCommands` failure, or `null`. */
  error: string | null;
}

/** True exactly while the whole draft is `/` followed by a space-free token. */
function isBareSlashPrefix(draftText: string): boolean {
  return /^\/\S*$/.test(draftText);
}

export function useSlashCommands({
  sessionId,
  client,
  draftText,
}: UseSlashCommandsOptions): UseSlashCommandsState {
  const [commands, setCommands] = useState<readonly AgentSlashCommand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Refetch whenever the agent or client identity changes; a client that
  // omits `listCommands` leaves the list at its empty default rather than
  // erroring (mirrors `useComposer`'s `onQueueUpdate` subscription).
  useEffect(() => {
    setCommands([]);
    setError(null);
    if (!client?.listCommands) return;
    let cancelled = false;
    client
      .listCommands(sessionId)
      .then((list) => {
        if (!cancelled) setCommands(list);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [client, sessionId]);

  const autoTrigger = isBareSlashPrefix(draftText);

  // Once the draft no longer looks like a bare "/command" prefix, forget
  // any earlier dismissal so typing "/" again re-opens the palette.
  useEffect(() => {
    if (!autoTrigger) setDismissed(false);
  }, [autoTrigger]);

  const open = useCallback(() => {
    setManuallyOpen(true);
    setDismissed(false);
  }, []);

  const dismiss = useCallback(() => {
    setManuallyOpen(false);
    setDismissed(true);
  }, []);

  const isOpen = commands.length > 0 && ((autoTrigger && !dismissed) || manuallyOpen);

  return { commands, isOpen, open, dismiss, error };
}
