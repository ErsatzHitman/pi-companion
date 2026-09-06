/**
 * Tests for `session-list-network-sync.ts` (T32B5, plan.md §7.4 applied
 * to the session rail): proven against injected `NetworkStatus` values,
 * including a Wi-Fi -> cellular transition today's real adapter
 * (`../../platform/network-reachability.ts`) cannot itself produce (it
 * only ever reports `"unknown"`/`"none"` — see that module's doc
 * comment). Never a socket, never `react-native`.
 */
import type { NetworkStatus } from "@picompanion/frontend-core";
import { describe, expect, it, vi } from "vitest";

import { SessionListNetworkSync } from "./session-list-network-sync";
import type { SessionListState, SessionListWindow, SessionSummary } from "./sessions-model";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    title: "Fix the flaky test",
    provider: "pi",
    cwd: "/home/pi/project",
    status: "idle",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Deferred promise so a test can control exactly when `refreshSessions()` settles, to prove generation fencing. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const WIFI: NetworkStatus = { online: true, kind: "wifi" };
const CELLULAR: NetworkStatus = { online: true, kind: "cellular" };
const OFFLINE: NetworkStatus = { online: false, kind: "none" };

describe("SessionListNetworkSync: the active connection path is visible (T32B5)", () => {
  it("records connectionPath on the very first observation, with no resync capability wired", async () => {
    let state: SessionListState = { kind: "ready", sessions: [session()] };
    const sync = new SessionListNetworkSync({
      refreshSessions: vi.fn(async () => ({ sessions: [], complete: true })),
      getState: () => state,
      onStateChange: (next) => {
        state = next;
      },
    });

    sync.handleNetworkStatus(WIFI);
    await settle();

    expect(state.kind).toBe("ready");
    expect((state as { connectionPath?: string }).connectionPath).toBe("wifi");
  });

  it("records the path even while offline, alongside marking the list stale", () => {
    let state: SessionListState = { kind: "ready", sessions: [session()] };
    const sync = new SessionListNetworkSync({
      refreshSessions: vi.fn(async () => ({ sessions: [], complete: true })),
      getState: () => state,
      onStateChange: (next) => {
        state = next;
      },
    });

    sync.handleNetworkStatus(OFFLINE);

    expect(state).toMatchObject({ kind: "ready", stale: true, connectionPath: "none" });
  });
});

describe("SessionListNetworkSync: the list survives a Wi-Fi to cellular switch (T32B5)", () => {
  it("triggers a resync on a kind change while staying online, and merges the result without clearing the list first", async () => {
    let state: SessionListState = { kind: "ready", sessions: [session({ id: "a" })] };
    const window: SessionListWindow = {
      sessions: [session({ id: "a", status: "running" }), session({ id: "b" })],
      complete: true,
    };
    const refreshSessions = vi.fn(async () => window);
    const sync = new SessionListNetworkSync({
      refreshSessions,
      getState: () => state,
      onStateChange: (next) => {
        state = next;
      },
    });

    sync.handleNetworkStatus(WIFI);
    await settle();
    expect(refreshSessions).toHaveBeenCalledTimes(0); // first observation only records the path, nothing to resync from

    // The list is never dropped to "loading" or cleared mid-switch --
    // every intermediate read of `state` still has the last-known rows.
    sync.handleNetworkStatus(CELLULAR);
    expect(state.kind).toBe("ready"); // still ready synchronously, before the resync resolves
    await settle();

    expect(refreshSessions).toHaveBeenCalledTimes(1);
    expect(state).toEqual({
      kind: "ready",
      sessions: [session({ id: "a", status: "running" }), session({ id: "b" })],
      stale: false,
      connectionPath: "cellular",
    });
  });

  it("also resyncs on a plain offline -> online transition (no kind change)", async () => {
    let state: SessionListState = { kind: "ready", sessions: [session({ id: "a" })], stale: true };
    const refreshSessions = vi.fn(async () => ({
      sessions: [session({ id: "a", status: "running" })],
      complete: true,
    }));
    const sync = new SessionListNetworkSync({
      refreshSessions,
      getState: () => state,
      onStateChange: (next) => {
        state = next;
      },
    });

    sync.handleNetworkStatus(OFFLINE);
    expect(state).toMatchObject({ stale: true });

    sync.handleNetworkStatus(WIFI);
    await settle();

    expect(refreshSessions).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ stale: false, connectionPath: "wifi" });
  });

  it("does not resync for a repeated observation of the same online kind", async () => {
    let state: SessionListState = { kind: "ready", sessions: [session()] };
    const refreshSessions = vi.fn(async () => ({ sessions: [], complete: true }));
    const sync = new SessionListNetworkSync({
      refreshSessions,
      getState: () => state,
      onStateChange: (next) => {
        state = next;
      },
    });

    sync.handleNetworkStatus(WIFI);
    await settle();
    sync.handleNetworkStatus({ online: true, kind: "wifi" });
    await settle();

    expect(refreshSessions).toHaveBeenCalledTimes(0);
  });
});

