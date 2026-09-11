/**
 * Session-rail feature barrel (T27B1, plan.md §8.3). Later tasks in
 * this wave sequence (T27B2+) import from here to add creation, open,
 * resume, archive, and import behaviour on top of this render layer.
 */
export { categorizeSession, groupSessions } from "./group-sessions.js";
export type { SessionGroup, SessionGroupKind } from "./group-sessions.js";
export { SessionList } from "./SessionList.js";
export type { SessionListProps } from "./SessionList.js";
export { SessionTree } from "./session-tree.js";
export type { SessionTreeProps } from "./session-tree.js";
export { SessionRow } from "./SessionRow.js";
export type { SessionRowProps } from "./SessionRow.js";
export { statusPresentation } from "./status-presentation.js";
export type { SessionStatusPresentation } from "./status-presentation.js";
export type {
  SessionListState,
  SessionMode,
  SessionStatus,
  SessionSummary,
  SessionUsage,
} from "./types.js";

// App-shell session chrome: the left rail's head/search/rows/foot, the
// shared status pill, the header workspace crumb, and the read-only
// snapshot source both consume.
export { SessionRail } from "./SessionRail.js";
export type { SessionRailConnection, SessionRailProps } from "./SessionRail.js";
export { SessionStatusPill } from "./session-status-pill.js";
export type { SessionStatusPillProps } from "./session-status-pill.js";
export {
  formatSessionAge,
  formatSessionTokens,
  sessionGlyph,
  sessionMetaParts,
  sessionModeLabel,
  sessionModelChipLabel,
} from "./session-meta.js";
export type { SessionGlyph, SessionGlyphPresentation, SessionGlyphTone } from "./session-meta.js";
export { useSessionSnapshot } from "./use-session-snapshot.js";
export type { SessionSnapshotSource, SessionUpdateLike } from "./use-session-snapshot.js";
export { WorkspaceCrumb, SessionWorkspaceCrumb, workspaceBasename } from "./workspace-crumb.js";
export type {
  SessionChromeClient,
  SessionWorkspaceCrumbProps,
  WorkspaceCrumbProps,
  WorkspaceGitSource,
  WorkspaceLocation,
} from "./workspace-crumb.js";

// T27B2: session creation and opening.
export { CreateSessionDialog } from "./CreateSessionDialog.js";
export type { CreateSessionDialogProps } from "./CreateSessionDialog.js";
export { SessionsScreen } from "./SessionsScreen.js";
export type { SessionsScreenProps } from "./SessionsScreen.js";
export {
  createDaemonSessionsClient,
  type DaemonAgentClient,
  type DaemonAgentSnapshot,
} from "./daemon-sessions-client.js";
export { createPendingConnectionSessionsClient } from "./pending-connection-sessions-client.js";
export {
  SESSIONS_ACTION_UNSUPPORTED,
  SESSIONS_NOT_CONNECTED,
  explainSessionsActionError,
  explainSessionsCreateError,
  type CloneSessionInput,
  type CloneSessionResult,
  type CreateSessionInput,
  type ForkSessionInput,
  type ForkSessionResult,
  type RenameSessionInput,
  type RenameSessionResult,
  type SessionsClient,
  type SessionsErrorExplanation,
} from "./sessions-client.js";
export { useCreateSession } from "./use-create-session.js";
export type {
  CreateSessionController,
  CreateSessionPhase,
  UseCreateSessionOptions,
} from "./use-create-session.js";
export {
  DEFAULT_SESSION_PROVIDER,
  validateCreateSessionForm,
} from "./validate-create-session-form.js";
export type {
  CreateSessionFormFieldErrors,
  CreateSessionFormValidation,
  CreateSessionFormValues,
} from "./validate-create-session-form.js";

