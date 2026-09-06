/**
 * Session-list render model (T32B1, plan.md §9.2 "compact status strip" /
 * §9.3 "primary touch targets are at least 48 dp" / §10.5 "non-color
 * status text"), extended by T32B2 (plan.md §9.2, "Add Android session
 * create and open") with the create-session draft/submit lifecycle and
 * the open-session loading/ready/error state machine.
 *
 * Mirrors the shape of `apps/web/src/features/sessions/types.ts` +
 * `status-presentation.ts` + `group-sessions.ts` closely enough that a
 * later task can reconcile the two, but is deliberately its own local
 * copy rather than a shared import: `packages/frontend-core`'s
 * `sessions/` domain is still a T14 skeleton stub (confirmed again for
 * T32B2 — `ls packages/frontend-core/src/sessions/` still shows only
 * `index.ts`'s `SESSIONS_DOMAIN_STUB` marker), so — exactly as the web
 * feature already does — this renders from a locally-defined core-state
 * shape until a later core task replaces it with a real adapter over
 * `DaemonClient`. T32B2 does not force that promotion; see this
 * repository's T32B2 commit message for the full note.
 *
 * `SessionListState`'s `stale` flag (below) mirrors
 * `apps/web/src/features/sessions/types.ts`'s own `stale?: boolean`
 * (added there by T27B6 for plan.md §7.4's "restore a stale cached tail
 * without marking it authoritative" invariant) so a later task (T37B,
 * "Mark cached data stale until catch-up") has an Android field to set —
 * this task only adds the field and does not itself produce a stale
 * state.
 *
 * `SessionService`, the create-session state, and the open-session state
 * below all follow plan.md §12.4's "no client yet" seam, matching
 * `../composer/composer-model.ts`'s pattern: no live `DaemonClient` is
 * wired into Android (that is T32A1B, wave P5-W6), so every transition
 * here is proven against an injected fake in `sessions-model.test.ts`,
 * never a socket. Opening a session only ever proves the state machine
 * (loading -> ready carrying whatever the injected service resolved, or
 * a distinct named error) — folding a real daemon timeline through
 * `@picompanion/frontend-core`'s timeline reducer
 * (`timeline.ingestTimelineWindow`) the way
 * `apps/web/src/features/sessions/session-resume-client.ts` (T27B3) does
 * is not proven here; `SessionOpenResult.timeline` uses that same
 * `coreTimeline.TimelineState` shape so a later task can wire a real
 * `SessionService.openSession` without reshaping this state again, but
 * this task never constructs or ingests one itself.
 *
 * Kept free of any React Native import so it is unit testable in this
 * workspace (see `../extensions/renderers/log-model.ts`'s note on why —
 * any module reaching `react-native` fails under this workspace's plain
 * `vitest` setup). `sessions-screen.tsx` is the thin native view over
 * this model.
 */
import type {
  composer as coreComposer,
  timeline as coreTimeline,
  KeyValueStorage,
  NetworkConnectionKind,
} from "@picompanion/frontend-core";

import type { StatusTone } from "../../ui/primitives";

/** Mirrors the ported backend's `AGENT_LIFECYCLE_STATUSES` (`@picompanion/protocol`). */
export type SessionStatus = "initializing" | "idle" | "running" | "error" | "closed";

export interface SessionSummary {
  id: string;
  /** `null` before Pi assigns a title. */
  title: string | null;
  provider: string;
  cwd: string;
  status: SessionStatus;
  /** Mirrors `AgentSnapshotPayload.requiresAttention`. */
  requiresAttention?: boolean;
  /** Mirrors `AgentSnapshotPayload.archivedAt`; non-null means archived. */
  archivedAt?: string | null;
  /** ISO-8601 timestamp, mirrors `AgentSnapshotPayload.updatedAt`. */
  updatedAt: string;
}

/**
 * The session-list core state a caller passes in (there is no live
 * `DaemonClient` on Android yet — T32A3-T32A6 build it). A discriminated
 * union so the screen never has to guess whether an empty `sessions`
 * array means "still loading" or "loaded and empty".
 *
 * `stale` on the `ready` branch: `true` while the last-known `sessions`
 * haven't been reconfirmed against the daemon since a disconnect,
 * matching `apps/web/src/features/sessions/types.ts`'s identical field
 * (T27B6). Defaults to `false`/absent for a state built from a live,
 * connected fetch; T32B2 only carried the field through without setting
 * it — T32B5 (below, "Surviving network path switches") is the first
 * caller that actually flips it, via `markSessionListStale`.
 *
 * `connectionPath` on the `ready` branch: the most recently observed
 * `NetworkConnectionKind` (T32B5, plan.md §7.4 "the active connection
 * path is visible"). Absent until a caller has fed at least one
 * `NetworkStatus` through `setSessionListConnectionPath` — render that
 * as "Unknown" (`sessionListConnectionPathLabel`), never guess "wifi".
 * Today's real adapter (`../../platform/network-reachability.ts`) can
 * itself only ever report `"unknown"`/`"none"` (no netinfo dependency
 * is installed) — so even once wired to production, this field mostly
 * reads "Unknown"/"Offline" honestly rather than a real Wi-Fi/cellular
 * distinction; see that module's doc comment and this feature's
 * `session-list-network-sync.ts` module doc for the full disclosure.
 */
