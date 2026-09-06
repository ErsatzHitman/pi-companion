/**
 * Session create/open wire shapes and client contract (T27B2, plan.md
 * §7.1/§12.3, §12.4's "existing daemon RPC" rule applied to sessions).
 *
 * `apps/web` never creates or opens a session by any means other than
 * this narrow `SessionsClient` interface, which is shaped to match
 * `@picompanion/client`'s `DaemonClient.createAgent(options)` (see
 * `packages/client/src/daemon-client.ts`) and the
 * `create_agent_request`/`status(agent_created|agent_create_failed)`
 * wire messages (see `packages/protocol/src/messages.ts`,
 * `CreateAgentRequestMessageSchema`,
 * `packages/protocol/src/fixtures/daemon-ws/session-new.json`). A real
 * `DaemonClient` already satisfies the narrower `DaemonAgentClient`
 * shape `daemon-sessions-client.ts` depends on structurally; nothing
 * here needs to import `@picompanion/client` to stay in sync with it
 * (matching `features/files/file-browser-client.ts`'s precedent).
 */
import type { SessionSummary } from "./types.js";

export interface CreateSessionInput {
  /** Matches `AgentSessionConfig.provider`; this product's daemon currently only registers `"pi"`. */
  provider: string;
  /** Matches `AgentSessionConfig.cwd`: the workspace directory the new session runs in. */
  cwd: string;
}

/**
 * Forks a session at a specific point in its history (T38A3, plan.md
 * §7.1/§11.1). Mirrors the daemon's Pi-provider `fork` RPC command
 * (`{ id?, type: "fork", entryId }`, `packages/server/.../pi/rpc-types.ts`,
 * T38A0) and `frontend-core`'s `ForkSessionParams`/`SessionForkPoint`
 * (`packages/frontend-core/src/sessions/tree.ts`, T38A1a): `entryId` is
 * the last transcript entry the fork still shares with its source,
 * `entryIndex` that entry's position, carried alongside purely for
 * display/ordering the same way `SessionForkPoint.index` is.
 */
export interface ForkSessionInput {
  entryId: string;
  entryIndex: number;
  name?: string | null;
}

/** Duplicates a session into a brand-new, independent one (T38A3's `clone`; needs no entryId, unlike `fork`). */
export interface CloneSessionInput {
  name?: string | null;
}

export interface ForkSessionResult {
  session: SessionSummary;
  forkPoint: { messageId: string; index: number };
}

export interface CloneSessionResult {
  session: SessionSummary;
}

/**
 * Renames a session (T38A4, plan.md §7.1/§11.1). Mirrors the daemon's
 * Pi-provider `set_session_name` RPC command
 * (`{ id?, type: "set_session_name", name }`,
 * `packages/server/.../pi/rpc-types.ts`, T38A0). `name` is validated
 * and bounded by `validateSessionName` (`validate-session-name.ts`)
 * before this type is ever constructed by a caller in this feature —
 * see that module's doc for the exact bound and why it is justified
 * against `AgentSessionConfigSchema.title`.
 */
export interface RenameSessionInput {
  name: string;
}

export interface RenameSessionResult {
  session: SessionSummary;
}

export interface SessionsClient {
  /**
   * Creates a session and resolves once the daemon has acknowledged it
   * (`status(agent_created)`). Rejects with an `Error` whose `message`
   * is the daemon's raw explanation (`status(agent_create_failed).error`)
   * on failure.
   */
  createSession(input: CreateSessionInput): Promise<SessionSummary>;
  /**
   * Archives a session (T27B4, `archive_agent_request` /
   * `agent_archived`). Resolves with the daemon-assigned archive
   * timestamp so a caller that applied an optimistic `archivedAt` can
   * reconcile it with the real one. Optional so the minimal test
   * doubles other tasks in this feature already construct (just
   * `{ createSession }`) keep compiling; both `createDaemonSessionsClient`
   * and `createPendingConnectionSessionsClient` always provide it.
   */
  archiveSession?(sessionId: string): Promise<{ archivedAt: string }>;
  /**
   * Permanently deletes a session (T27B4, `delete_agent_request` /
   * `agent_deleted`). Optional for the same reason as `archiveSession`.
   */
  deleteSession?(sessionId: string): Promise<void>;
  /**
   * Fetches the current, authoritative session list from the daemon
   * (T27B6, `fetch_agents_request` / `fetch_agents_response`). Used by
   * `useSessionListSync` to reconcile the rail after a reconnect or a
   * gap in an otherwise-open connection, never to render the list from
   * scratch on every render. Optional for the same reason as
   * `archiveSession`/`deleteSession`: a caller still on the
   * pending-connection placeholder client simply never syncs.
   */
  fetchSessions?(): Promise<SessionSummary[]>;
  /**
   * Forks `sourceSessionId` at `input.entryId` (T38A3, `fork`). Optional
   * for the same reason as `archiveSession`/`deleteSession`: no real
   * browser-facing wire message exists for this yet (see
   * `daemon-sessions-client.ts`'s module doc for the disclosed gap), so
   * every client this feature can build today either omits this member
   * or implements it against a fake.
   */
  forkSession?(sourceSessionId: string, input: ForkSessionInput): Promise<ForkSessionResult>;
  /** Clones `sourceSessionId` into a brand-new session (T38A3, `clone`). Optional for the same reason as `forkSession`. */
  cloneSession?(sourceSessionId: string, input?: CloneSessionInput): Promise<CloneSessionResult>;
  /**
   * Renames `sessionId` (T38A4, `set_session_name`). Optional for the
   * same reason as `forkSession`/`cloneSession`: no browser-facing wire
   * message backs this yet either — see `daemon-sessions-client.ts`'s
   * `renameAgent` doc for the disclosed gap, which is the same shape as
   * `forkAgent`/`cloneAgent`'s.
   */
  renameSession?(sessionId: string, input: RenameSessionInput): Promise<RenameSessionResult>;
}

