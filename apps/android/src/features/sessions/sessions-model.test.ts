import type { KeyValueStorage } from "@picompanion/frontend-core";
import { timeline as coreTimeline } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import {
  EMPTY_CREATE_SESSION_DRAFT,
  EMPTY_CREATE_SESSION_STATE,
  IDLE_SESSION_ACTIONS_STATE,
  IDLE_SESSION_OPEN_STATE,
  LAST_OPENED_SESSION_STORAGE_KEY,
  applySessionListWindow,
  applySessionOpenReconcile,
  archiveSessionAndReconcile,
  beginConfirmedDeleteSession,
  beginCreateSession,
  beginSessionOpen,
  buildSessionRowModel,
  buildSessionsScreenModel,
  categorizeSession,
  clearLastOpenedSessionId,
  completeSessionOpen,
  confirmDeleteSessionAndReconcile,
  dismissDeleteRequest,
  explainSessionOpenError,
  failSessionOpen,
  groupSessionRows,
  markCreateSessionFailed,
  markCreateSessionSucceeded,
  markSessionListStale,
  mergeSessionListWindow,
  openAndLoadSession,
  readLastOpenedSessionId,
  reconcileSessionInList,
  removeSessionFromList,
  requestDeleteSession,
  sessionAgeLabel,
  sessionListConnectionPathLabel,
  sessionRowAccessibilityLabelWithAge,
  sessionRowMetaWithAge,
  sessionStatusPresentation,
  setSessionListConnectionPath,
  writeLastOpenedSessionId,
  type CreateSessionDraft,
  type CreateSessionRequest,
  type CreateSessionState,
  type OutboxQueueReader,
  type SessionActionsState,
  type SessionListState,
  type SessionListWindow,
  type SessionOpenDeps,
  type SessionOpenResult,
  type SessionOpenState,
  type SessionService,
  type SessionStatus,
  type SessionSummary,
} from "./sessions-model";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    title: "Fix the flaky test",
    provider: "anthropic",
    cwd: "/home/pi/project",
    status: "idle",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const ALL_STATUSES: readonly SessionStatus[] = [
  "initializing",
  "idle",
  "running",
  "error",
  "closed",
];

describe("sessionStatusPresentation", () => {
  it("gives every status distinct, non-empty visible text (T32B1: status in text as well as colour)", () => {
    const texts = ALL_STATUSES.map((status) => sessionStatusPresentation(session({ status }))).map(
      (presentation) => presentation.text,
    );

    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
    }
    expect(new Set(texts).size).toBe(ALL_STATUSES.length);
  });

  it("never returns an empty tone", () => {
    for (const status of ALL_STATUSES) {
      expect(sessionStatusPresentation(session({ status })).tone).toBeTruthy();
    }
  });

  it("overrides the tone to warning and draws A1's short 'Needs you' word, keeping the full sentence for TalkBack when requiresAttention is set", () => {
    const presentation = sessionStatusPresentation(
      session({ status: "running", requiresAttention: true }),
    );
    expect(presentation.tone).toBe("warning");
    // A1's `.pill.wait` word, drawn instead of "Running · needs attention" (T385).
    expect(presentation.text).toBe("Needs you");
    // The spoken sentence still names the underlying status, so nothing
    // is lost for a reader who cannot see the pill's short word.
    expect(presentation.accessibilityText).toContain("needs attention");
    expect(presentation.accessibilityText).toContain("Working");
  });

  it("does not apply the attention override when requiresAttention is false or absent", () => {
    // A1's `.pill.run` word is "Working", not "Running" (T385).
    expect(sessionStatusPresentation(session({ status: "running" })).text).toBe("Working");
    expect(
      sessionStatusPresentation(session({ status: "running", requiresAttention: false })).text,
    ).toBe("Working");
  });
});

describe("categorizeSession", () => {
  it("puts an archived session in 'archived' regardless of its live status", () => {
    expect(
      categorizeSession(session({ status: "running", archivedAt: "2026-09-01T00:00:00.000Z" })),
    ).toBe("archived");
    expect(
      categorizeSession(
        session({
          status: "error",
          requiresAttention: true,
          archivedAt: "2026-09-01T00:00:00.000Z",
        }),
      ),
    ).toBe("archived");
  });

  it("puts an error or attention-needing session in 'needs-attention'", () => {
    expect(categorizeSession(session({ status: "error" }))).toBe("needs-attention");
    expect(categorizeSession(session({ status: "idle", requiresAttention: true }))).toBe(
      "needs-attention",
    );
  });

  it("puts running/initializing sessions in 'active'", () => {
    expect(categorizeSession(session({ status: "running" }))).toBe("active");
    expect(categorizeSession(session({ status: "initializing" }))).toBe("active");
  });

  it("falls back to 'idle' for idle/closed sessions with no attention flag", () => {
    expect(categorizeSession(session({ status: "idle" }))).toBe("idle");
    expect(categorizeSession(session({ status: "closed" }))).toBe("idle");
  });
});