export type SessionListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      sessions: readonly SessionSummary[];
      stale?: boolean;
      connectionPath?: NetworkConnectionKind;
    };

const STATUS_LABEL: Record<SessionStatus, string> = {
  initializing: "Initializing",
  idle: "Idle",
  running: "Running",
  error: "Error",
  closed: "Closed",
};

const STATUS_TONE: Record<SessionStatus, StatusTone> = {
  initializing: "info",
  idle: "neutral",
  running: "success",
  error: "danger",
  closed: "neutral",
};

export interface SessionStatusPresentation {
  tone: StatusTone;
  /** Always non-empty, visible text — never rely on `tone` alone (plan.md §10.5). */
  text: string;
}

/**
 * Maps a session's raw `status` (plus `requiresAttention`) to a
 * tone/text pair. `text` is always populated so status is legible
 * without colour.
 */
export function sessionStatusPresentation(session: SessionSummary): SessionStatusPresentation {
  if (session.requiresAttention) {
    return { tone: "warning", text: `${STATUS_LABEL[session.status]} · needs attention` };
  }
  return { tone: STATUS_TONE[session.status], text: STATUS_LABEL[session.status] };
}

/** A session's *group* answers "does this need my attention"; its row status answers "what is Pi doing right now". */
export type SessionGroupKind = "needs-attention" | "active" | "idle" | "archived";

const GROUP_ORDER: readonly SessionGroupKind[] = ["needs-attention", "active", "idle", "archived"];

const GROUP_LABEL: Record<SessionGroupKind, string> = {
  "needs-attention": "Needs attention",
  active: "Active",
  idle: "Idle",
  archived: "Archived",
};

/**
 * Categorizes a single session. Archived always wins (an archived
 * session's live `status` is no longer actionable); otherwise a session
 * needing attention or in an `error` status is surfaced above ordinary
 * active/idle sessions.
 */
export function categorizeSession(session: SessionSummary): SessionGroupKind {
  if (session.archivedAt) return "archived";
  if (session.requiresAttention || session.status === "error") return "needs-attention";
  if (session.status === "running" || session.status === "initializing") return "active";
  return "idle";
}

export interface SessionRowModel {
  id: string;
  title: string;
  tone: StatusTone;
  statusText: string;
  /** "<provider> · <cwd>", the row's secondary line. */
  meta: string;
  /** Full row summary for a single TalkBack focus stop: title, status, then meta. */
  accessibilityLabel: string;
}

/** Builds one row's full presentation, including its combined accessibility label. */
export function buildSessionRowModel(session: SessionSummary): SessionRowModel {
  const { tone, text } = sessionStatusPresentation(session);
  const title = session.title ?? "Untitled session";
  const meta = `${session.provider} · ${session.cwd}`;
  return {
    id: session.id,
    title,
    tone,
    statusText: text,
    meta,
    accessibilityLabel: `${title}, ${text}, ${meta}`,
  };
}

export interface SessionGroupModel {
  kind: SessionGroupKind;
  label: string;
  rows: readonly SessionRowModel[];
}

/**
 * Groups sessions in a fixed, stable order and drops empty groups so the
 * list never shows an "Archived" heading with nothing under it. Within
 * a group, sessions are sorted most-recently-updated first.
 */
export function groupSessionRows(sessions: readonly SessionSummary[]): SessionGroupModel[] {
  const buckets = new Map<SessionGroupKind, SessionSummary[]>(
    GROUP_ORDER.map((kind) => [kind, []]),
  );

  for (const session of sessions) {
    buckets.get(categorizeSession(session))?.push(session);
  }

  return GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABEL[kind],
    rows: [...(buckets.get(kind) ?? [])]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(buildSessionRowModel),
  })).filter((group) => group.rows.length > 0);
}

export type SessionsScreenModel =
  | { kind: "loading"; title: string; description: string }
  | { kind: "error"; title: string; description: string }
  | { kind: "empty"; title: string; description: string }
  | { kind: "ready"; groups: readonly SessionGroupModel[] };

/** Fully bakes `state` into what the screen renders — the view makes no further branching decisions. */
export function buildSessionsScreenModel(state: SessionListState): SessionsScreenModel {
  if (state.kind === "loading") {
    return {
      kind: "loading",
      title: "Loading sessions",
      description: "Fetching sessions from this host.",
    };
  }

  if (state.kind === "error") {
    return { kind: "error", title: "Couldn't load sessions", description: state.message };
  }

  if (state.sessions.length === 0) {
    return {
      kind: "empty",
      title: "No sessions yet",
      description: "Create a session on this host to see it here.",
    };
  }

  return { kind: "ready", groups: groupSessionRows(state.sessions) };
}

// -----------------------------------------------------------------------
// T32B2: session creation and opening.
// -----------------------------------------------------------------------

/** What a new session is created with. Matches `AgentSessionConfig`'s two fields, mirroring `apps/web/src/features/sessions/sessions-client.ts`'s `CreateSessionInput`. */
export interface CreateSessionRequest {
  /** This product's daemon currently only registers the `"pi"` provider (`AGENT_PROVIDER_DEFINITIONS`), matching web's `DEFAULT_SESSION_PROVIDER`. */
  provider: string;
  /** The workspace directory the new session runs in. */
  cwd: string;
}

