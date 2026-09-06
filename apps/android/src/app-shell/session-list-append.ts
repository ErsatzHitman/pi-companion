import type { SessionListState, SessionSummary } from "../features/sessions/index.js";

/**
 * `SessionsRoute`'s (`app/h/[serverId]/(tabs)/sessions.tsx`) own
 * `onSessionCreated` reducer (T32S12, P5-W18, T37E2's finding: "sessions.
 * tsx needs `state`/`onSessionCreated` threading so a created session
 * appears as a row").
 *
 * `SessionsScreen` (`features/sessions/sessions-screen.tsx`, unowned by
 * this task) never mutates its own internal `listState` on a successful
 * create — it only calls the caller-supplied `onSessionCreated`, and its
 * internal `listState` re-syncs from the `state` prop on every change
 * (`useEffect(() => setListState(state), [state])`). Before this task
 * the route never passed `state` at all (`SessionsScreenProps.state`
 * defaulted to an empty `{ kind: "ready", sessions: [] }`), so a session
 * a user actually created never appeared as a row until a full page
 * remount.
 *
 * Deliberately not `sessions-model.ts`'s existing `reconcileSessionInList`
 * — that function only *updates* a session already present by id
 * (`state.sessions.map(...)`, a no-op for an id it does not find), which
 * is correct for its own callers (an archive/delete round-trip
 * reconciling a session the list already has) but wrong here: a freshly
 * created session's id is, by definition, not yet in `state.sessions`.
 * This function inserts it — at the front, most-recent-first, matching
 * `SessionsScreen`'s own row list not needing any particular sort order
 * imposed here (`groupSessionRows` does its own categorization/sort) —
 * or replaces an existing row with the same id, for the pathological
 * case of two create responses resolving out of order for what the
 * daemon considers the same session.
 */
export function appendCreatedSession(
  state: SessionListState,
  session: SessionSummary,
): SessionListState {
  if (state.kind !== "ready") {
    return { kind: "ready", sessions: [session] };
  }
  const alreadyPresent = state.sessions.some((existing) => existing.id === session.id);
  return {
    ...state,
    sessions: alreadyPresent
      ? state.sessions.map((existing) => (existing.id === session.id ? session : existing))
      : [session, ...state.sessions],
  };
}
