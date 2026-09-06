import type { permissions } from "@picompanion/frontend-core";

import { Banner } from "../../ui/primitives/index.js";
import { OutcomeNoticeDialog } from "./OutcomeNotice.js";
import { PermissionDialog } from "./PermissionDialog.js";
import type { OutcomeNoticeViewModel } from "./outcome-notice.js";

export interface ApprovalsHostProps {
  current: permissions.PermissionDialogViewModel | null;
  waitingCount: number;
  error: string | null;
  onAnswer: (response: permissions.AgentPermissionResponse) => void;
  onDismissError: () => void;
  /**
   * A readable explanation that the request this client just answered or
   * was looking at was contested or superseded by another client (T47A2,
   * plan.md §12.3). Optional and defaults to `null` so every caller from
   * before this task keeps compiling and behaving unchanged.
   */
  notice?: OutcomeNoticeViewModel | null;
  /** Dismisses `notice`. Optional to match `notice` defaulting to `null`. */
  onDismissNotice?: () => void;
  testId?: string;
}

/**
 * Presentational host for the approvals surface (T28B7): a send-failure
 * `Banner` (plan.md §10.3, non-colour `role="status"` text) above at
 * most one modal `PermissionDialog` at a time, or nothing when the
 * queue is empty and there is no error to show — this component renders
 * `null` (no DOM at all) in the common "nothing pending" case, so
 * mounting `ApprovalsContainer` into a route never changes that route's
 * markup until a real request arrives.
 *
 * `key={current.requestId}` forces a fresh `PermissionDialog` mount per
 * request: a genuinely different request is a genuinely different
 * dialog (fresh focus-trap entry, fresh internal form state), not an
 * update of the same one — see `PermissionDialog`'s own doc comment for
 * why its `dismiss` callback is additionally stabilized for the case
 * *this* component re-renders (e.g. `error` changing) while `current`
 * stays the same request.
 *
 * `notice` (T47A2) takes over this same one-modal-at-a-time slot ahead of
 * `current`: when another client contested or superseded the request
 * this user was just looking at, that closes with a readable explanation
 * (`OutcomeNoticeDialog`) rather than the next queued dialog silently
 * appearing in its place. Once the user acknowledges the notice
 * (`onDismissNotice`), the queue's own next request (if any) takes the
 * slot back.
 */
export function ApprovalsHost({
  current,
  waitingCount,
  error,
  onAnswer,
  onDismissError,
  notice = null,
  onDismissNotice = () => {},
  testId,
}: ApprovalsHostProps) {
  return (
    <>
      {error ? (
        <Banner
          tone="danger"
          message={`Could not send your answer: ${error}`}
          actionLabel="Dismiss"
          onAction={onDismissError}
          testId="approvals-error-banner"
        />
      ) : null}
      {notice ? (
        <OutcomeNoticeDialog
          key={notice.requestId}
          notice={notice}
          onDismiss={onDismissNotice}
          testId={testId ? `${testId}-notice` : undefined}
        />
      ) : current ? (
        <PermissionDialog
          key={current.requestId}
          view={current}
          waitingCount={waitingCount}
          onAnswer={onAnswer}
          testId={testId}
        />
      ) : null}
    </>
  );
}

export default ApprovalsHost;