/** A session's snapshot plus its timeline, in the same shape a real `SessionService.openSession` would produce by folding a daemon response through `@picompanion/frontend-core`'s `timeline.ingestTimelineWindow` — matching `apps/web/src/features/sessions/session-resume-client.ts`'s `SessionResumeResult`. This task never performs that folding itself; every test constructs `timeline` with `coreTimeline.createEmptyTimelineState()`. See the module doc. */
export interface SessionOpenResult {
  session: SessionSummary;
  timeline: coreTimeline.TimelineState;
}

/**
 * The narrow session-transport seam this task injects rather than
 * constructing a `DaemonClient` (see module doc). Every test in
 * `sessions-model.test.ts` exercises this against an in-memory fake;
 * T32A1B (wave P5-W6) is what backs a real implementation with
 * `DaemonClientLifecycle`.
 */
export interface SessionService {
  /** Resolves once the daemon (or fake) acknowledges the new session. Rejects with an `Error` whose `message` is the raw failure explanation on failure. */
  createSession(request: CreateSessionRequest): Promise<SessionSummary>;
  /** Resolves with the session's current snapshot plus its timeline. Rejects with an `Error` whose `message` is the raw failure explanation (e.g. "Agent not found: <id>") on failure. */
  openSession(sessionId: string): Promise<SessionOpenResult>;
  /**
   * Archives a session. Resolves with the daemon's updated summary
   * (`archivedAt` set) — T32B4's "the list reconciles with the daemon
   * after the change" reads the caller's post-archive list state from
   * this return value, never from a locally-guessed timestamp. Rejects
   * with an `Error` whose `message` is the raw failure explanation on
   * failure.
   */
  archiveSession(sessionId: string): Promise<SessionSummary>;
  /**
   * Permanently deletes a session. Resolves once the daemon confirms the
   * deletion. Rejects with an `Error` whose `message` is the raw failure
   * explanation on failure — the row this session names must stay in the
   * list until this resolves (T32B4: never an optimistic local removal).
   */
  deleteSession(sessionId: string): Promise<void>;
  /**
   * Fetches a fresh page of sessions for `session-list-network-sync.ts`'s
   * `SessionListNetworkSync` to reconcile the list against (T32B6, item
   * 2) — the `refreshSessions` seam T32B5 built that module against but
   * correctly declined to invent, rather than guess the daemon request.
   * Matches `apps/web/src/features/sessions/
   * daemon-sessions-client.ts`'s `fetchSessions` in spirit (same
   * `fetch_agents_request`/`includeArchived: true` RPC, so an archived
   * row reconciles rather than vanishing on a path switch), but returns
   * a `SessionListWindow` rather than a bare array so a caller can tell
   * a paged-off tail from the daemon's complete, current set — see that
   * type's own doc. Rejects with an `Error` whose `message` is the raw
   * failure explanation on failure, same convention as every other
   * method here.
   */
  refreshSessions(): Promise<SessionListWindow>;
}

// --- Create session --------------------------------------------------

/** This product's daemon currently only registers the `"pi"` provider, matching `apps/web/src/features/sessions/validate-create-session-form.ts`'s `DEFAULT_SESSION_PROVIDER`. */
export const DEFAULT_SESSION_PROVIDER = "pi";

export interface CreateSessionDraft {
  provider: string;
  cwd: string;
}

export const EMPTY_CREATE_SESSION_DRAFT: CreateSessionDraft = {
  provider: DEFAULT_SESSION_PROVIDER,
  cwd: "",
};

export interface CreateSessionFieldErrors {
  cwd?: string;
  provider?: string;
}

export type CreateSessionPhase = "idle" | "submitting" | "error";

export interface CreateSessionState {
  draft: CreateSessionDraft;
  phase: CreateSessionPhase;
  errors: CreateSessionFieldErrors;
  /** The raw service error message from the last failed attempt, if any. */
  errorMessage: string | null;
}

export const EMPTY_CREATE_SESSION_STATE: CreateSessionState = {
  draft: EMPTY_CREATE_SESSION_DRAFT,
  phase: "idle",
  errors: {},
  errorMessage: null,
};

export type CreateSessionDraftValidation =
  | { ok: true }
  | { ok: false; errors: CreateSessionFieldErrors };

