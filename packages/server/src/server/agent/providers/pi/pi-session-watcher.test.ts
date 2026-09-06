import pino from "pino";
import { describe, expect, test } from "vitest";

import type { AgentManager, ManagedImportableProviderSession } from "../../agent-manager.js";
import type { AgentStorage } from "../../agent-storage.js";
import type { WorkspaceProvisioningService } from "../../../session/workspace-provisioning/workspace-provisioning-service.js";
import { PiSessionWatcher } from "./pi-session-watcher.js";

// These tests exercise duplicate-import races for the Pi session watcher's
// auto-import path (plan.md §"Session watcher and live tail" / T09B).
//
// The watcher's own bookkeeping (`handling` flag, `knownImportableHandles`)
// is a check-then-act guard that is only safe *within a single instance*.
// The real protection against a session being imported twice lives one
// layer down, in `importProviderSession`'s per-`agentManager` mutation
// mutex (see import-sessions.ts). These tests prove both layers hold under
// concurrent triggers, deterministically (no real timers, no real fs).

interface FakeStoredRecord {
  id: string;
  archivedAt: string | null;
  persistence: { provider: string; sessionId: string; nativeHandle?: string };
}

function makeLiveSession(
  providerHandleId: string,
  cwd = "/workspace/demo",
): ManagedImportableProviderSession {
  return {
    provider: "pi",
    providerHandleId,
    cwd,
    title: null,
    firstPromptPreview: null,
    lastPromptPreview: null,
    // Well within the default 5-minute live threshold so auto-import triggers.
    lastActivityAt: new Date(Date.now() - 1000),
  } as unknown as ManagedImportableProviderSession;
}

/**
 * Builds a shared backend that behaves like the real import pipeline closely
 * enough to exercise `importProviderSession`'s de-dupe mutex: `list()`
 * reflects committed records, and `importProviderSession()` commits a new
 * record synchronously (after any queued predecessor operation completes).
 */
function createSharedBackend(session: ManagedImportableProviderSession) {
  const records: FakeStoredRecord[] = [];
  let nextId = 0;

  const agentStorage = {
    list: async () => records.slice(),
  } as unknown as AgentStorage;

  const agentManager = {
    listImportableSessions: async () => [session],
    importProviderSession: async (input: { provider: string; providerHandleId: string }) => {
      const id = `agent-${++nextId}`;
      records.push({
        id,
        archivedAt: null,
        persistence: {
          provider: input.provider,
          sessionId: input.providerHandleId,
          nativeHandle: input.providerHandleId,
        },
      });
      return { id } as unknown;
    },
    unarchiveSnapshot: async () => true,
    notifyAgentState: () => {},
    archiveSnapshot: async () => {},
    closeAgent: async () => {},
    getAgent: () => null,
    getTimeline: () => [],
  } as unknown as AgentManager;

  const workspaceProvisioning: Pick<WorkspaceProvisioningService, "runInImportWorkspace"> = {
    runInImportWorkspace: async (_input, operation) => ({
      value: await operation({ workspaceId: "ws-1" } as never),
      createdWorkspace: null,
    }),
  };

  return { agentStorage, agentManager, workspaceProvisioning, records };
}

function newWatcher(
  agentManager: AgentManager,
  agentStorage: AgentStorage,
  workspaceProvisioning: Pick<WorkspaceProvisioningService, "runInImportWorkspace">,
): PiSessionWatcher {
  return new PiSessionWatcher({
    logger: pino({ level: "silent" }),
    agentManager,
    agentStorage,
    workspaceProvisioning,
  });
}

describe("PiSessionWatcher duplicate-import races", () => {
  test("the in-flight `handling` guard serializes overlapping triggers on one instance", async () => {
    const session = makeLiveSession("race-single-instance");
    const { agentManager, agentStorage, workspaceProvisioning, records } =
      createSharedBackend(session);
    const watcher = newWatcher(agentManager, agentStorage, workspaceProvisioning);

    // Fire two triggers back-to-back without awaiting the first, simulating
    // an fs-change event landing in the same tick as the poll backstop.
    // `handleChange` sets `handling = true` synchronously before its first
    // await, so the second call must observe the guard and return early.
    const first = (
      watcher as unknown as { handleChange(reason: string): Promise<void> }
    ).handleChange("fs");
    const second = (
      watcher as unknown as { handleChange(reason: string): Promise<void> }
    ).handleChange("poll");

    await Promise.all([first, second]);

    expect(records).toHaveLength(1);
    expect(records[0]?.persistence.sessionId).toBe("race-single-instance");
  });

  test("two watcher instances racing on the same session commit exactly one import", async () => {
    const session = makeLiveSession("race-two-instances");
    const { agentManager, agentStorage, workspaceProvisioning, records } =
      createSharedBackend(session);

    // Two independent PiSessionWatcher instances (e.g. a watcher restart
    // racing an in-flight import, or a duplicate watcher registration) each
    // have their own `knownImportableHandles` bookkeeping, so both treat the
    // session as newly discovered and both attempt to auto-import it.
    const watcherA = newWatcher(agentManager, agentStorage, workspaceProvisioning);
    const watcherB = newWatcher(agentManager, agentStorage, workspaceProvisioning);

    const runA = (
      watcherA as unknown as { handleChange(reason: string): Promise<void> }
    ).handleChange("fs");
    const runB = (
      watcherB as unknown as { handleChange(reason: string): Promise<void> }
    ).handleChange("fs");

    // Neither call should throw: the losing racer's "already imported"
    // rejection from importProviderSession is caught and logged inside
    // handleChange, not propagated to the caller.
    await expect(Promise.all([runA, runB])).resolves.toBeDefined();

    expect(records).toHaveLength(1);
    expect(records[0]?.persistence.sessionId).toBe("race-two-instances");
  });

  test("a session already known to one instance is not re-attempted by that instance", async () => {
    const session = makeLiveSession("race-known-handle");
    const { agentManager, agentStorage, workspaceProvisioning, records } =
      createSharedBackend(session);
    const watcher = newWatcher(agentManager, agentStorage, workspaceProvisioning);
    const handleChange = (
      watcher as unknown as { handleChange(reason: string): Promise<void> }
    ).handleChange.bind(watcher);

    await handleChange("initial");
    expect(records).toHaveLength(1);

    // The session is still returned by listImportableSessions (nothing archives
    // it in this fake), but it's no longer "new" to this instance, so a second
    // trigger must not attempt another import.
    await handleChange("fs");
    await handleChange("poll");

    expect(records).toHaveLength(1);
  });
});
