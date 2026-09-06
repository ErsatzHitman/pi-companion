/**
 * Real `DiscoveredSessionsClient` adapter over a `DaemonClient`-shaped
 * object (T27B5, plan.md §7.4/§12.3), the discovery/import counterpart
 * of `daemon-sessions-client.ts`'s create-side adapter.
 *
 * `DaemonProviderSessionsClient` is deliberately the narrowest possible
 * slice of `@picompanion/client`'s `DaemonClient` this feature needs —
 * `fetchRecentProviderSessions` and `importAgent` — so this module
 * never has to import `@picompanion/client` to stay structurally
 * compatible with it (matching `daemon-sessions-client.ts`'s and
 * `daemon-session-resume-client.ts`'s precedent). A real `DaemonClient`
 * satisfies `DaemonProviderSessionsClient` as-is;
 * `daemon-discovered-sessions-client.fixture.test.ts` proves that
 * against the real class and recorded protocol fixtures.
 */
import { toSessionSummary } from "./daemon-sessions-client.js";
import type { DaemonAgentSnapshot } from "./daemon-sessions-client.js";
import type {
  DiscoveredSession,
  DiscoveredSessionsClient,
  ImportDiscoveredSessionInput,
  ListDiscoveredSessionsInput,
} from "./discovered-sessions-client.js";
import type { SessionSummary } from "./types.js";

/**
 * The subset of `RecentProviderSessionDescriptorPayload`
 * (`@picompanion/protocol`'s `messages.ts`) this feature reads. A real
 * payload has every one of these fields, so it satisfies this type
 * as-is.
 */
export interface DaemonRecentProviderSessionEntry {
  providerId: string;
  providerLabel: string;
  providerHandleId: string;
  cwd: string;
  title: string | null;
  firstPromptPreview: string | null;
  lastPromptPreview: string | null;
  lastActivityAt: string;
}

export interface DaemonProviderSessionsClient {
  fetchRecentProviderSessions(options?: {
    cwd?: string;
  }): Promise<{ entries: DaemonRecentProviderSessionEntry[] }>;
  /** Matches `DaemonClient.importAgent`. */
  importAgent(input: {
    providerId: string;
    providerHandleId: string;
    cwd?: string;
  }): Promise<DaemonAgentSnapshot>;
}

function toDiscoveredSession(entry: DaemonRecentProviderSessionEntry): DiscoveredSession {
  return {
    providerId: entry.providerId,
    providerLabel: entry.providerLabel,
    providerHandleId: entry.providerHandleId,
    cwd: entry.cwd,
    title: entry.title,
    firstPromptPreview: entry.firstPromptPreview,
    lastPromptPreview: entry.lastPromptPreview,
    lastActivityAt: entry.lastActivityAt,
  };
}

/** Builds a `DiscoveredSessionsClient` backed by a real (or fixture-driven fake) `DaemonClient`. */
export function createDaemonDiscoveredSessionsClient(
  daemon: DaemonProviderSessionsClient,
): DiscoveredSessionsClient {
  return {
    async listDiscoveredSessions(
      input?: ListDiscoveredSessionsInput,
    ): Promise<DiscoveredSession[]> {
      const result = await daemon.fetchRecentProviderSessions(
        input?.cwd ? { cwd: input.cwd } : undefined,
      );
      return result.entries.map(toDiscoveredSession);
    },
    async importSession(input: ImportDiscoveredSessionInput): Promise<SessionSummary> {
      const agent = await daemon.importAgent({
        providerId: input.providerId,
        providerHandleId: input.providerHandleId,
        cwd: input.cwd,
      });
      return toSessionSummary(agent);
    },
  };
}
