/**
 * Pi session discovery/import wire shapes and client contract (T27B5,
 * plan.md §7.4/§12.3, "Pi session discovery, import, ... §2.2").
 *
 * `apps/web` never lists or imports a host's on-disk Pi sessions by any
 * means other than this narrow `DiscoveredSessionsClient` interface,
 * shaped to match `@picompanion/client`'s
 * `DaemonClient.fetchRecentProviderSessions`/`DaemonClient.importAgent`
 * (see `packages/client/src/daemon-client.ts`) and the
 * `fetch_recent_provider_sessions_request`/`_response` and
 * `import_agent_request`/`status(agent_resumed|agent_create_failed)`
 * wire messages (see `packages/protocol/src/messages.ts`,
 * `packages/protocol/src/fixtures/daemon-ws/session-import-terminal.json`).
 * Matches `sessions-client.ts`'s precedent: a real `DaemonClient`
 * already satisfies the narrower `DaemonProviderSessionsClient` shape
 * `daemon-discovered-sessions-client.ts` depends on structurally;
 * nothing here needs to import `@picompanion/client` to stay in sync
 * with it.
 */
import type { SessionSummary } from "./types.js";
import { SESSIONS_NOT_CONNECTED, type SessionsErrorExplanation } from "./sessions-client.js";

/**
 * A Pi session the daemon found on disk (via `pi-session-watcher.ts`'s
 * `listImportableSessions`) but that has no matching agent record yet
 * — including one started from a bare terminal, outside the daemon.
 * Mirrors `RecentProviderSessionDescriptorPayload`
 * (`@picompanion/protocol`'s `messages.ts`) field for field.
 */
export interface DiscoveredSession {
  providerId: string;
  providerLabel: string;
  providerHandleId: string;
  cwd: string;
  title: string | null;
  firstPromptPreview: string | null;
  lastPromptPreview: string | null;
  lastActivityAt: string;
}

export interface ListDiscoveredSessionsInput {
  /** Restricts discovery to a single working directory, matching `FetchRecentProviderSessionsOptions.cwd`. */
  cwd?: string;
}

export interface ImportDiscoveredSessionInput {
  providerId: string;
  providerHandleId: string;
  cwd: string;
}

export interface DiscoveredSessionsClient {
  /**
   * Lists discovered-but-not-yet-imported Pi sessions on this host. The
   * daemon already excludes anything with a live (non-archived) agent
   * record (`import-sessions.ts`'s `listImportableProviderSessions`),
   * so a fresh list never re-offers a session this client already
   * imported.
   */
  listDiscoveredSessions(input?: ListDiscoveredSessionsInput): Promise<DiscoveredSession[]>;
  /**
   * Imports a discovered session, turning it into a managed agent
   * (`status(agent_resumed)`). Resolves with the same `SessionSummary`
   * shape `SessionsClient.createSession` does, so a caller can insert
   * it into the same session list. Rejects with an `Error` whose
   * `message` is the daemon's raw explanation — including
   * `"Provider session is already imported: <handle>"` if this exact
   * session was imported (by this client or another) since the last
   * `listDiscoveredSessions` call — on failure.
   */
  importSession(input: ImportDiscoveredSessionInput): Promise<SessionSummary>;
}

/** Matches `import-sessions.ts`'s `importProviderSessionNow` error text for an already-active import. */
const ALREADY_IMPORTED_PATTERN = /already imported/i;

/**
 * Maps a raw daemon (or placeholder-client) error message from a failed
 * `listDiscoveredSessions`/`importSession` call to a title and
 * description a user can act on (mirrors `explainSessionsCreateError`'s
 * shape). A daemon `"already imported"` rejection is presented as a
 * benign, expected outcome rather than a failure — importing the same
 * discovered session twice never surfaces as an error a user needs to
 * retry from (T27B5's "import is idempotent" acceptance criterion).
 */
export function explainDiscoveredSessionsError(rawMessage: string): SessionsErrorExplanation {
  const message = rawMessage.trim();

  if (message === SESSIONS_NOT_CONNECTED) {
    return {
      title: "Not connected",
      description: "Connect to a daemon before discovering Pi sessions.",
    };
  }
  if (ALREADY_IMPORTED_PATTERN.test(message)) {
    return {
      title: "Already imported",
      description: "This session has already been imported. Open it from the session list.",
    };
  }
  return {
    title: "Couldn't import this session",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
  };
}

/** True for the daemon's `"already imported"` rejection text (T27B5 idempotency handling). */
export function isAlreadyImportedError(rawMessage: string): boolean {
  return ALREADY_IMPORTED_PATTERN.test(rawMessage.trim());
}
