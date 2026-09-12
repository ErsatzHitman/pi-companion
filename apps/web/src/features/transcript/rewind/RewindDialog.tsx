/**
 * The "Rewind to here" dialog — T395, `plan.md` §4.2 ("Workspace
 * checkpoint snapshots").
 *
 * Presents the three scopes the daemon accepts (`rewind-scopes.ts`), the
 * outcome `RewindController` returned, the explicit "Restore anyway"
 * second confirm a `conflict` requires, and the local undone-turns record.
 * State and I/O live in `use-rewind-to-here.ts`; this file renders that
 * state and calls back into it, so every branch — including the conflict
 * copy and the axe-checked markup — is directly testable without a daemon.
 *
 * It composes the shared `useModalBehavior` hook rather than the `Dialog`
 * primitive for the same reason `PermissionDialog` does: this dialog has
 * a variable footer (Cancel/Rewind, Cancel/Restore anyway, Close) and an
 * in-dialog list, which `Dialog`'s fixed confirm/cancel pair cannot
 * express. The modal contract is identical: focus trap, Escape, backdrop
 * dismiss, `aria-modal`, labelled and described.
 *
 * `role="alertdialog"` is used for the `conflict` phase (a destructive
 * confirmation) and `"dialog"` otherwise, matching `Dialog`'s own
 * dangerous-confirmation convention.
 */
import { useId } from "react";

import { Button } from "../../../ui/primitives/index.js";
import { useModalBehavior } from "../../../ui/primitives/use-modal-behavior.js";
import "../../../ui/primitives/primitives.css";
import "./rewind.css";
import { REWIND_SCOPE_OPTIONS, rewindScopeLabel } from "./rewind-scopes.js";
import type { RewindMode } from "./rewind-scopes.js";
import type { UndoneTurn } from "./undone-turns.js";
import type { RewindStatus, RewindTarget } from "./use-rewind-to-here.js";

export interface RewindDialogProps {
  open: boolean;
  target: RewindTarget | null;
  mode: RewindMode;
  status: RewindStatus;
  message: string | null;
  turnRunning: boolean;
  connected: boolean;
  canSubmit: boolean;
  undoneTurns: readonly UndoneTurn[];
  onSelectMode: (mode: RewindMode) => void;
  onClose: () => void;
  onSubmit: () => void;
  onRestoreAnyway: () => void;
  onReturnToTurn: (turn: UndoneTurn) => void;
  testId?: string;
}

/** The noun phrase for a scope, e.g. in "can't rewind the files here". */
function scopeNoun(mode: RewindMode): string {
  switch (mode) {
    case "conversation":
      return "the conversation";
    case "files":
      return "the files";
    case "both":
      return "the conversation and files";
  }
}

/** The honest paragraph for the outcome currently on screen. */
function outcomeNotice(status: RewindStatus, mode: RewindMode): string | null {
  switch (status) {
    case "conflict":
      return "The work tree changed since this snapshot, so the restore was refused. Restoring anyway discards those changes.";
    case "unsupported":
      return `This provider can't rewind ${scopeNoun(mode)} here.`;
    case "failed":
      return "The rewind failed.";
    case "success":
      return "Rewound. The transcript is refreshed.";
    default:
      return null;
  }
}

export function RewindDialog({
  open,
  target,
  mode,
  status,
  message,
  turnRunning,
  connected,
  canSubmit,
  undoneTurns,
  onSelectMode,
  onClose,
  onSubmit,
  onRestoreAnyway,
  onReturnToTurn,
  testId = "rewind-dialog",
}: RewindDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const modeName = useId();
  const panelRef = useModalBehavior(open, onClose);

  if (!open) return null;

  const busy = status === "submitting";
  const showScopes = status === "idle" || status === "submitting";
  const notice = outcomeNotice(status, mode);

  return (
    <div
      className="pc-overlay-scrim pc-overlay-scrim--dialog"
      data-testid={`${testId}-scrim`}
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        className="pc-rewind"
        role={status === "conflict" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        data-testid={testId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="pc-rewind__title" id={titleId}>
          Rewind to here
        </h2>
        <p className="pc-rewind__description" id={descriptionId}>
          {target ? `Rewind this session to “${target.snippet}”.` : "Rewind this session."}
        </p>

        {showScopes ? (
          <fieldset className="pc-rewind__scopes" disabled={busy}>
            <legend className="pc-rewind__legend">What to rewind</legend>
            {REWIND_SCOPE_OPTIONS.map((option) => (
              <label className="pc-rewind__scope" key={option.mode}>
                <input
                  type="radio"
                  name={modeName}
                  value={option.mode}
                  checked={mode === option.mode}
                  onChange={() => onSelectMode(option.mode)}
                  data-testid={`${testId}-scope-${option.mode}`}
                />
                <span className="pc-rewind__scope-label">{option.label}</span>
                <span className="pc-rewind__scope-description">{option.description}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {notice ? (
          <p
            className={`pc-rewind__notice pc-rewind__notice--${status}`}
            role={status === "success" ? "status" : "alert"}
            data-testid={`${testId}-notice`}
          >
            {notice}
          </p>
        ) : null}

        {!showScopes && message ? (
          <p className="pc-rewind__daemon-message" data-testid={`${testId}-daemon-message`}>
            {message}
          </p>
        ) : null}

        {showScopes && !connected ? (
          <p className="pc-rewind__note" data-testid={`${testId}-disconnected`}>
            Not connected to the daemon — rewinding is unavailable right now.
          </p>
        ) : null}

        {showScopes && connected && turnRunning ? (
          <p className="pc-rewind__note" data-testid={`${testId}-turn-running`}>
            A turn is still running. Wait for it to finish before rewinding — the daemon refuses a
            restore mid-turn.
          </p>
        ) : null}

        <section className="pc-rewind__undone" aria-label="Undone turns">
          <h3 className="pc-rewind__undone-title">Undone turns</h3>
          <p className="pc-rewind__undone-hint" data-testid={`${testId}-undone-hint`}>
            Local record of rewinds in this browser session — not daemon state.
          </p>
          {undoneTurns.length === 0 ? (
            <p className="pc-rewind__undone-empty" data-testid={`${testId}-undone-empty`}>
              No rewinds yet in this session.
            </p>
          ) : (
            <ul className="pc-rewind__undone-list" data-testid={`${testId}-undone`}>
              {undoneTurns.map((turn) => (
                <li className="pc-rewind__undone-item" key={`${turn.messageId}:${turn.mode}`}>
                  <span className="pc-rewind__undone-snippet">{turn.snippet}</span>
                  <span className="pc-rewind__undone-mode">{rewindScopeLabel(turn.mode)}</span>
                  <Button
                    kind="secondary"
                    onClick={() => onReturnToTurn(turn)}
                    data-testid={`${testId}-return-${turn.messageId}`}
                  >
                    Return to this turn
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="pc-rewind__actions">
          {status === "idle" || status === "submitting" ? (
            <>
              <Button kind="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                kind="primary"
                onClick={onSubmit}
                disabled={!canSubmit || busy}
                data-testid={`${testId}-submit`}
              >
                {busy ? "Rewinding…" : "Rewind"}
              </Button>
            </>
          ) : null}

          {status === "conflict" ? (
            <>
              <Button kind="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                kind="danger"
                onClick={onRestoreAnyway}
                data-testid={`${testId}-restore-anyway`}
              >
                Restore anyway
              </Button>
            </>
          ) : null}

          {status === "unsupported" || status === "failed" || status === "success" ? (
            <Button kind="secondary" onClick={onClose} data-testid={`${testId}-close`}>
              Close
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default RewindDialog;