/** Validates a draft's two fields, mirroring `apps/web`'s `validateCreateSessionForm`: both `cwd` and `provider` must be non-blank once trimmed. */
export function validateCreateSessionDraft(
  draft: CreateSessionDraft,
): CreateSessionDraftValidation {
  const errors: CreateSessionFieldErrors = {};
  if (!draft.cwd.trim()) {
    errors.cwd = "Enter a working directory for the new session.";
  }
  if (!draft.provider.trim()) {
    errors.provider = "Choose a provider for the new session.";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

/** Applies a typed edit to the draft only — never touches `phase`/`errors`/`errorMessage`, so editing after a failed submit doesn't silently clear the error the user is presumably about to fix. */
export function updateCreateSessionDraft(
  state: CreateSessionState,
  patch: Partial<CreateSessionDraft>,
): CreateSessionState {
  return { ...state, draft: { ...state.draft, ...patch } };
}

export interface BeginCreateSessionResult {
  state: CreateSessionState;
  /**
   * `true` once validation passed and `state.phase` moved to
   * `"submitting"` — the caller should now invoke
   * `SessionService.createSession(state.draft)` and follow up with
   * `markCreateSessionSucceeded`/`markCreateSessionFailed`. `false` for
   * a validation failure, where `state.errors` names the problem and
   * `state.draft` (and `phase`) are otherwise untouched.
   */
  ok: boolean;
}

/**
 * Starts a create-session submission: validates the draft first (a
 * client-side rejection never reaches `SessionService` at all, exactly
 * like `apps/web`'s `useCreateSession.submit`), then — only once valid —
 * clears any previous error and moves to `"submitting"`.
 */
export function beginCreateSession(state: CreateSessionState): BeginCreateSessionResult {
  const validation = validateCreateSessionDraft(state.draft);
  if (!validation.ok) {
    return { state: { ...state, errors: validation.errors }, ok: false };
  }
  return {
    state: { ...state, errors: {}, errorMessage: null, phase: "submitting" },
    ok: true,
  };
}

/** A successful create clears the draft back to its default and returns to `"idle"` — matching `apps/web`'s `useCreateSession.submit` clearing `cwd`/`provider` only on success. */
export function markCreateSessionSucceeded(): CreateSessionState {
  return EMPTY_CREATE_SESSION_STATE;
}

/**
 * A failed create surfaces `message` and returns `phase` to `"error"` —
 * but deliberately never touches `state.draft`: this is the whole of
 * T32B2's "a failed create keeps typed input" acceptance criterion.
 * Compare `apps/web`'s `useCreateSession.submit` catch branch, which
 * likewise never calls `setCwd`/`setProvider` on failure.
 */
export function markCreateSessionFailed(
  state: CreateSessionState,
  message: string,
): CreateSessionState {
  return { ...state, phase: "error", errorMessage: message };
}

// --- Open session ------------------------------------------------------

/**
 * The open-session state machine. A discriminated union — deliberately
 * not a flat `{ status; session: T | null; error: string | null }`
 * shape — so an open failure is structurally a distinct branch
 * (`"error"`) rather than a `"ready"` branch that merely happens to
 * carry `null`/an empty timeline (T32B2's "an open failure is a
 * distinct named error rather than an empty list" acceptance
 * criterion).
 *
 * There is no live timeline ingest proven here (see module doc): this
 * only proves the transition `"idle" -> "loading" -> "ready"` (carrying
 * whatever `SessionService.openSession` resolved) or
 * `"idle" -> "loading" -> "error"` (carrying the rejection's raw
 * message). Rendering `"ready"`'s `timeline` is the transcript feature's
 * job, not this module's or `sessions-screen.tsx`'s.
 */
export type SessionOpenState =
  | { status: "idle"; sessionId: null }
  | { status: "loading"; sessionId: string }
  | {
      status: "ready";
      sessionId: string;
      session: SessionSummary;
      timeline: coreTimeline.TimelineState;
      /**
       * `true` for a `"ready"` produced by a cold-start/resume restore
       * (T32B3, plan.md §7.4 "restore a stale cached tail without
       * marking it authoritative") — absent/`false` for a plain
       * tap-to-open, which came straight from `SessionService` with
       * nothing cached in between. Cleared to `false` once
       * `applySessionOpenReconcile` lands a confirmed reconcile for
       * this session. Distinct from `SessionListState`'s own `stale`
       * field above, which a later task (T37B) sets for the *list*
       * once connection-status tracking exists — this flag is this
       * task's, for a single restored session's timeline.
       */
      stale?: boolean;
      /** This session's queued outbox entries, oldest first — "queue state" (T32B3's "resume restores timeline and queue state"). Populated only when the opener supplied an `OutboxQueueReader`; absent (not merely empty) otherwise, so a caller can distinguish "no queue was loaded" from "loaded and empty". */
      queue?: readonly coreComposer.OutboxEntry[];
    }
  | { status: "error"; sessionId: string; message: string };

export const IDLE_SESSION_OPEN_STATE: SessionOpenState = { status: "idle", sessionId: null };

/** Starts opening `sessionId`: moves to `"loading"`, discarding whatever the previous open attempt (for this or any other session) had resolved or failed with. */
export function beginSessionOpen(sessionId: string): SessionOpenState {
  return { status: "loading", sessionId };
}

/**
 * Resolves an open in progress into `"ready"`, carrying
 * `SessionService.openSession`'s result verbatim. `extra` is optional
 * and additive (T32B3's `stale`/`queue`, see `SessionOpenState`'s doc);
 * omitting it — as every T32B2 call site still does — produces exactly
 * the same two-field-plus-identity shape as before, byte for byte.
 */
export function completeSessionOpen(
  sessionId: string,
  result: SessionOpenResult,
  extra?: { stale?: boolean; queue?: readonly coreComposer.OutboxEntry[] },
): SessionOpenState {
  return {
    status: "ready",
    sessionId,
    session: result.session,
    timeline: result.timeline,
    ...(extra?.stale !== undefined ? { stale: extra.stale } : {}),
    ...(extra?.queue !== undefined ? { queue: extra.queue } : {}),
  };
}

/** Resolves an open in progress into `"error"`, carrying the rejection's raw message — never a `"ready"` state with an empty/placeholder timeline. */
export function failSessionOpen(sessionId: string, message: string): SessionOpenState {
  return { status: "error", sessionId, message };
}

/**
 * Marks a `"ready"` open state's timeline as reconciled/authoritative
 * (T32B3, plan.md §7.4). Called once a `connection.ResumeController`
 * reconcile for `sessionId` resolves successfully
 * (`../session-resume-controller.ts`'s `onReconciled`). A no-op — the
 * unchanged `state` comes back — when `state` isn't currently `"ready"`
 * for `sessionId`: a reconcile that lands after the user has since
 * closed or switched sessions must not resurrect the one it was
 * fetched for.
 */
export function applySessionOpenReconcile(
  state: SessionOpenState,
  sessionId: string,
  result: SessionOpenResult,
): SessionOpenState {
  if (state.status !== "ready" || state.sessionId !== sessionId) return state;
  return { ...state, session: result.session, timeline: result.timeline, stale: false };
}

// -----------------------------------------------------------------------
// T32B3: last-opened-session persistence, cold-start restore, and the
// "a missing session fails with a clear message" error classification.
// -----------------------------------------------------------------------

/**
 * `KeyValueStorage` key for the id of the last session this app
 * successfully opened (any way: tapped from the list, or itself
 * restored). Not a secret — plan.md §7.3's `KeyValueStorage` doc
 * comment names exactly this ("the last opened session id") as its
 * example use, and T32A2's `credential-store.ts` (`SecureStorage`) is
 * reserved for actual secrets.
 */
export const LAST_OPENED_SESSION_STORAGE_KEY = "sessions/last-opened-session-id";

/** Reads the persisted last-opened session id, or `null` if none has ever been recorded. */
export async function readLastOpenedSessionId(storage: KeyValueStorage): Promise<string | null> {
  return storage.getItem(LAST_OPENED_SESSION_STORAGE_KEY);
}

/** Persists `sessionId` as the one to restore on the next cold start. */
export async function writeLastOpenedSessionId(
  storage: KeyValueStorage,
  sessionId: string,
): Promise<void> {
  await storage.setItem(LAST_OPENED_SESSION_STORAGE_KEY, sessionId);
}

/** Clears the persisted last-opened session id — called once a restore discovers the daemon no longer has that session, so a later cold start doesn't keep retrying a session that is gone. */
export async function clearLastOpenedSessionId(storage: KeyValueStorage): Promise<void> {
  await storage.removeItem(LAST_OPENED_SESSION_STORAGE_KEY);
}

export interface SessionOpenErrorExplanation {
  readonly title: string;
  readonly description: string;
  /**
   * `true` when the daemon reported that the session itself doesn't
   * exist — a distinct, non-retryable case from a network/transport
   * failure (T32B3's "a missing session fails with a clear message"
   * acceptance criterion: the two must be distinguishable, not both a
   * generic "couldn't open" message).
   */
  readonly missing: boolean;
}

/**
 * Classifies a raw `SessionService.openSession` rejection message into a
 * title/description pair a user can act on, and whether the failure
 * means the session is gone (as opposed to, say, a network hiccup).
 * Mirrors `apps/web/src/features/sessions/session-resume-client.ts`'s
 * `explainSessionResumeError`, including its `/agent not found/i`
 * pattern for the reference backend's `"Agent not found: <id>"`
 * (`packages/server/src/server/session.ts`'s `handleFetchAgent`) — the
 * exact message `SessionService.openSession`'s own doc comment
 * documents as its missing-session example.
 */
export function explainSessionOpenError(rawMessage: string): SessionOpenErrorExplanation {
  const message = rawMessage.trim();
  if (/agent not found/i.test(message) || /^enoent\b/i.test(message)) {
    return {
      title: "This session doesn't exist",
      description: "It may have been deleted, or the link is no longer valid.",
      missing: true,
    };
  }
  return {
    title: "Couldn't open this session",
    description: message.length > 0 ? message : "The daemon returned an unknown error.",
    missing: false,
  };
}

/**
 * The narrow seam `openAndLoadSession` reads a session's queued outbox
 * entries through, structurally satisfied by `frontend-core`'s
 * `composer.OutboxController` (its `loadAll(sessionId)` returns
 * `Promise<OutboxEntry[]>`, assignable here) without this module
 * depending on `StructuredStorage`/`Clock` to construct one itself.
 */
export interface OutboxQueueReader {
  loadAll(sessionId: string): Promise<readonly coreComposer.OutboxEntry[]>;
}

export interface SessionOpenDeps {
  sessionService: SessionService;
  /**
   * When given, a successful open persists `sessionId` as the
   * last-opened session (`writeLastOpenedSessionId`), and a "missing
   * session" failure clears it (`clearLastOpenedSessionId`) so a later
   * cold start doesn't keep retrying a session that is gone.
   */
  storage?: KeyValueStorage;
  /** When given, its queue is loaded alongside the timeline and attached to the resulting `"ready"` state's `queue` field. */
  outbox?: OutboxQueueReader;
}

/**
 * Opens `sessionId` end to end — timeline plus, when `deps.outbox` is
 * given, this session's queued outbox entries — and, when `deps.storage`
 * is given, persists/clears the last-opened id as described on
 * `SessionOpenDeps`. Returns the same `"ready"`/`"error"` shape
 * `completeSessionOpen`/`failSessionOpen` already produce (never a
 * distinct third shape), so a caller pairs this with one
 * `beginSessionOpen(sessionId)` call and gets the identical
 * loading -> ready/error transition a plain tap-to-open already proves
 * (`sessions-model.test.ts`'s T32B2 suite) — this task only adds what
 * happens *around* that transition (persistence, the queue, and the
 * `stale` flag via `options.stale`), never a second one.
 *
 * Pass `{ stale: true }` when this open is itself a restore of a
 * session the user did not just tap (a cold start, or a
 * `ResumeController` reconcile) so the caller renders it as an
 * unconfirmed cached tail per plan.md §7.4, until a later
 * `applySessionOpenReconcile` clears it.
 */
export async function openAndLoadSession(
  sessionId: string,
  deps: SessionOpenDeps,
  options?: { stale?: boolean },
): Promise<SessionOpenState> {
  try {
    const [result, queue] = await Promise.all([
      deps.sessionService.openSession(sessionId),
      deps.outbox ? deps.outbox.loadAll(sessionId) : Promise.resolve(undefined),
    ]);
    if (deps.storage) {
      await writeLastOpenedSessionId(deps.storage, sessionId);
    }
    return completeSessionOpen(sessionId, result, {
      ...(options?.stale !== undefined ? { stale: options.stale } : {}),
      ...(queue !== undefined ? { queue } : {}),
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (deps.storage && explainSessionOpenError(raw).missing) {
      await clearLastOpenedSessionId(deps.storage);
    }
    return failSessionOpen(sessionId, raw);
  }
}

// -----------------------------------------------------------------------
// T32B4: session archive and delete.
//
// Deliberately never optimistic (contrast `apps/web/src/features/
// sessions/use-session-actions.ts`'s `archive`/`confirmDelete`, which
// apply a local guess or remove the row *before* the round-trip
// settles, then roll back on failure): this task's acceptance criterion
// is "the list reconciles with the daemon after the change", so every
// mutation here only ever touches `SessionListState` once
// `SessionService` has actually resolved, using exactly what it
// resolved with — never a client-side guess, and never something that
// has to be undone. See `archiveSessionAndReconcile`/
// `confirmDeleteSessionAndReconcile` below.
// -----------------------------------------------------------------------

export type SessionRowActionPhase = "idle" | "archiving" | "deleting";

export interface SessionRowActionError {
  sessionId: string;
  message: string;
}

/**
 * Tracks an in-flight archive/delete for at most one session at a time,
 * plus the delete-confirmation dialog's target — deliberately separate
 * from `SessionListState` (owned by whichever caller fetches sessions;
 * see `sessions-model.ts`'s module doc) so this feature never has to
 * own session fetching just to prove archive/delete against the
 * injected fake `SessionService`.
 */
export interface SessionActionsState {
  /** The id of the session currently being archived or deleted, or `null` when nothing is in flight. */
  pendingSessionId: string | null;
  pendingPhase: SessionRowActionPhase;
  /**
   * The session a delete-confirmation dialog is open for, or `null`
   * when it's closed. Set by `requestDeleteSession`; cleared by
   * `dismissDeleteRequest` (no delete happens) or by
   * `beginConfirmedDeleteSession` (a delete now begins) — this is
   * T32B4's "delete requires explicit confirmation": nothing calls
   * `SessionService.deleteSession` except by going through this field
   * first.
   */
  deleteTarget: SessionSummary | null;
  /** The most recent action failure, if any — kept until the next archive/delete attempt (for this or any other session) begins. */
  error: SessionRowActionError | null;
}

export const IDLE_SESSION_ACTIONS_STATE: SessionActionsState = {
  pendingSessionId: null,
  pendingPhase: "idle",
  deleteTarget: null,
  error: null,
};

// --- Reconciling SessionListState --------------------------------------

/**
 * Replaces the matching row in `state.sessions` with `updated` verbatim
 * — the daemon-reported summary, never a client-side flip of
 * `archivedAt`. A no-op on a non-`"ready"` list state. Once applied, the
 * archived session moves to the "Archived" group the next time
 * `groupSessionRows`/`buildSessionsScreenModel` runs, via
 * `categorizeSession`; this function itself never re-sorts or drops the
 * row.
 */
export function reconcileSessionInList(
  state: SessionListState,
  updated: SessionSummary,
): SessionListState {
  if (state.kind !== "ready") return state;
  return {
    ...state,
    sessions: state.sessions.map((session) => (session.id === updated.id ? updated : session)),
  };
}

/**
 * Removes `sessionId`'s row from `state.sessions`. Callers must only
 * invoke this once `SessionService.deleteSession` has actually
 * resolved (see `confirmDeleteSessionAndReconcile`) — never before, and
 * never speculatively. A no-op on a non-`"ready"` list state.
 */
export function removeSessionFromList(
  state: SessionListState,
  sessionId: string,
): SessionListState {
  if (state.kind !== "ready") return state;
  return { ...state, sessions: state.sessions.filter((session) => session.id !== sessionId) };
}

// -----------------------------------------------------------------------
// T32B5: surviving Wi-Fi/cellular/relay network path switches.
// -----------------------------------------------------------------------

/**
 * A freshly fetched batch of sessions to reconcile into `SessionListState`
 * (T32B5, plan.md §7.4 "deduplicate by epoch and sequence" applied to the
 * session rail — see `apps/web/src/features/sessions/merge-sessions.ts`
 * for the sibling this mirrors, adapted here to also cover a *partial*
 * refetch, which that web version does not need to distinguish).
 *
 * - `complete: true` — `sessions` is the full, authoritative list. Any
 *   row this feature currently knows about that isn't in `sessions` was
 *   actually deleted elsewhere while this client was disconnected, and
 *   `mergeSessionListWindow` drops it.
 * - `complete: false` — `sessions` covers only *some* rows (e.g. a quick
 *   post-reconnect resync that only managed to confirm a subset before
 *   the path flapped again). A row this feature already knows about that
 *   isn't in `sessions` is simply outside this window's coverage, not
 *   confirmed gone — `mergeSessionListWindow` preserves it. This is what
 *   keeps "a window that starts after the last known cursor" from
 *   silently dropping the gap.
 *
 * Either way, a row present in both sides always resolves to the fetched
 * (authoritative-for-what-it-covers) value, and a duplicate id within
 * `sessions` itself resolves to its last occurrence — both matching
 * `mergeSessionList`'s existing contract on web.
 */
export interface SessionListWindow {
  sessions: readonly SessionSummary[];
  complete: boolean;
}

/**
 * Merges `window` into `current`, idempotently: applying the same (or an
 * overlapping) window more than once — in any order a reconnect/re-flap
 * might replay it — never produces two rows for the same session, and a
 * `complete: false` window never silently removes a row it simply didn't
 * cover. See `session-list-network-sync.test.ts` for the deliberately
 * overlapping and deliberately gapped replay cases this guarantees.
 */
export function mergeSessionListWindow(
  current: readonly SessionSummary[],
  window: SessionListWindow,
): SessionSummary[] {
  const fetchedById = new Map<string, SessionSummary>();
  for (const session of window.sessions) {
    fetchedById.set(session.id, session); // last occurrence in `sessions` wins
  }

  const merged: SessionSummary[] = [];
  const placed = new Set<string>();

  for (const session of current) {
    if (placed.has(session.id)) continue; // defensive: `current` itself should never carry a duplicate id
    const fetched = fetchedById.get(session.id);
    if (fetched) {
      merged.push(fetched);
      placed.add(session.id);
    } else if (!window.complete) {
      merged.push(session); // outside this partial window's coverage — preserved, not dropped
      placed.add(session.id);
    }
    // else: `window.complete` and this row wasn't reported — the daemon no longer has it.
  }

  for (const session of fetchedById.values()) {
    if (placed.has(session.id)) continue;
    merged.push(session);
    placed.add(session.id);
  }

  return merged;
}

/**
 * Applies a freshly fetched `SessionListWindow` to `state` via
 * `mergeSessionListWindow`, clearing `stale`. Treats a non-`"ready"`
 * `state` (`"loading"`/`"error"`) as having no sessions yet, so the
 * first successful resync after a cold start or a failed load produces
 * a `"ready"` list rather than requiring a caller to special-case it —
 * every other field this state may have carried (e.g. `connectionPath`,
 * once known) is preserved.
 */
export function applySessionListWindow(
  state: SessionListState,
  window: SessionListWindow,
): SessionListState {
  const current = state.kind === "ready" ? state.sessions : [];
  const connectionPath = state.kind === "ready" ? state.connectionPath : undefined;
  return {
    kind: "ready",
    sessions: mergeSessionListWindow(current, window),
    stale: false,
    ...(connectionPath !== undefined ? { connectionPath } : {}),
  };
}

/**
 * Marks a `"ready"` list unconfirmed since the last disconnect (T32B2's
 * `stale` field, put to its first real use here). A no-op on a
 * non-`"ready"` state — there is no list yet to mark unconfirmed.
 */
export function markSessionListStale(state: SessionListState): SessionListState {
  if (state.kind !== "ready") return state;
  return { ...state, stale: true };
}

/**
 * Records the most recently observed `NetworkConnectionKind` on a
 * `"ready"` list, independent of whether that observation also triggers
 * a resync — "the active connection path is visible" holds even for a
 * caller with no `SessionListWindow` fetcher wired yet. A no-op on a
 * non-`"ready"` state, matching this section's other setters.
 */
export function setSessionListConnectionPath(
  state: SessionListState,
  path: NetworkConnectionKind,
): SessionListState {
  if (state.kind !== "ready") return state;
  return { ...state, connectionPath: path };
}

const CONNECTION_PATH_LABEL: Record<NetworkConnectionKind, string> = {
  wifi: "Wi-Fi",
  cellular: "Cellular",
  ethernet: "Ethernet",
  unknown: "Unknown",
  none: "Offline",
};

/**
 * Legible label for `SessionListState.connectionPath` — always
 * non-`null`/non-empty text (plan.md §10.5, "non-color status text"),
 * and honestly "Unknown" rather than a guessed "Wi-Fi" when no path has
 * been observed yet.
 */
export function sessionListConnectionPathLabel(path: NetworkConnectionKind | undefined): string {
  return path === undefined ? "Unknown" : CONNECTION_PATH_LABEL[path];
}

// --- Archive -------------------------------------------------------------

/** Marks `sessionId` as archiving and clears any stale error. */
export function beginArchiveSession(
  state: SessionActionsState,
  sessionId: string,
): SessionActionsState {
  return { ...state, pendingSessionId: sessionId, pendingPhase: "archiving", error: null };
}

/** Clears the pending marker once an archive for `sessionId` resolves. A no-op if `state` is no longer pending for `sessionId` (e.g. a second action already started). */
export function completeArchiveSession(
  state: SessionActionsState,
  sessionId: string,
): SessionActionsState {
  if (state.pendingSessionId !== sessionId) return state;
  return { ...state, pendingSessionId: null, pendingPhase: "idle" };
}

/** Clears the pending marker and records a named, session-scoped error. The list is untouched by this function — the row stays present. */
export function failArchiveSession(
  state: SessionActionsState,
  sessionId: string,
  message: string,
): SessionActionsState {
  return {
    ...state,
    pendingSessionId: null,
    pendingPhase: "idle",
    error: { sessionId, message },
  };
}

export interface SessionListAndActions {
  list: SessionListState;
  actions: SessionActionsState;
}

/**
 * Archives `session` end to end: marks it pending
 * (`beginArchiveSession`), calls `sessionService.archiveSession`, then —
 * only once that resolves — reconciles `list` with the daemon-reported
 * summary (`reconcileSessionInList`). A rejection leaves `list`
 * untouched and records the raw message via `failArchiveSession`, so
 * the row is always present either way; nothing here is rolled back
 * because nothing here is applied before the round-trip settles.
 */
export async function archiveSessionAndReconcile(
  session: SessionSummary,
  list: SessionListState,
  actions: SessionActionsState,
  sessionService: SessionService,
): Promise<SessionListAndActions> {
  const pending = beginArchiveSession(actions, session.id);
  try {
    const updated = await sessionService.archiveSession(session.id);
    return {
      list: reconcileSessionInList(list, updated),
      actions: completeArchiveSession(pending, session.id),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { list, actions: failArchiveSession(pending, session.id, message) };
  }
}

// --- Delete ----------------------------------------------------------------

/** Opens the delete-confirmation dialog for `session`. No service call happens here — see `SessionActionsState.deleteTarget`'s doc. */
export function requestDeleteSession(
  state: SessionActionsState,
  session: SessionSummary,
): SessionActionsState {
  return { ...state, deleteTarget: session, error: null };
}

/**
 * Dismisses the delete-confirmation dialog without deleting anything.
 * The session named by `state.deleteTarget` is left exactly as it was —
 * this is the whole of T32B4's "an unconfirmed dismissal leaves the
 * session present" acceptance criterion. A no-op if no delete is
 * pending.
 */
export function dismissDeleteRequest(state: SessionActionsState): SessionActionsState {
  if (!state.deleteTarget) return state;
  return { ...state, deleteTarget: null };
}

export interface BeginConfirmedDeleteResult {
  state: SessionActionsState;
  /** The session id to now call `SessionService.deleteSession` with, or `null` if there was nothing pending confirmation (the caller should do nothing further). */
  sessionId: string | null;
}

/**
 * Confirms the pending delete: closes the dialog and moves to
 * `"deleting"`. The caller now invokes
 * `sessionService.deleteSession(sessionId)` and follows up with
 * `completeDeleteSession`/`failDeleteSession` — or, more simply, calls
 * `confirmDeleteSessionAndReconcile`, which does all three. Returns
 * `state` unchanged with `sessionId: null` if nothing was pending
 * confirmation (e.g. called twice, or after `dismissDeleteRequest`) —
 * `SessionService.deleteSession` must never be reachable except by way
 * of `requestDeleteSession` first.
 */
export function beginConfirmedDeleteSession(
  state: SessionActionsState,
): BeginConfirmedDeleteResult {
  if (!state.deleteTarget) return { state, sessionId: null };
  const sessionId = state.deleteTarget.id;
  return {
    state: {
      ...state,
      deleteTarget: null,
      pendingSessionId: sessionId,
      pendingPhase: "deleting",
      error: null,
    },
    sessionId,
  };
}

/** Clears the pending marker once a delete for `sessionId` resolves. A no-op if `state` is no longer pending for `sessionId`. */
export function completeDeleteSession(
  state: SessionActionsState,
  sessionId: string,
): SessionActionsState {
  if (state.pendingSessionId !== sessionId) return state;
  return { ...state, pendingSessionId: null, pendingPhase: "idle" };
}

/** Clears the pending marker and records a named, session-scoped error. The list is untouched — the row this session names stays present, never removed and then reinserted. */
export function failDeleteSession(
  state: SessionActionsState,
  sessionId: string,
  message: string,
): SessionActionsState {
  return {
    ...state,
    pendingSessionId: null,
    pendingPhase: "idle",
    error: { sessionId, message },
  };
}

/**
 * Deletes whichever session `actions.deleteTarget` currently names, end
 * to end: confirms it (`beginConfirmedDeleteSession`), calls
 * `sessionService.deleteSession`, then — only once that resolves —
 * removes the row from `list` (`removeSessionFromList`). A no-op
 * (returns `list`/`actions` unchanged) when nothing is pending
 * confirmation, so this can never be reached except by way of
 * `requestDeleteSession` first (T32B4: "delete requires explicit
 * confirmation"). A rejection leaves `list` untouched — the row stays
 * present, with a named error on `actions.error`, never vanishing
 * optimistically and then reappearing.
 */
export async function confirmDeleteSessionAndReconcile(
  list: SessionListState,
  actions: SessionActionsState,
  sessionService: SessionService,
): Promise<SessionListAndActions> {
  const begin = beginConfirmedDeleteSession(actions);
  if (!begin.sessionId) return { list, actions };
  const sessionId = begin.sessionId;
  try {
    await sessionService.deleteSession(sessionId);
    return {
      list: removeSessionFromList(list, sessionId),
      actions: completeDeleteSession(begin.state, sessionId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { list, actions: failDeleteSession(begin.state, sessionId, message) };
  }
}
