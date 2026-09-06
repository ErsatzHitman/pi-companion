/**
 * Node-side session seeding for T31B's transcript/lifecycle scenarios.
 *
 * **Why this exists.** T53A4 wired `apps/web/src/routes/screens/
 * host-sessions-screen.tsx` to build its `SessionsClient` from
 * `useDaemonClientContext()`, so the "New session" UI on
 * `/h/:serverId/sessions` now does reach a live daemon — see
 * `session-lifecycle.spec.ts` (T31B2), which drives that dialog end to
 * end and proves it. This module still exists for every *other* T31B
 * scenario (steer/follow-up, tool-call + diff detail, reconnect/
 * catch-up, deep-link restore, keyboard nav) that only needs *a session
 * to already exist* before the browser opens it — the one screen that
 * is wired to a live `DaemonClient`, `/h/:serverId/session/:agentId`
 * (`host-session-screen.tsx`, T53A2), covers resume, transcript,
 * approvals, and the composer already, without paying the cost of
 * driving the create-session dialog in every spec that doesn't
 * actually need to test it.
 *
 * This module seeds that precondition the same way any backend
 * integration test does: a second, independent `DaemonClient` — built
 * from `@picompanion/client`'s public root export, the same class
 * `apps/web/src/app/daemon-client-context.tsx` uses for the real app —
 * connects to the isolated daemon over the exact same wire protocol a
 * browser would, and calls the exact same `createAgent` RPC
 * `daemon-sessions-client.ts`'s `createDaemonSessionsClient` would have
 * called had it been wired in. This is "seed preconditions through the
 * public API", not a stand-in for the product: nothing here renders
 * anything or bypasses a daemon rule a browser client would also have to
 * satisfy.
 *
 * The daemon fixture (`daemon.ts`) configures no `auth.password`, so
 * `DaemonClientConfig.password` stays unset here too — matching what an
 * unauthenticated `/connect` (T31A's smoke spec) already proves works
 * end to end against this same isolated daemon.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DaemonClient } from "@picompanion/client";
import type { PaseoAgent } from "@picompanion/client";
import { buildDaemonWebSocketUrl } from "@picompanion/protocol/daemon-endpoints";

export interface ConnectSeedClientOptions {
  /** `host:port`, matching `DaemonConnection.address` (`fixtures/test.ts`). */
  address: string;
}

/**
 * Opens one seeding `DaemonClient` connection to the isolated daemon.
 * Callers must `close()` it (directly, or via `seedSession`'s own
 * `close`) so a failing test never leaks an open daemon connection past
 * itself.
 */
export async function connectSeedClient(options: ConnectSeedClientOptions): Promise<DaemonClient> {
  const url = buildDaemonWebSocketUrl(options.address, { useTls: false });
  const client = new DaemonClient({
    url,
    clientId: `picompanion-e2e-seed-${randomUUID()}`,
    clientType: "cli",
    // No `webSocketFactory` override: `defaultWebSocketFactory`
    // (`daemon-client-websocket-transport.ts`) already reads
    // `globalThis.WebSocket`, and this harness only ever runs on Node 22+
    // (native, spec-compliant `WebSocket` global) — see this module's
    // own doc comment for why no extra transport dependency is needed.
  });
  await client.connect();
  return client;
}

export interface SeedSessionOptions {
  address: string;
  /**
   * Defaults to (and, in practice, must be) `"pi"` — the isolated
   * daemon's fixture (`daemon.ts`) only registers a fake `AgentClient`
   * for this product's one real provider id
   * (`packages/protocol/src/provider-manifest.ts`'s
   * `AGENT_PROVIDER_DEFINITIONS`); any other id rejects with
   * `"Provider <x> is not configured"` (see `fake-pi-agent-client.ts`'s
   * module doc for the full trace).
   */
  provider?: string;
  /**
   * This fake provider (`fake-pi-agent-client.ts`) only ever emits a
   * `permission_requested` event for its two deterministic
   * `"request permission"`/`"request dangerous permission"` prompts
   * (T31C1, `approvals.spec.ts`); every other tool call still runs
   * straight through unconditionally regardless of `modeId` — this
   * fake never actually reads it as a gate. Accepted and forwarded to
   * `createAgent` anyway (harmless) for tests that want an explicit,
   * self-documenting mode.
   */
  modeId?: string;
  /** Reuses an already-open seed client instead of opening a new one (e.g. to seed several sessions in one test). */
  client?: DaemonClient;
}

export interface SeededSession {
  agentId: string;
  cwd: string;
  client: DaemonClient;
  agent: PaseoAgent;
  /** Closes the seed `DaemonClient` (if this call opened one) and removes the temporary `cwd`. Always call from a `finally`. */
  close: () => Promise<void>;
}

/**
 * Creates one real agent/session on the isolated daemon through the
 * public `DaemonClient.createAgent` RPC (this module's doc comment
 * explains why). `cwd` is a fresh, per-session temp directory — the
 * fake provider's tool side effects (`fake-agent-client.ts`) read and
 * write real files there, so sessions never share one one directory.
 */
export async function seedSession(options: SeedSessionOptions): Promise<SeededSession> {
  const ownsClient = !options.client;
  const client = options.client ?? (await connectSeedClient({ address: options.address }));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "picompanion-e2e-session-"));

  const agent = await client.createAgent({
    provider: options.provider ?? "pi",
    cwd,
    ...(options.modeId ? { modeId: options.modeId } : {}),
  });

  const close = async (): Promise<void> => {
    if (ownsClient) {
      await client.close().catch(() => undefined);
    }
    await rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };

  return { agentId: agent.id, cwd, client, agent, close };
}
