import { Button, Popover, StatusIndicator } from "../../ui/primitives/index.js";
import { statusPresentation } from "./status-presentation.js";
import type { SessionSummary } from "./types.js";

import "./session-list.css";

export interface SessionRowProps {
  session: SessionSummary;
  selected?: boolean;
  onSelect?: (sessionId: string) => void;
  /** Archives `session` immediately (T27B4); omitted (or already archived) hides the "Archive" action. */
  onArchive?: (session: SessionSummary) => void;
  /** Opens the delete-confirmation dialog for `session` (T27B4); omitted hides the "Delete" action. */
  onRequestDelete?: (session: SessionSummary) => void;
  /**
   * Clones `session` immediately (T38A3), fires-and-forgets like
   * `onArchive` (cloning never affects `session` itself, so it needs no
   * confirmation). Omitted hides the "Clone" action.
   */
  onClone?: (session: SessionSummary) => void;
  /**
   * Forks `session` immediately (T38A3), fires-and-forgets for the same
   * reason as `onClone`. Omitted hides the "Fork" action.
   *
   * A session-*list* row has no transcript access (that's
   * `features/transcript/`, a different directory this task does not
   * own), so it cannot offer a real per-message fork point the way an
   * "edit from here" shortcut inside an open transcript eventually will
   * (T38A1b builds that shortcut's *model*; wiring it to a transcript UI
   * trigger is separate, not-yet-issued work). This action forks from
   * the session's current tip instead — see `SessionsScreen`'s
   * `TIP_FORK_ENTRY_ID` for the disclosed placeholder entryId that
   * implies.
   */
  onFork?: (session: SessionSummary) => void;
  /** Opens the rename dialog for `session` (T38A4); omitted hides the "Rename" action. */
  onRequestRename?: (session: SessionSummary) => void;
  /** True while this row's own archive request is in flight (T27B4). */
  archiving?: boolean;
  /** True while this row's own clone request is in flight (T38A3). */
  cloning?: boolean;
  /** True while this row's own fork request is in flight (T38A3). */
  forking?: boolean;
  /**
   * Set once this client's own rename of `session` is confirmed
   * superseded by a concurrent rename from another client that reached
   * the daemon later (T38A4; see `use-rename-session.ts`'s module doc
   * for the last-write-wins rule this reports on). Rendered as a
   * plain-text notice, never silently — the row still shows whatever
   * name is now authoritative; this only explains *why* it changed out
   * from under a rename this client itself just made.
   */
  renameSupersededNotice?: string | null;
}

/**
 * A single session-rail row (T27B1). A native `<button>` so it is
 * keyboard reachable and operable (Tab/Enter/Space) with no extra ARIA
 * wiring, per plan.md §10.5 and the T27B1 acceptance criterion "rows
 * are keyboard reachable". Status is always visible text via
 * `StatusIndicator`, never colour alone.
 *
 * `onArchive`/`onRequestDelete` (T27B4) render a `Popover` of row
 * actions alongside the button rather than folding them into it, so
 * activating a row (open) and acting on it (archive/delete) stay two
 * separately reachable, separately labelled controls.
 */
export function SessionRow({
  session,
  selected = false,
  onSelect,
  onArchive,
  onRequestDelete,
  onClone,
  onFork,
  onRequestRename,
  archiving = false,
  cloning = false,
  forking = false,
  renameSupersededNotice = null,
}: SessionRowProps) {
  const { tone, text } = statusPresentation(session);
  const title = session.title ?? "Untitled session";
  const isArchived = Boolean(session.archivedAt);
  const showArchive = Boolean(onArchive) && !isArchived;
  const showClone = Boolean(onClone);
  const showFork = Boolean(onFork);
  const showRename = Boolean(onRequestRename);
  const showActions =
    showArchive || showClone || showFork || showRename || Boolean(onRequestDelete);

  return (
    <li className="pc-session-row">
      <button
        type="button"
        className="pc-session-row__button"
        aria-current={selected ? "true" : undefined}
        data-selected={selected}
        data-testid={`session-row-${session.id}`}
        onClick={() => onSelect?.(session.id)}
      >
        <span className="pc-session-row__title">{title}</span>
        <StatusIndicator label="Status" tone={tone} statusText={text} />
        <span className="pc-session-row__meta">
          {session.provider} · {session.cwd}
        </span>
      </button>
      {renameSupersededNotice ? (
        <p
          className="pc-session-row__rename-superseded"
          role="status"
          data-testid={`session-row-rename-superseded-${session.id}`}
        >
          {renameSupersededNotice}
        </p>
      ) : null}
      {showActions ? (
        <Popover
          triggerLabel={`Actions for ${title}`}
          testId={`session-row-actions-trigger-${session.id}`}
        >
          <div className="pc-session-row__actions">
            {showRename ? (
              <Button
                kind="secondary"
                onClick={() => onRequestRename?.(session)}
                data-testid={`session-row-rename-${session.id}`}
              >
                Rename
              </Button>
            ) : null}
            {showArchive ? (
              <Button
                kind="secondary"
                onClick={() => onArchive?.(session)}
                disabled={archiving}
                data-testid={`session-row-archive-${session.id}`}
              >
                {archiving ? "Archiving…" : "Archive"}
              </Button>
            ) : null}
            {showFork ? (
              <Button
                kind="secondary"
                onClick={() => onFork?.(session)}
                disabled={forking}
                data-testid={`session-row-fork-${session.id}`}
              >
                {forking ? "Forking…" : "Fork"}
              </Button>
            ) : null}
            {showClone ? (
              <Button
                kind="secondary"
                onClick={() => onClone?.(session)}
                disabled={cloning}
                data-testid={`session-row-clone-${session.id}`}
              >
                {cloning ? "Cloning…" : "Clone"}
              </Button>
            ) : null}
            {onRequestDelete ? (
              <Button
                kind="danger"
                onClick={() => onRequestDelete(session)}
                data-testid={`session-row-delete-${session.id}`}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </li>
  );
}