describe("buildSessionRowModel", () => {
  it("falls back to 'Untitled session' when title is null", () => {
    expect(buildSessionRowModel(session({ title: null })).title).toBe("Untitled session");
  });

  it("builds a combined accessibility label naming title, status text, and meta", () => {
    const row = buildSessionRowModel(
      session({
        title: "Fix the flaky test",
        provider: "anthropic",
        cwd: "/home/pi/project",
        status: "running",
      }),
    );
    expect(row.accessibilityLabel).toContain("Fix the flaky test");
    expect(row.accessibilityLabel).toContain("Working");
    expect(row.accessibilityLabel).toContain("anthropic");
    expect(row.accessibilityLabel).toContain("/home/pi/project");
  });
});

describe("groupSessionRows", () => {
  it("drops empty groups and orders needs-attention, active, idle, archived", () => {
    const groups = groupSessionRows([
      session({ id: "a", status: "idle" }),
      session({ id: "b", status: "error" }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["needs-attention", "idle"]);
  });

  it("returns no groups for an empty session list", () => {
    expect(groupSessionRows([])).toEqual([]);
  });

  it("sorts rows within a group most-recently-updated first", () => {
    const groups = groupSessionRows([
      session({ id: "old", status: "idle", updatedAt: "2026-01-01T00:00:00.000Z" }),
      session({ id: "new", status: "idle", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("buildSessionsScreenModel", () => {
  it("maps 'loading' state to a loading model", () => {
    expect(buildSessionsScreenModel({ kind: "loading" }).kind).toBe("loading");
  });

  it("maps 'error' state to an error model carrying the message", () => {
    const model = buildSessionsScreenModel({ kind: "error", message: "Host unreachable" });
    expect(model.kind).toBe("error");
    expect(model.kind === "error" && model.description).toBe("Host unreachable");
  });

  it("maps a ready state with zero sessions to 'empty', not 'ready'", () => {
    expect(buildSessionsScreenModel({ kind: "ready", sessions: [] }).kind).toBe("empty");
  });

  it("maps a ready state with sessions to 'ready' with grouped rows", () => {
    const model = buildSessionsScreenModel({
      kind: "ready",
      sessions: [session({ id: "x", status: "running" })],
    });
    expect(model.kind).toBe("ready");
    expect(model.kind === "ready" && model.groups[0].rows[0].id).toBe("x");
  });
});

describe("SessionListState's ready branch carries stale (T32B2, cross-referenced from T37B)", () => {
  it("accepts an explicit stale:true ready state and still builds a normal ready screen model from it", () => {
    const state: SessionListState = { kind: "ready", sessions: [session()], stale: true };
    expect(state.stale).toBe(true);
    expect(buildSessionsScreenModel(state).kind).toBe("ready");
  });

  it("accepts an explicit stale:false ready state", () => {
    const state: SessionListState = { kind: "ready", sessions: [session()], stale: false };
    expect(state.stale).toBe(false);
  });

  it("defaults to no stale flag when omitted, matching a live fetch", () => {
    const state: SessionListState = { kind: "ready", sessions: [session()] };
    expect(state.stale).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// T32B2: session creation and opening.
// -----------------------------------------------------------------------

function draft(overrides: Partial<CreateSessionDraft> = {}): CreateSessionDraft {
  return { provider: "pi", cwd: "/home/pi/project", ...overrides };
}

function createState(overrides: Partial<CreateSessionState> = {}): CreateSessionState {
  return { ...EMPTY_CREATE_SESSION_STATE, ...overrides };
}

/** In-memory fake `SessionService` (T32B2's injected seam) — never a socket, never a `DaemonClient`. */
function fakeSessionService(overrides: Partial<SessionService> = {}): SessionService {
  return {
    createSession:
      overrides.createSession ??
      (async (request: CreateSessionRequest) =>
        session({ id: "fake-created", provider: request.provider, cwd: request.cwd })),
    openSession:
      overrides.openSession ??
      (async (sessionId: string) => ({
        session: session({ id: sessionId }),
        timeline: coreTimeline.createEmptyTimelineState(),
      })),
    archiveSession:
      overrides.archiveSession ??
      (async (sessionId: string) =>
        session({ id: sessionId, archivedAt: "2026-09-03T00:00:00.000Z" })),
    deleteSession: overrides.deleteSession ?? (async () => undefined),
    refreshSessions: overrides.refreshSessions ?? (async () => ({ sessions: [], complete: true })),
  };
}

describe("create-session draft validation", () => {
  it("rejects a blank cwd and a blank provider, each with its own message", () => {
    const validation = beginCreateSession(
      createState({ draft: draft({ cwd: "  ", provider: "" }) }),
    );
    expect(validation.ok).toBe(false);
    expect(validation.state.errors.cwd).toBeTruthy();
    expect(validation.state.errors.provider).toBeTruthy();
  });

  it("accepts a trimmed non-blank draft and moves the state to 'submitting'", () => {
    const result = beginCreateSession(createState({ draft: draft() }));
    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("submitting");
    expect(result.state.errors).toEqual({});
  });
});

describe("create + open round-trip against an injected fake SessionService, no socket and no emulator (T32B2)", () => {
  it("creates a session end-to-end: begin -> service resolves -> state clears back to idle", async () => {
    const typed = draft({ cwd: "/home/pi/new-project", provider: "pi" });
    const created = session({ id: "created-1", cwd: typed.cwd, provider: typed.provider });
    const service = fakeSessionService({
      createSession: async (request) => {
        expect(request).toEqual(typed);
        return created;
      },
    });

    const begin = beginCreateSession(createState({ draft: typed }));
    expect(begin.ok).toBe(true);
    expect(begin.state.phase).toBe("submitting");

    const result = await service.createSession(begin.state.draft);
    expect(result).toBe(created);

    const finalState = markCreateSessionSucceeded();
    expect(finalState).toEqual(EMPTY_CREATE_SESSION_STATE);
    expect(finalState.draft).toEqual(EMPTY_CREATE_SESSION_DRAFT);
  });

  it("opens a session end-to-end: idle -> loading -> ready, carrying the service's session and timeline", async () => {
    const opened = session({ id: "s9", title: "Reopened" });
    const timeline = coreTimeline.createEmptyTimelineState();
    const service = fakeSessionService({
      openSession: async (sessionId) => {
        expect(sessionId).toBe("s9");
        const result: SessionOpenResult = { session: opened, timeline };
        return result;
      },
    });

    const loading = beginSessionOpen("s9");
    expect(loading).toEqual({ status: "loading", sessionId: "s9" });

    const result = await service.openSession("s9");
    const ready = completeSessionOpen("s9", result);
    expect(ready).toEqual({ status: "ready", sessionId: "s9", session: opened, timeline });
  });
});

describe("a failed create keeps typed input (T32B2's most-load-bearing criterion)", () => {
  it("leaves cwd and provider exactly as typed after a rejected createSession, and surfaces the raw error", async () => {
    const typed = draft({ provider: "anthropic", cwd: "/home/pi/broken" });
    const begin = beginCreateSession(createState({ draft: typed }));
    expect(begin.ok).toBe(true);

    const service = fakeSessionService({
      createSession: async () => {
        throw new Error("cwd does not exist on host");
      },
    });

    let state = begin.state;
    try {
      await service.createSession(state.draft);
      expect.unreachable("expected createSession to reject");
    } catch (error) {
      state = markCreateSessionFailed(
        state,
        error instanceof Error ? error.message : String(error),
      );
    }

    expect(state.phase).toBe("error");
    expect(state.errorMessage).toBe("cwd does not exist on host");
    expect(state.draft).toEqual(typed);
  });

  it("keeps the draft when client-side validation rejects the submit before the service is ever called", () => {
    const typed = draft({ cwd: "" });
    let called = false;
    const service = fakeSessionService({
      createSession: async () => {
        called = true;
        return session();
      },
    });

    const begin = beginCreateSession(createState({ draft: typed }));
    expect(begin.ok).toBe(false);
    expect(begin.state.draft).toEqual(typed);
    expect(called).toBe(false);
    void service; // never invoked — asserted via `called` above.
  });

  it("a retry after a failed create resubmits the identical typed text, not a cleared draft", async () => {
    const typed = draft({ cwd: "/home/pi/retry-me" });
    let state = beginCreateSession(createState({ draft: typed })).state;

    let attempt = 0;
    const service = fakeSessionService({
      createSession: async (request) => {
        attempt += 1;
        if (attempt === 1) throw new Error("host unreachable");
        return session({ id: "ok", cwd: request.cwd, provider: request.provider });
      },
    });

    try {
      await service.createSession(state.draft);
    } catch (error) {
      state = markCreateSessionFailed(
        state,
        error instanceof Error ? error.message : String(error),
      );
    }
    expect(state.draft).toEqual(typed);

    const retry = beginCreateSession(state);
    expect(retry.ok).toBe(true);
    expect(retry.state.draft).toEqual(typed); // same text, no re-typing required
    const created = await service.createSession(retry.state.draft);
    expect(created.cwd).toBe(typed.cwd);
    expect(attempt).toBe(2);
  });
});

describe("opening a session loads its timeline, and a failure is a distinct named error (T32B2)", () => {
  it("never skips 'loading': begin always produces status 'loading' for the requested id first", () => {
    const state = beginSessionOpen("s7");
    expect(state.status).toBe("loading");
    expect(state.sessionId).toBe("s7");
  });

  it("a rejected openSession produces a distinct 'error' state, never a 'ready' state with an empty timeline", async () => {
    const service = fakeSessionService({
      openSession: async () => {
        throw new Error("Agent not found: missing-1");
      },
    });

    let state: SessionOpenState = beginSessionOpen("missing-1");
    try {
      const result = await service.openSession("missing-1");
      state = completeSessionOpen("missing-1", result);
    } catch (error) {
      state = failSessionOpen("missing-1", error instanceof Error ? error.message : String(error));
    }

    expect(state).toEqual({
      status: "error",
      sessionId: "missing-1",
      message: "Agent not found: missing-1",
    });
    // Structurally distinct from "ready": neither field exists on the error branch.
    expect("session" in state).toBe(false);
    expect("timeline" in state).toBe(false);
  });

  it("IDLE_SESSION_OPEN_STATE starts with no sessionId and is not confusable with a ready or error state", () => {
    expect(IDLE_SESSION_OPEN_STATE).toEqual({ status: "idle", sessionId: null });
  });
});

// -----------------------------------------------------------------------
// T32B3: last-opened-session persistence, cold-start restore, and
// resume-reconcile — plan.md §7.4.
// -----------------------------------------------------------------------

/** In-memory `KeyValueStorage` fake — never AsyncStorage/SQLite, matching this module's "no client yet" seam. */
function fakeKeyValueStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    async getItem(key) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
    async keys(prefix) {
      return [...store.keys()].filter((key) => !prefix || key.startsWith(prefix));
    },
  };
}

function fakeOutboxReader(
  bySessionId: Record<string, readonly { id: string }[]> = {},
): OutboxQueueReader {
  return {
    async loadAll(sessionId) {
      return (bySessionId[sessionId] ?? []) as never;
    },
  };
}

describe("last-opened-session persistence (T32B3)", () => {
  it("reads null before anything has ever been written", async () => {
    const storage = fakeKeyValueStorage();
    expect(await readLastOpenedSessionId(storage)).toBeNull();
  });

  it("round-trips a written id under the documented storage key", async () => {
    const storage = fakeKeyValueStorage();
    await writeLastOpenedSessionId(storage, "s42");
    expect(await storage.getItem(LAST_OPENED_SESSION_STORAGE_KEY)).toBe("s42");
    expect(await readLastOpenedSessionId(storage)).toBe("s42");
  });

  it("clearing removes it, so a later read is null again", async () => {
    const storage = fakeKeyValueStorage({ [LAST_OPENED_SESSION_STORAGE_KEY]: "s42" });
    await clearLastOpenedSessionId(storage);
    expect(await readLastOpenedSessionId(storage)).toBeNull();
  });
});

describe("explainSessionOpenError classifies a missing session distinctly from any other failure (T32B3)", () => {
  it("classifies the reference backend's 'Agent not found: <id>' as missing", () => {
    const explanation = explainSessionOpenError("Agent not found: ghost-1");
    expect(explanation.missing).toBe(true);
    expect(explanation.title).toBe("This session doesn't exist");
  });

  it("classifies an ENOENT-shaped message as missing too", () => {
    expect(explainSessionOpenError("ENOENT: no such session").missing).toBe(true);
  });

  it("classifies an unrelated failure (e.g. a network error) as not missing, with a distinct message", () => {
    const explanation = explainSessionOpenError("Network request failed");
    expect(explanation.missing).toBe(false);
    expect(explanation.title).toBe("Couldn't open this session");
    expect(explanation.description).toBe("Network request failed");
  });

  it("never confuses the two: a missing-session and a generic failure get different titles", () => {
    const missing = explainSessionOpenError("Agent not found: x");
    const generic = explainSessionOpenError("socket hang up");
    expect(missing.title).not.toBe(generic.title);
  });
});

describe("openAndLoadSession: cold start restores the last opened session, including its queue (T32B3)", () => {
  it("resolves 'ready' carrying the service's session/timeline plus the outbox's queue, and persists the id", async () => {
    const opened = session({ id: "s9", title: "Reopened" });
    const timeline = coreTimeline.createEmptyTimelineState();
    const service = fakeSessionService({
      openSession: async () => ({ session: opened, timeline }),
    });
    const storage = fakeKeyValueStorage();
    const outbox = fakeOutboxReader({ s9: [{ id: "queued-1" }] });
    const deps: SessionOpenDeps = { sessionService: service, storage, outbox };

    const result = await openAndLoadSession("s9", deps, { stale: true });

    expect(result).toEqual({
      status: "ready",
      sessionId: "s9",
      session: opened,
      timeline,
      stale: true,
      queue: [{ id: "queued-1" }],
    });
    expect(await readLastOpenedSessionId(storage)).toBe("s9");
  });

  it("defaults queue to absent (not an empty array) when no OutboxQueueReader is supplied", async () => {
    const service = fakeSessionService();
    const result = await openAndLoadSession("s9", { sessionService: service });
    expect(result.status).toBe("ready");
    expect("queue" in result).toBe(false);
  });

  it("a stale restore that reconciles cleanly is marked stale: false by applySessionOpenReconcile, and only for the matching session", async () => {
    const service = fakeSessionService();
    const restored = await openAndLoadSession("s9", { sessionService: service }, { stale: true });
    expect(restored.status).toBe("ready");
    expect((restored as { stale?: boolean }).stale).toBe(true);

    const reconciled = applySessionOpenReconcile(restored, "s9", await service.openSession("s9"));
    expect(reconciled.status).toBe("ready");
    expect((reconciled as { stale?: boolean }).stale).toBe(false);

    // A reconcile that lands for a *different* session (the user switched
    // away) must not touch the state it wasn't fetched for.
    const untouched = applySessionOpenReconcile(restored, "some-other-session", {
      session: session({ id: "some-other-session" }),
      timeline: coreTimeline.createEmptyTimelineState(),
    });
    expect(untouched).toBe(restored);

    // Nor may a reconcile resurrect a session the user has since closed.
    expect(applySessionOpenReconcile(IDLE_SESSION_OPEN_STATE, "s9", restored as never)).toBe(
      IDLE_SESSION_OPEN_STATE,
    );
  });
});

describe("openAndLoadSession: a missing session fails with a clear, distinct message and clears the stored id (T32B3)", () => {
  it("produces the standard 'error' shape (never a placeholder 'ready') and clears storage on a missing session", async () => {
    const service = fakeSessionService({
      openSession: async () => {
        throw new Error("Agent not found: ghost-1");
      },
    });
    const storage = fakeKeyValueStorage({ [LAST_OPENED_SESSION_STORAGE_KEY]: "ghost-1" });

    const result = await openAndLoadSession("ghost-1", { sessionService: service, storage });

    expect(result).toEqual({
      status: "error",
      sessionId: "ghost-1",
      message: "Agent not found: ghost-1",
    });
    expect(explainSessionOpenError(result.status === "error" ? result.message : "").missing).toBe(
      true,
    );
    // The stored id is gone: a later cold start won't keep retrying a session that's gone.
    expect(await readLastOpenedSessionId(storage)).toBeNull();
  });

  it("leaves the stored id in place for a non-missing failure (e.g. a transient network error), so the next attempt can retry", async () => {
    const service = fakeSessionService({
      openSession: async () => {
        throw new Error("Network request failed");
      },
    });
    const storage = fakeKeyValueStorage({ [LAST_OPENED_SESSION_STORAGE_KEY]: "s9" });

    const result = await openAndLoadSession("s9", { sessionService: service, storage });

    expect(result.status).toBe("error");
    expect(await readLastOpenedSessionId(storage)).toBe("s9");
  });
});

// -----------------------------------------------------------------------
// T32B4: session archive and delete.
// -----------------------------------------------------------------------

function actionsState(overrides: Partial<SessionActionsState> = {}): SessionActionsState {
  return { ...IDLE_SESSION_ACTIONS_STATE, ...overrides };
}

function readyList(sessions: readonly SessionSummary[]): SessionListState {
  return { kind: "ready", sessions };
}

describe("reconcileSessionInList / removeSessionFromList", () => {
  it("replaces a row with exactly the summary the daemon reported, leaving other rows untouched", () => {
    const before = readyList([session({ id: "a" }), session({ id: "b" })]);
    const updated = session({ id: "a", archivedAt: "2026-09-03T00:00:00.000Z" });

    const after = reconcileSessionInList(before, updated);

    expect(after).toEqual(readyList([updated, session({ id: "b" })]));
  });

  it("is a no-op on a non-ready list state", () => {
    const loading: SessionListState = { kind: "loading" };
    expect(reconcileSessionInList(loading, session({ id: "a" }))).toBe(loading);
    expect(removeSessionFromList(loading, "a")).toBe(loading);
  });

  it("removes exactly the named row", () => {
    const before = readyList([session({ id: "a" }), session({ id: "b" })]);
    expect(removeSessionFromList(before, "a")).toEqual(readyList([session({ id: "b" })]));
  });
});

// -----------------------------------------------------------------------
// T32B5: surviving Wi-Fi/cellular/relay network path switches.
// -----------------------------------------------------------------------

function sessionWindow(sessions: readonly SessionSummary[], complete: boolean): SessionListWindow {
  return { sessions, complete };
}

describe("mergeSessionListWindow: idempotent gap recovery (T32B5)", () => {
  it("keeps a row known on both sides exactly once, taking the fetched window's field values", () => {
    const current = [session({ id: "s1", status: "idle", title: "Old title" })];
    const fetched = sessionWindow(
      [session({ id: "s1", status: "running", title: "New title" })],
      true,
    );

    const merged = mergeSessionListWindow(current, fetched);

    expect(merged).toEqual([session({ id: "s1", status: "running", title: "New title" })]);
  });

  it("a complete window drops a row the daemon no longer reports (real deletion, not a gap)", () => {
    const current = [session({ id: "a" }), session({ id: "b" })];
    const merged = mergeSessionListWindow(current, sessionWindow([session({ id: "a" })], true));
    expect(merged.map((s) => s.id)).toEqual(["a"]);
  });

  it("a partial window preserves a row it doesn't cover, instead of silently dropping the gap", () => {
    const current = [session({ id: "a" }), session({ id: "b" }), session({ id: "c" })];
    // Only "c" was confirmed by this (partial, complete:false) resync —
    // "a" and "b" are outside its coverage, not confirmed gone.
    const merged = mergeSessionListWindow(
      current,
      sessionWindow([session({ id: "c", status: "running" })], false),
    );
    expect(merged.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(merged.find((s) => s.id === "c")?.status).toBe("running");
  });

  it("applying an overlapping window twice never duplicates a row (deliberately overlapping replay)", () => {
    const page1 = sessionWindow([session({ id: "s1" }), session({ id: "s2" })], false);
    // A second, overlapping window: repeats s2, adds s3 -- simulates a
    // reconnect replaying a window whose edges overlap the last one.
    const page2 = sessionWindow([session({ id: "s2" }), session({ id: "s3" })], false);

    const afterPage1 = mergeSessionListWindow([], page1);
    const afterPage2 = mergeSessionListWindow(afterPage1, page2);

    const ids = afterPage2.map((s) => s.id);
    expect(ids).toEqual(["s1", "s2", "s3"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a gapped window (starts after the last known cursor) never drops the rows before it (deliberately gapped replay)", () => {
    const initial = mergeSessionListWindow(
      [],
      sessionWindow([session({ id: "s1" }), session({ id: "s2" }), session({ id: "s3" })], true),
    );
    // The reconnect only managed a narrow, partial window covering just
    // s3 onward before the path flapped again -- s1/s2 are a "gap" this
    // window starts after, not a report that they're gone.
    const afterGap = mergeSessionListWindow(
      initial,
      sessionWindow([session({ id: "s3", status: "running" }), session({ id: "s4" })], false),
    );

    expect(afterGap.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(afterGap.find((s) => s.id === "s3")?.status).toBe("running");
  });

  it("applying the exact same window twice in a row is a no-op (idempotent reconnect retry)", () => {
    const fetched = sessionWindow([session({ id: "s1" }), session({ id: "s2" })], true);
    const once = mergeSessionListWindow([], fetched);
    const twice = mergeSessionListWindow(once, fetched);
    expect(twice).toEqual(once);
  });

  it("collapses a duplicate id within a single window to its last occurrence", () => {
    const fetched = sessionWindow(
      [session({ id: "s1", status: "idle" }), session({ id: "s1", status: "running" })],
      true,
    );
    const merged = mergeSessionListWindow([], fetched);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe("running");
  });
});

describe("applySessionListWindow / markSessionListStale / connection path (T32B5)", () => {
  it("turns a loading/error state into ready on the first successful resync", () => {
    const loading: SessionListState = { kind: "loading" };
    const after = applySessionListWindow(loading, sessionWindow([session({ id: "a" })], true));
    expect(after).toEqual({ kind: "ready", sessions: [session({ id: "a" })], stale: false });
  });

  it("preserves connectionPath across a resync that merges the list", () => {
    const before: SessionListState = {
      kind: "ready",
      sessions: [session({ id: "a" })],
      connectionPath: "cellular",
    };
    const after = applySessionListWindow(
      before,
      sessionWindow([session({ id: "a", status: "running" })], true),
    );
    expect(after).toEqual({
      kind: "ready",
      sessions: [session({ id: "a", status: "running" })],
      stale: false,
      connectionPath: "cellular",
    });
  });

  it("markSessionListStale sets stale:true without touching sessions, and is a no-op off the ready branch", () => {
    const ready = readyList([session({ id: "a" })]);
    expect(markSessionListStale(ready)).toEqual({ ...ready, stale: true });

    const loading: SessionListState = { kind: "loading" };
    expect(markSessionListStale(loading)).toBe(loading);
  });

  it("setSessionListConnectionPath records the kind, and is a no-op off the ready branch", () => {
    const ready = readyList([session({ id: "a" })]);
    expect(setSessionListConnectionPath(ready, "wifi")).toEqual({
      ...ready,
      connectionPath: "wifi",
    });
    expect(setSessionListConnectionPath(ready, "cellular")).toEqual({
      ...ready,
      connectionPath: "cellular",
    });

    const error: SessionListState = { kind: "error", message: "boom" };
    expect(setSessionListConnectionPath(error, "wifi")).toBe(error);
  });

  it("sessionListConnectionPathLabel renders 'Unknown' honestly rather than guessing 'wifi'", () => {
    expect(sessionListConnectionPathLabel(undefined)).toBe("Unknown");
    expect(sessionListConnectionPathLabel("unknown")).toBe("Unknown");
    expect(sessionListConnectionPathLabel("wifi")).toBe("Wi-Fi");
    expect(sessionListConnectionPathLabel("cellular")).toBe("Cellular");
    expect(sessionListConnectionPathLabel("ethernet")).toBe("Ethernet");
    expect(sessionListConnectionPathLabel("none")).toBe("Offline");
  });
});

describe("archive + delete round-trip against an injected fake SessionService, no socket and no emulator (T32B4)", () => {
  it("archiveSessionAndReconcile applies the daemon-reported summary to the list and clears the pending marker", async () => {
    const archived = session({ id: "s1", archivedAt: "2026-09-03T00:00:00.000Z" });
    const service = fakeSessionService({ archiveSession: async () => archived });
    const list = readyList([session({ id: "s1" }), session({ id: "s2" })]);

    const result = await archiveSessionAndReconcile(
      session({ id: "s1" }),
      list,
      actionsState(),
      service,
    );

    expect(result.list).toEqual(readyList([archived, session({ id: "s2" })]));
    expect(result.actions).toEqual(actionsState());
    // The archived row now categorizes into the "Archived" group.
    expect(categorizeSession(archived)).toBe("archived");
  });

  it("a rejected archive leaves the list untouched and records a named, session-scoped error", async () => {
    const service = fakeSessionService({
      archiveSession: async () => {
        throw new Error("Daemon unreachable");
      },
    });
    const list = readyList([session({ id: "s1" })]);

    const result = await archiveSessionAndReconcile(
      session({ id: "s1" }),
      list,
      actionsState(),
      service,
    );

    expect(result.list).toBe(list);
    expect(result.list).toEqual(readyList([session({ id: "s1" })]));
    expect(result.actions.error).toEqual({ sessionId: "s1", message: "Daemon unreachable" });
    expect(result.actions.pendingSessionId).toBeNull();
  });

  it("confirmDeleteSessionAndReconcile removes the row only after the daemon confirms deletion", async () => {
    let resolveDelete!: () => void;
    const service = fakeSessionService({
      deleteSession: async () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    });
    const list = readyList([session({ id: "s1" }), session({ id: "s2" })]);
    const requested = requestDeleteSession(actionsState(), session({ id: "s1" }));

    const pending = confirmDeleteSessionAndReconcile(list, requested, service);
    // Not yet resolved: the row must still be present mid-flight, never
    // removed ahead of the daemon's confirmation.
    await Promise.resolve();
    resolveDelete();
    const result = await pending;

    expect(result.list).toEqual(readyList([session({ id: "s2" })]));
    expect(result.actions).toEqual(actionsState());
  });

  it("a rejected delete leaves the row present with a named error — never vanishing optimistically and reappearing", async () => {
    const service = fakeSessionService({
      deleteSession: async () => {
        throw new Error("Session is still running");
      },
    });
    const list = readyList([session({ id: "s1" })]);
    const requested = requestDeleteSession(actionsState(), session({ id: "s1" }));

    const result = await confirmDeleteSessionAndReconcile(list, requested, service);

    expect(result.list).toBe(list);
    expect(result.list).toEqual(readyList([session({ id: "s1" })]));
    expect(result.actions.error).toEqual({
      sessionId: "s1",
      message: "Session is still running",
    });
    expect(result.actions.deleteTarget).toBeNull();
  });
});

describe("delete requires explicit confirmation (T32B4)", () => {
  it("requestDeleteSession opens the dialog without touching the list or calling the service", () => {
    const state = requestDeleteSession(actionsState(), session({ id: "s1" }));
    expect(state.deleteTarget).toEqual(session({ id: "s1" }));
    expect(state.pendingSessionId).toBeNull();
  });

  it("dismissing an unconfirmed delete request leaves the session present and never calls the service", async () => {
    let called = false;
    const service = fakeSessionService({
      deleteSession: async () => {
        called = true;
      },
    });
    const list = readyList([session({ id: "s1" })]);
    const requested = requestDeleteSession(actionsState(), session({ id: "s1" }));

    const dismissed = dismissDeleteRequest(requested);
    expect(dismissed.deleteTarget).toBeNull();

    // A caller that (incorrectly) tried to confirm after dismissal finds
    // nothing pending: beginConfirmedDeleteSession refuses, so the
    // service is never reached and the row survives.
    const begin = beginConfirmedDeleteSession(dismissed);
    expect(begin.sessionId).toBeNull();
    expect(begin.state).toBe(dismissed);

    const result = await confirmDeleteSessionAndReconcile(list, dismissed, service);
    expect(called).toBe(false);
    expect(result.list).toBe(list);
    expect(result.list).toEqual(readyList([session({ id: "s1" })]));
  });

  it("dismissDeleteRequest is a no-op when nothing is pending", () => {
    const state = actionsState();
    expect(dismissDeleteRequest(state)).toBe(state);
  });

  it("confirmDeleteSessionAndReconcile is a no-op when nothing is pending confirmation", async () => {
    let called = false;
    const service = fakeSessionService({
      deleteSession: async () => {
        called = true;
      },
    });
    const list = readyList([session({ id: "s1" })]);

    const result = await confirmDeleteSessionAndReconcile(list, actionsState(), service);

    expect(called).toBe(false);
    expect(result.list).toBe(list);
    expect(result.actions).toEqual(actionsState());
  });
});

describe("sessionAgeLabel (T363)", () => {
  const now = Date.parse("2026-09-11T12:00:00.000Z");

  it("says 'now' for anything inside the last minute", () => {
    expect(sessionAgeLabel("2026-09-11T11:59:59.000Z", now)).toBe("now");
    expect(sessionAgeLabel("2026-09-11T12:00:00.000Z", now)).toBe("now");
  });

  it("steps through one coarse unit at a time", () => {
    expect(sessionAgeLabel("2026-09-11T11:32:00.000Z", now)).toBe("28m");
    expect(sessionAgeLabel("2026-09-11T09:00:00.000Z", now)).toBe("3h");
    expect(sessionAgeLabel("2026-09-09T12:00:00.000Z", now)).toBe("2d");
  });

  it("rounds down at every boundary, so a row never ages early", () => {
    expect(sessionAgeLabel("2026-09-11T11:00:01.000Z", now)).toBe("59m");
    expect(sessionAgeLabel("2026-09-11T11:00:00.000Z", now)).toBe("1h");
    expect(sessionAgeLabel("2026-09-10T12:00:01.000Z", now)).toBe("23h");
    expect(sessionAgeLabel("2026-09-10T12:00:00.000Z", now)).toBe("1d");
  });

  it("gives no age rather than a broken one", () => {
    // A row is allowed to carry no age; it is not allowed to carry
    // "NaN", or a negative one because two clocks disagree.
    expect(sessionAgeLabel("not a timestamp", now)).toBeNull();
    expect(sessionAgeLabel("2026-09-11T13:00:00.000Z", now)).toBeNull();
  });

  it("tolerates a clock a few seconds ahead instead of blanking the row", () => {
    expect(sessionAgeLabel("2026-09-11T12:00:30.000Z", now)).toBe("now");
  });
});

describe("sessionRowMetaWithAge / sessionRowAccessibilityLabelWithAge (T363)", () => {
  const row = buildSessionRowModel({
    id: "s1",
    title: "Refactor the composer",
    provider: "pi",
    cwd: "/w/pi-companion",
    status: "idle",
    updatedAt: "2026-09-11T11:32:00.000Z",
  });

  it("appends the age to the visible line", () => {
    expect(sessionRowMetaWithAge(row, "28m")).toBe("pi · /w/pi-companion · 28m");
  });

  it("leaves both lines exactly as they were when there is no age", () => {
    expect(sessionRowMetaWithAge(row, null)).toBe(row.meta);
    expect(sessionRowAccessibilityLabelWithAge(row, null)).toBe(row.accessibilityLabel);
  });

  it("speaks the age as a sentence, not as the terse string", () => {
    // "twenty-eight em" at the end of a row says nothing about what is
    // being counted.
    expect(sessionRowAccessibilityLabelWithAge(row, "28m")).toBe(
      "Refactor the composer, Idle, pi · /w/pi-companion, updated 28m ago",
    );
    expect(sessionRowAccessibilityLabelWithAge(row, "now")).toBe(
      "Refactor the composer, Idle, pi · /w/pi-companion, updated just now",
    );
  });
});