/**
 * Sentinel error message `useSessionActions` (T27B4) throws when the
 * injected `SessionsClient` doesn't implement `archiveSession`/
 * `deleteSession` at all (an optional-member gap, not a daemon error),
 * so `explainSessionsActionError` can still give it a clear, worded
 * explanation instead of surfacing `undefined is not a function`.
 */
export const SESSIONS_ACTION_UNSUPPORTED = "SESSIONS_ACTION_UNSUPPORTED";

/**
 * Sentinel error message used by `createPendingConnectionSessionsClient`
 * (this feature's stand-in client, used until a live app-wide
 * `DaemonClient` is wired through `apps/web/src/app/core-context.tsx`)
 * so `explainSessionsCreateError` can give it a dedicated explanation
 * instead of falling through to the generic "couldn't create session"
 * message.
 */
export const SESSIONS_NOT_CONNECTED = "SESSIONS_NOT_CONNECTED";

export interface SessionsErrorExplanation {
  readonly title: string;
  readonly description: string;
}

/**
 * Maps a raw daemon (or placeholder-client) error message to a title
 * and description a user can act on, without losing the raw daemon
 * text (T27B2's "a failed create surfaces an error without losing
 * typed input" acceptance criterion covers the form fields; this
 * covers the message itself staying informative).
 */
export function explainSessionsCreateError(rawMessage: string): SessionsErrorExplanation {
  const message = rawMessage.trim();

  if (message === SESSIONS_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon before creating a session.",
    };
  }
  if (/cwd is required|provider.+required|requires provider and cwd/i.test(message)) {
    return {
      title: "Missing session details",
      description: "A working directory is required to create a session.",
    };
  }
  if (/^enoent\b/i.test(message) || /no such file or directory/i.test(message)) {
    return {
      title: "That folder doesn't exist",
      description: "Check the working directory and try again.",
    };
  }
  return {
    title: "Couldn't create this session",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}

/**
 * Maps a raw daemon (or placeholder-client) error message from a failed
 * `archiveSession`/`deleteSession`/`forkSession`/`cloneSession` call to
 * a title and description a user can act on (T27B4, mirrors
 * `explainSessionsCreateError`'s shape for the create path; T38A3 added
 * `"fork"`/`"clone"`; T38A4 added `"rename"`).
 */
export function explainSessionsActionError(
  action: "archive" | "delete" | "fork" | "clone" | "rename",
  rawMessage: string,
): SessionsErrorExplanation {
  const message = rawMessage.trim();
  const verbs: Record<typeof action, string> = {
    archive: "archiving",
    delete: "deleting",
    fork: "forking",
    clone: "cloning",
    rename: "renaming",
  };
  const nouns: Record<typeof action, string> = {
    archive: "archive",
    delete: "delete",
    fork: "fork",
    clone: "clone",
    rename: "rename",
  };
  const titles: Record<typeof action, string> = {
    archive: "Couldn't archive this session",
    delete: "Couldn't delete this session",
    fork: "Couldn't fork this session",
    clone: "Couldn't clone this session",
    rename: "Couldn't rename this session",
  };
  const verb = verbs[action];
  const noun = nouns[action];
  const title = titles[action];

  if (message === SESSIONS_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: `Connect to a daemon before ${verb} a session.`,
    };
  }
  if (message === SESSIONS_ACTION_UNSUPPORTED) {
    return {
      title: "Not supported",
      description: `This host can't ${noun} sessions yet.`,
    };
  }
  if (/not found/i.test(message)) {
    return {
      title: "Session not found",
      description: "This session may have already been removed.",
    };
  }
  return {
    title,
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}