// T27B3: session resume and cold open.
export {
  createDaemonSessionResumeClient,
  type DaemonAgentTimelineClient,
  type DaemonFetchAgentResult,
  type DaemonFetchAgentTimelineOptions,
} from "./daemon-session-resume-client.js";
export { createPendingConnectionSessionResumeClient } from "./pending-connection-session-resume-client.js";
export {
  SESSION_RESUME_NOT_CONNECTED,
  explainSessionResumeError,
  type SessionResumeClient,
  type SessionResumeErrorExplanation,
  type SessionResumeResult,
  type SessionTimelinePayload,
} from "./session-resume-client.js";
export { SessionResumeScreen } from "./SessionResumeScreen.js";
export type { SessionResumeScreenProps } from "./SessionResumeScreen.js";
export { SessionResumeView } from "./SessionResumeView.js";
export type { SessionResumeViewProps } from "./SessionResumeView.js";
export { useResumeSession } from "./use-resume-session.js";
export type {
  SessionResumeController,
  SessionResumeError,
  SessionResumeState,
  SessionResumeStatus,
  UseResumeSessionOptions,
} from "./use-resume-session.js";

// T27B4: session archive and delete.
export { DeleteSessionDialog } from "./DeleteSessionDialog.js";
export type { DeleteSessionDialogProps } from "./DeleteSessionDialog.js";
export { useSessionActions } from "./use-session-actions.js";
export type {
  DeleteSessionPhase,
  SessionActionsController,
  UseSessionActionsOptions,
} from "./use-session-actions.js";

// T27B5: Pi session discovery and import (including terminal-started sessions).
export { DiscoveredSessionList } from "./DiscoveredSessionList.js";
export type { DiscoveredSessionListProps } from "./DiscoveredSessionList.js";
export { DiscoveredSessionRow } from "./DiscoveredSessionRow.js";
export type { DiscoveredSessionRowProps } from "./DiscoveredSessionRow.js";
export {
  explainDiscoveredSessionsError,
  isAlreadyImportedError,
  type DiscoveredSession,
  type DiscoveredSessionsClient,
  type ImportDiscoveredSessionInput,
  type ListDiscoveredSessionsInput,
} from "./discovered-sessions-client.js";
export {
  createDaemonDiscoveredSessionsClient,
  type DaemonProviderSessionsClient,
  type DaemonRecentProviderSessionEntry,
} from "./daemon-discovered-sessions-client.js";
export { createPendingConnectionDiscoveredSessionsClient } from "./pending-connection-discovered-sessions-client.js";
export { useDiscoveredSessions } from "./use-discovered-sessions.js";
export type {
  DiscoverSessionsPhase,
  DiscoveredSessionsController,
  UseDiscoveredSessionsOptions,
} from "./use-discovered-sessions.js";

// T27B6: keep the session list correct across reconnect and gap recovery.
export { mergeSessionList } from "./merge-sessions.js";
export { useSessionListSync } from "./use-session-list-sync.js";
export type {
  SessionListConnectionState,
  SessionListSyncClient,
  SessionListSyncResult,
  UseSessionListSyncOptions,
} from "./use-session-list-sync.js";

// T38A3: session fork and clone, and the client-tracked tree-state
// derivation `SessionsScreen` builds `SessionTree` nodes from.
export { useForkCloneSession } from "./use-fork-clone-session.js";
export type {
  ForkCloneSessionController,
  UseForkCloneSessionOptions,
} from "./use-fork-clone-session.js";
export { buildSessionTree } from "./session-tree-state.js";
export type { SessionRelationship } from "./session-tree-state.js";

// T38A4: session rename and metadata editing (bounded name validation,
// plus concurrent-rename arbitration built on `@picompanion/frontend-
// core`'s `actions.RequestArbitrator`, T47A1a/T103).
export { RenameSessionDialog } from "./RenameSessionDialog.js";
export type { RenameSessionDialogProps } from "./RenameSessionDialog.js";
export { useRenameSession } from "./use-rename-session.js";
export type {
  RenameSessionController,
  RenameSessionPhase,
  UseRenameSessionOptions,
} from "./use-rename-session.js";
export { MAX_EXPLICIT_AGENT_TITLE_CHARS, validateSessionName } from "./validate-session-name.js";
export type { SessionNameValidation } from "./validate-session-name.js";
