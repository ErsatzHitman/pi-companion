import { useEffect, useId, useState } from "react";

import { Banner, TextField } from "../../ui/primitives/index.js";
import { useModalBehavior } from "../../ui/primitives/use-modal-behavior.js";
import { explainSessionsCreateError } from "./sessions-client.js";
import type { CreateSessionController } from "./use-create-session.js";

import "./create-session-dialog.css";

/** This product's daemon currently only registers `"pi"` (`DEFAULT_SESSION_PROVIDER`). */
const PROVIDER_OPTIONS = [{ value: "pi", label: "Pi" }] as const;

/** Above this many providers a segmented control stops reading as a control; fall back to a generic list. */
const MAX_SEGMENTED_PROVIDERS = 4;

/** After this many seconds of "submitting", the elapsed counter replaces the bare "starting" line. */
const ELAPSED_COUNTER_THRESHOLD_SECONDS = 5;

export interface CreateSessionDialogProps {
  controller: CreateSessionController;
  /**
   * Quick-pick working directories, most-relevant-first. These must be
   * real directories the caller already knows about (e.g. this host's
   * currently open sessions) — never fabricated. Omitted or empty
   * renders no chip row at all.
   */
  recentCwds?: readonly string[];
  /** Used in the honest-progress line ("Starting Pi on `<hostLabel>`…"). Defaults to "this host". */
  hostLabel?: string;
}

/**
 * A live "creating…" indicator (T27B2 restyle, UI-W6): a spinner plus
 * "Starting Pi on `<hostLabel>`…" immediately, and — once the create has
 * genuinely run long enough that a bare spinner starts reading as
 * hung — an elapsed-seconds counter alongside it. A cold-start create
 * measured at 52.5s; this never lets that look stuck.
 */
function CreatingProgress({ hostLabel }: { hostLabel: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="pc-create-session__progress" role="status" data-testid="create-session-progress">
      <span className="pc-create-session__spinner" aria-hidden="true" />
      <span>
        Starting Pi on {hostLabel}…
        {elapsedSeconds >= ELAPSED_COUNTER_THRESHOLD_SECONDS ? (
          <>
            {" "}
            <span className="pc-create-session__elapsed" data-testid="create-session-elapsed">
              {elapsedSeconds}s
            </span>
          </>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The "create a session" dialog (T27B2, plan.md §8.3; restyled at
 * UI-W6 to the design reference's vocabulary —
 * `docs/ui-reference/pi-companion-web.html`'s eyebrow, `.seg` segmented
 * control, `.chip` quick-picks, and hairline footer, rather than the
 * generic `Dialog` primitive's centred confirmation shell. It hand-rolls
 * its own modal panel on the same `useModalBehavior` hook `Dialog` uses
 * (focus trap, Escape-to-close, focus restore) so it can carry an
 * eyebrow above its title and a ghost/accent footer the generic
 * primitive has no shape for.
 *
 * A failed submit re-opens with every typed field intact
 * (`useCreateSession` never clears the draft on failure); a real daemon
 * error (e.g. `directory_not_found`) is surfaced verbatim via
 * `explainSessionsCreateError`, never swallowed.
 */
export function CreateSessionDialog({
  controller,
  recentCwds = [],
  hostLabel = "this host",
}: CreateSessionDialogProps) {
  const explanation = controller.errorMessage
    ? explainSessionsCreateError(controller.errorMessage)
    : null;
  const submitting = controller.phase === "submitting";
  const titleId = useId();
  const providerLabelId = useId();
  const panelRef = useModalBehavior(controller.open, controller.closeDialog);

  if (!controller.open) return null;

  const uniqueRecentCwds = [...new Set(recentCwds.filter((cwd) => cwd.trim().length > 0))];

  return (
    <div className="pc-overlay-scrim pc-overlay-scrim--dialog" onMouseDown={controller.closeDialog}>
      <div
        ref={panelRef}
        className="pc-create-session"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="create-session-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pc-create-session__header">
          <span className="pc-create-session__eyebrow">Workspace</span>
          <h2 className="pc-create-session__title" id={titleId}>
            New session
          </h2>
        </div>

        {PROVIDER_OPTIONS.length <= MAX_SEGMENTED_PROVIDERS ? (
          <div className="pc-create-session__field">
            <span className="pc-create-session__label" id={providerLabelId}>
              Provider
            </span>
            <div
              className="pc-create-session__seg"
              role="group"
              aria-labelledby={providerLabelId}
              data-testid="create-session-provider-field"
            >
              {PROVIDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={controller.provider === option.value}
                  onClick={() => controller.setProvider(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <TextField
            label="Provider"
            value={controller.provider}
            onChange={(event) => controller.setProvider(event.target.value)}
            testId="create-session-provider-field"
          />
        )}

        <TextField
          label="Working directory"
          value={controller.cwd}
          onChange={(event) => controller.setCwd(event.target.value)}
          placeholder="/home/me/project"
          required
          error={controller.errors.cwd}
          testId="create-session-cwd-field"
          autoComplete="off"
          spellCheck={false}
          className="pc-create-session__cwd-field"
        />

        {uniqueRecentCwds.length > 0 ? (
          <div
            className="pc-create-session__chips"
            role="group"
            aria-label="Recent working directories"
            data-testid="create-session-cwd-chips"
          >
            {uniqueRecentCwds.map((cwd) => (
              <button
                key={cwd}
                type="button"
                className="pc-create-session__chip"
                onClick={() => controller.setCwd(cwd)}
                data-testid={`create-session-cwd-chip-${cwd}`}
              >
                {cwd}
              </button>
            ))}
          </div>
        ) : null}

        {submitting ? <CreatingProgress hostLabel={hostLabel} /> : null}

        {explanation ? (
          <Banner
            tone="danger"
            message={`${explanation.title}: ${explanation.description}`}
            testId="create-session-error-banner"
          />
        ) : null}

        <div className="pc-create-session__footer">
          <button
            type="button"
            className="pc-create-session__cancel"
            onClick={controller.closeDialog}
            data-testid="create-session-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="pc-create-session__create"
            onClick={() => void controller.submit()}
            disabled={submitting}
            data-testid="create-session-submit"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