describe("SessionListNetworkSync: no duplicate or dropped rows after gap recovery (T32B5)", () => {
  it("a slow resync from an abandoned path switch never resolves after a newer one and clobbers it (generation fencing)", async () => {
    let state: SessionListState = { kind: "ready", sessions: [session({ id: "a" })] };
    const first = deferred<SessionListWindow>();
    const second = deferred<SessionListWindow>();
    let callCount = 0;
    const refreshSessions = vi.fn(() => {
      callCount += 1;
      return callCount === 1 ? first.promise : second.promise;
    });
    const sync = new SessionListNetworkSync({
      refreshSessions,
      getState: () => state,
      onStateChange: (next) => {
        state = next;
      },
    });

    sync.handleNetworkStatus(WIFI); // baseline observation, no resync yet
    await settle();

    sync.handleNetworkStatus(CELLULAR); // triggers the first (slow) resync
    sync.handleNetworkStatus(WIFI); // path flaps back before the first resync settles -- triggers a second resync
    await settle();

    expect(refreshSessions).toHaveBeenCalledTimes(2);
    expect(sync.isResyncing()).toBe(true);

    // The second (newer) resync settles first with the true current list...
    second.resolve({ sessions: [session({ id: "a" }), session({ id: "b" })], complete: true });
    await settle();
    expect(state).toMatchObject({ sessions: [session({ id: "a" }), session({ id: "b" })] });
    expect(sync.isResyncing()).toBe(false);

    // ...and the abandoned first resync resolving late must be discarded, not applied on top.
    first.resolve({ sessions: [session({ id: "a", status: "error" })], complete: true });
    await settle();
    expect(state).toMatchObject({ sessions: [session({ id: "a" }), session({ id: "b" })] });
  });

  it("an overlapping replay across two resyncs never duplicates a row", async () => {
    let state: SessionListState = { kind: "ready", sessions: [] };
    let call = 0;
    const refreshSessions = vi.fn(async (): Promise<SessionListWindow> => {
      call += 1;
      return call === 1
        ? { sessions: [session({ id: "s1" }), session({ id: "s2" })], complete: false }
        : { sessions: [session({ id: "s2" }), session({ id: "s3" })], complete: false };
    });
    const sync = new SessionListNetworkSync({
      refreshSessions,
      getState: () => state,
      onStateChange: (next) => {
        state = next;
      },
    });

    sync.handleNetworkStatus(WIFI); // baseline, no resync (nothing prior to compare against)
    await settle();
    sync.handleNetworkStatus(CELLULAR); // resync #1: page1
    await settle();
    sync.handleNetworkStatus(WIFI); // path flaps back: resync #2: page2, overlapping page1 at s2
    await settle();

    expect(refreshSessions).toHaveBeenCalledTimes(2);
    const ids = state.kind === "ready" ? state.sessions.map((s) => s.id) : [];
    expect(ids).toEqual(["s1", "s2", "s3"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a partial resync window never silently drops rows outside its coverage (gapped replay)", async () => {
    let state: SessionListState = {
      kind: "ready",
      sessions: [session({ id: "a" }), session({ id: "b" }), session({ id: "c" })],
    };
    const refreshSessions = vi.fn(
      async (): Promise<SessionListWindow> => ({
        // Only "c" confirmed before the path flapped again -- "a"/"b" are a gap, not a deletion.
        sessions: [session({ id: "c", status: "running" })],
        complete: false,
      }),
    );
    const sync = new SessionListNetworkSync({
      refreshSessions,
      getState: () => state,
      onStateChange: (next) => {
        state = next;
      },
    });

    sync.handleNetworkStatus(WIFI);
    await settle();
    sync.handleNetworkStatus(CELLULAR);
    await settle();

    expect(state.kind === "ready" && state.sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("a refresh failure surfaces via onRefreshFailed and leaves the list as-is", async () => {
    let state: SessionListState = { kind: "ready", sessions: [session({ id: "a" })] };
    const onRefreshFailed = vi.fn();
    const sync = new SessionListNetworkSync({
      refreshSessions: vi.fn(async () => {
        throw new Error("daemon unreachable");
      }),
      getState: () => state,
      onStateChange: (next) => {
        state = next;
      },
      onRefreshFailed,
    });

    sync.handleNetworkStatus(WIFI);
    await settle();
    sync.handleNetworkStatus(CELLULAR);
    await settle();

    expect(onRefreshFailed).toHaveBeenCalledWith("daemon unreachable");
    expect(state).toMatchObject({ sessions: [session({ id: "a" })] });
    expect(sync.isResyncing()).toBe(false);
  });
});
